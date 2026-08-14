use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::marker::PhantomData;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::error::ExecutorError;
use crate::timeout::enforce_timeout;

/// Typestate marker indicating an unconfigured executor.
#[derive(Debug, Default)]
pub struct Unconfigured;

/// Typestate marker indicating a fully configured executor ready to spawn or execute.
#[derive(Debug, Default)]
pub struct Configured;

/// Normalized output record from process execution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timed_out: bool,
}

/// Process Executor utilizing the Typestate pattern to prevent running unconfigured commands.
#[derive(Debug)]
pub struct ProcessExecutor<State = Unconfigured> {
    _state: PhantomData<State>,
    command: String,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    env: HashMap<String, String>,
    timeout: Option<Duration>,
    max_buffer_bytes: usize,
    cgroup_guard: Option<crucible_sandbox::CgroupGuard>,
    overlay_guard: Option<crucible_sandbox::OverlayFsGuard>,
}

impl ProcessExecutor<Unconfigured> {
    /// Initializes an unconfigured ProcessExecutor.
    #[must_use]
    pub fn new() -> Self {
        Self {
            _state: PhantomData,
            command: String::new(),
            args: Vec::new(),
            cwd: None,
            env: HashMap::new(),
            timeout: None,
            max_buffer_bytes: 10 * 1024 * 1024, // 10MB default buffer
            cgroup_guard: None,
            overlay_guard: None,
        }
    }

    /// Sets the executable command, transitioning the typestate from `Unconfigured` to `Configured`.
    #[must_use]
    pub fn command(self, cmd: impl Into<String>) -> ProcessExecutor<Configured> {
        ProcessExecutor {
            _state: PhantomData,
            command: cmd.into(),
            args: self.args,
            cwd: self.cwd,
            env: self.env,
            timeout: self.timeout,
            max_buffer_bytes: self.max_buffer_bytes,
            cgroup_guard: self.cgroup_guard,
            overlay_guard: self.overlay_guard,
        }
    }
}

impl Default for ProcessExecutor<Unconfigured> {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessExecutor<Configured> {
    /// Appends a single argument to the command.
    #[must_use]
    pub fn arg(mut self, arg: impl Into<String>) -> Self {
        self.args.push(arg.into());
        self
    }

    /// Appends multiple arguments to the command.
    #[must_use]
    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }

    /// Sets the working directory for the process.
    #[must_use]
    pub fn current_dir(mut self, path: impl Into<PathBuf>) -> Self {
        self.cwd = Some(path.into());
        self
    }

    /// Inserts an environment variable for the process.
    #[must_use]
    pub fn env(mut self, key: impl Into<String>, val: impl Into<String>) -> Self {
        self.env.insert(key.into(), val.into());
        self
    }

    /// Inserts multiple environment variables for the process.
    #[must_use]
    pub fn envs<I, K, V>(mut self, vars: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        for (k, v) in vars {
            self.env.insert(k.into(), v.into());
        }
        self
    }

    /// Sets a wall-clock execution timeout.
    #[must_use]
    pub fn timeout(mut self, duration: Duration) -> Self {
        self.timeout = Some(duration);
        self
    }

    /// Sets maximum bytes captured for stdout and stderr streams.
    #[must_use]
    pub fn max_buffer_bytes(mut self, max_bytes: usize) -> Self {
        self.max_buffer_bytes = max_bytes;
        self
    }

    /// Attaches an isolated cgroup v2 sandbox to this process execution.
    #[must_use]
    pub fn with_cgroup(mut self, guard: crucible_sandbox::CgroupGuard) -> Self {
        self.cgroup_guard = Some(guard);
        self
    }

    /// Attaches an ephemeral OverlayFS copy-on-write filesystem to this execution.
    ///
    /// Sets the working directory to the merged view if not explicitly overridden.
    #[must_use]
    pub fn with_overlay(mut self, guard: crucible_sandbox::OverlayFsGuard) -> Self {
        if self.cwd.is_none() {
            self.cwd = Some(guard.merged_path().to_path_buf());
        }
        self.overlay_guard = Some(guard);
        self
    }

    /// Spawns the process and captures its stdout, stderr, and exit status asynchronously.
    ///
    /// If a timeout was configured, execution is automatically bounded and cancelled via RAII.
    pub async fn execute(self) -> Result<ExecutionOutput, ExecutorError> {
        let cmd_desc = format!("{} {}", self.command, self.args.join(" "));
        let timeout_opt = self.timeout;

        if let Some(dur) = timeout_opt {
            enforce_timeout(dur, &cmd_desc, self.execute_internal()).await
        } else {
            self.execute_internal().await
        }
    }

    async fn execute_internal(self) -> Result<ExecutionOutput, ExecutorError> {
        let start_time = Instant::now();
        let cmd_desc = format!("{} {}", self.command, self.args.join(" "));

        tracing::info!(
            command = %self.command,
            args = ?self.args,
            cwd = ?self.cwd,
            "Spawning compute process"
        );

        let mut cmd = Command::new(&self.command);
        cmd.args(&self.args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .kill_on_drop(true); // RAII process cleanup

        if let Some(cwd) = &self.cwd {
            cmd.current_dir(cwd);
        }

        for (k, v) in &self.env {
            cmd.env(k, v);
        }

        let mut child = cmd.spawn().map_err(|err| {
            tracing::error!(
                error_type = "SPAWN_FAILURE",
                command = %self.command,
                error = %err,
                "Failed to spawn process"
            );
            ExecutorError::SpawnFailed {
                command: self.command.clone(),
                source: err,
            }
        })?;

        // Attach PID to cgroup sandbox if configured
        if let Some(guard) = &self.cgroup_guard
            && let Some(pid) = child.id()
            && let Err(err) = guard.attach_pid(pid)
        {
            tracing::warn!(
                pid = pid,
                cgroup_id = %guard.id,
                error = %err,
                "Failed to attach process PID to cgroup sandbox"
            );
        }

        let mut stdout_pipe = child.stdout.take();
        let mut stderr_pipe = child.stderr.take();
        let max_buffer = self.max_buffer_bytes;

        let stdout_handle = tokio::spawn(async move {
            let mut buf = Vec::new();
            if let Some(mut stream) = stdout_pipe.take() {
                let mut chunk = vec![0u8; 8192];
                while buf.len() < max_buffer {
                    let n = stream.read(&mut chunk).await?;
                    if n == 0 {
                        break;
                    }
                    let remaining = max_buffer - buf.len();
                    let to_write = n.min(remaining);
                    buf.extend_from_slice(&chunk[..to_write]);
                }
            }
            Ok::<_, std::io::Error>(String::from_utf8_lossy(&buf).to_string())
        });

        let stderr_handle = tokio::spawn(async move {
            let mut buf = Vec::new();
            if let Some(mut stream) = stderr_pipe.take() {
                let mut chunk = vec![0u8; 8192];
                while buf.len() < max_buffer {
                    let n = stream.read(&mut chunk).await?;
                    if n == 0 {
                        break;
                    }
                    let remaining = max_buffer - buf.len();
                    let to_write = n.min(remaining);
                    buf.extend_from_slice(&chunk[..to_write]);
                }
            }
            Ok::<_, std::io::Error>(String::from_utf8_lossy(&buf).to_string())
        });

        let status = child.wait().await.map_err(ExecutorError::Io)?;
        let duration_ms = start_time.elapsed().as_millis() as u64;

        let stdout = stdout_handle
            .await
            .map_err(|e| ExecutorError::InvalidConfiguration {
                message: format!("Stdout stream task panicked: {e}"),
            })?
            .map_err(|err| ExecutorError::StreamReadFailed {
                stream: "stdout",
                source: err,
            })?;

        let stderr = stderr_handle
            .await
            .map_err(|e| ExecutorError::InvalidConfiguration {
                message: format!("Stderr stream task panicked: {e}"),
            })?
            .map_err(|err| ExecutorError::StreamReadFailed {
                stream: "stderr",
                source: err,
            })?;

        let exit_code = status.code().unwrap_or(137);

        if exit_code != 0 {
            tracing::warn!(
                error_type = "NON_ZERO_EXIT",
                command = %cmd_desc,
                exit_code = exit_code,
                stderr = %stderr.trim(),
                duration_ms = duration_ms,
                "Process finished with non-zero exit code"
            );
        } else {
            tracing::info!(
                command = %cmd_desc,
                exit_code = exit_code,
                duration_ms = duration_ms,
                "Process finished successfully"
            );
        }

        Ok(ExecutionOutput {
            exit_code,
            stdout: stdout.trim_end().to_string(),
            stderr: stderr.trim_end().to_string(),
            duration_ms,
            timed_out: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn test_typestate_execution_success() {
        let output = ProcessExecutor::new()
            .command("echo")
            .arg("crucible-rust-executor-online")
            .execute()
            .await
            .expect("Process execution failed");

        assert_eq!(output.exit_code, 0);
        assert_eq!(output.stdout, "crucible-rust-executor-online");
        assert_eq!(output.stderr, "");
        assert!(!output.timed_out);
    }

    #[tokio::test]
    async fn test_typestate_with_env_and_args() {
        let output = ProcessExecutor::new()
            .command("sh")
            .args(["-c", "echo $TEST_VAR_RUST"])
            .env("TEST_VAR_RUST", "tokio_process_success")
            .execute()
            .await
            .expect("Execution failed");

        assert_eq!(output.exit_code, 0);
        assert_eq!(output.stdout, "tokio_process_success");
    }

    #[tokio::test]
    async fn test_process_non_zero_exit() {
        let output = ProcessExecutor::new()
            .command("sh")
            .args(["-c", "echo 'something went wrong' >&2; exit 42"])
            .execute()
            .await
            .expect("Execution should return output struct even on non-zero exit");

        assert_eq!(output.exit_code, 42);
        assert_eq!(output.stderr, "something went wrong");
    }

    #[tokio::test]
    async fn test_process_timeout_cancellation() {
        let result = ProcessExecutor::new()
            .command("sleep")
            .arg("10")
            .timeout(Duration::from_millis(50))
            .execute()
            .await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ExecutorError::Timeout { duration_ms, .. } => {
                assert_eq!(duration_ms, 50);
            }
            other => panic!("Expected Timeout, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_process_spawn_failure() {
        let result = ProcessExecutor::new()
            .command("/non_existent_binary_xyz_123")
            .execute()
            .await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ExecutorError::SpawnFailed { command, .. } => {
                assert_eq!(command, "/non_existent_binary_xyz_123");
            }
            other => panic!("Expected SpawnFailed error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_process_execution_with_cgroup_sandbox() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let manager = crucible_sandbox::CgroupManager::new(temp_dir.path());
        let limits = crucible_sandbox::CgroupLimits::new()
            .with_cpu_limit(50_000, 100_000)
            .with_memory_limit_bytes(256 * 1024 * 1024)
            .with_pids_max(32);

        let guard = manager.create_sandbox("test_exec_sandbox", limits).unwrap();
        let guard_path = guard.path.clone();

        let output = ProcessExecutor::new()
            .command("echo")
            .arg("cgroup_sandbox_process_success")
            .with_cgroup(guard)
            .execute()
            .await
            .expect("Execution in cgroup sandbox failed");

        assert_eq!(output.exit_code, 0);
        assert_eq!(output.stdout, "cgroup_sandbox_process_success");
        // Ensure cgroup guard directory was torn down automatically upon Drop
        assert!(!guard_path.exists());
    }

    #[tokio::test]
    async fn test_process_execution_with_overlayfs() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let lower_dir = temp_dir.path().join("base_repo");
        std::fs::create_dir_all(&lower_dir).unwrap();
        std::fs::write(lower_dir.join("initial.txt"), "hello_pristine").unwrap();

        let overlay_manager =
            crucible_sandbox::OverlayFsManager::new(temp_dir.path().join("overlays"));
        let guard = overlay_manager
            .create_overlay("proc_overlay", &[lower_dir.clone()])
            .unwrap();
        let overlay_instance_dir = guard.merged_path().parent().unwrap().to_path_buf();

        let output = ProcessExecutor::new()
            .command("sh")
            .args([
                "-c",
                "echo 'mutated_in_sandbox' > new_file.txt && cat initial.txt",
            ])
            .with_overlay(guard)
            .execute()
            .await
            .expect("Execution with overlay failed");

        assert_eq!(output.exit_code, 0);
        assert_eq!(output.stdout, "hello_pristine");
        // Lowerdir must remain untouched
        assert!(!lower_dir.join("new_file.txt").exists());
        // Overlay instance directory must be cleaned up on Drop
        assert!(!overlay_instance_dir.exists());
    }
}
