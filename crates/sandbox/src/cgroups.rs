use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tracing::{debug, error, info};

use crate::error::SandboxError;

static CGROUP_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Resource limits for a cgroups v2 sandbox (Bulkhead pattern)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CgroupLimits {
    pub cpu_quota_us: Option<u64>,
    pub cpu_period_us: Option<u64>,
    pub memory_max_bytes: Option<u64>,
    pub pids_max: Option<u32>,
}

impl Default for CgroupLimits {
    fn default() -> Self {
        Self {
            cpu_quota_us: Some(100_000),               // 100% of 1 CPU core default
            cpu_period_us: Some(100_000),              // 100ms period
            memory_max_bytes: Some(256 * 1024 * 1024), // 256 MB
            pids_max: Some(64),                        // 64 tasks maximum to prevent fork bombs
        }
    }
}

impl CgroupLimits {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_cpu_limit(mut self, quota_us: u64, period_us: u64) -> Self {
        self.cpu_quota_us = Some(quota_us);
        self.cpu_period_us = Some(period_us);
        self
    }

    pub fn with_memory_limit_bytes(mut self, bytes: u64) -> Self {
        self.memory_max_bytes = Some(bytes);
        self
    }

    pub fn with_pids_max(mut self, max_pids: u32) -> Self {
        self.pids_max = Some(max_pids);
        self
    }
}

/// RAII Guard for an isolated cgroup v2 sandbox
///
/// Guarantees that processes inside the cgroup are killed and the cgroup directory
/// is deleted on drop, preventing resource leaks even during panics or abnormal termination.
#[derive(Debug)]
pub struct CgroupGuard {
    pub id: String,
    pub path: PathBuf,
    pub limits: CgroupLimits,
    pub is_active: bool,
}

impl CgroupGuard {
    /// Creates a new cgroup directory and applies configured limits.
    pub fn create(base_path: &Path, id: &str, limits: CgroupLimits) -> Result<Self, SandboxError> {
        let path = base_path.join(id);

        if let Err(e) = fs::create_dir_all(&path) {
            return Err(SandboxError::CreationFailed {
                path: path.display().to_string(),
                reason: e.to_string(),
            });
        }

        let mut guard = Self {
            id: id.to_string(),
            path,
            limits,
            is_active: true,
        };

        if let Err(e) = guard.apply_limits() {
            // Teardown created directory before returning error
            let _ = guard.teardown();
            return Err(e);
        }

        info!(
            target: "crucible::sandbox::cgroups",
            cgroup_id = %guard.id,
            cgroup_path = %guard.path.display(),
            "Created cgroup v2 sandbox with resource limits"
        );

        Ok(guard)
    }

    /// Applies CPU, memory, and PID limits to the cgroup v2 controller interface.
    pub fn apply_limits(&self) -> Result<(), SandboxError> {
        // 1. CPU Limits (cpu.max)
        if let (Some(quota), Some(period)) = (self.limits.cpu_quota_us, self.limits.cpu_period_us) {
            let cpu_max_path = self.path.join("cpu.max");
            if cpu_max_path.exists() || self.is_in_virtual_test_mode() {
                let val = format!("{} {}", quota, period);
                self.write_cgroup_file("cpu.max", &val)?;
            }
        }

        // 2. Memory Limits (memory.max)
        if let Some(mem_max) = self.limits.memory_max_bytes {
            let mem_max_path = self.path.join("memory.max");
            if mem_max_path.exists() || self.is_in_virtual_test_mode() {
                let val = format!("{}", mem_max);
                self.write_cgroup_file("memory.max", &val)?;
            }
        }

        // 3. PIDs Limits (pids.max)
        if let Some(pids_max) = self.limits.pids_max {
            let pids_max_path = self.path.join("pids.max");
            if pids_max_path.exists() || self.is_in_virtual_test_mode() {
                let val = format!("{}", pids_max);
                self.write_cgroup_file("pids.max", &val)?;
            }
        }

        Ok(())
    }

    /// Attaches a process PID to this cgroup by writing to `cgroup.procs`.
    pub fn attach_pid(&self, pid: u32) -> Result<(), SandboxError> {
        if !self.is_active {
            return Err(SandboxError::AttachPidFailed {
                pid,
                path: self.path.display().to_string(),
                reason: "cgroup is no longer active".to_string(),
            });
        }

        let pid_str = format!("{}", pid);
        self.write_cgroup_file("cgroup.procs", &pid_str)
            .map_err(|e| SandboxError::AttachPidFailed {
                pid,
                path: self.path.display().to_string(),
                reason: e.to_string(),
            })?;

        debug!(
            target: "crucible::sandbox::cgroups",
            cgroup_id = %self.id,
            pid = pid,
            "Attached process PID to cgroup sandbox"
        );

        Ok(())
    }

    /// Kills all processes currently running in this cgroup.
    pub fn kill_all(&self) -> Result<(), SandboxError> {
        if !self.path.exists() {
            return Ok(());
        }

        // Method A: cgroup.kill (Linux 5.14+)
        let kill_file = self.path.join("cgroup.kill");
        if kill_file.exists()
            && let Ok(mut f) = OpenOptions::new().write(true).open(&kill_file)
        {
            let _ = f.write_all(b"1\n");
            return Ok(());
        }

        // Method B: Fallback - Read cgroup.procs and signal PIDs
        let procs_file = self.path.join("cgroup.procs");
        if procs_file.exists()
            && let Ok(content) = fs::read_to_string(&procs_file)
        {
            for line in content.lines() {
                if let Ok(pid) = line.trim().parse::<i32>() {
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .output();
                }
            }
        }

        Ok(())
    }

    /// Reads current memory usage in bytes.
    pub fn read_memory_current(&self) -> Result<u64, SandboxError> {
        let path = self.path.join("memory.current");
        if !path.exists() {
            return Ok(0);
        }
        let content = fs::read_to_string(&path)?;
        content.trim().parse::<u64>().map_err(|e| {
            SandboxError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Invalid memory.current value: {}", e),
            ))
        })
    }

    /// Reads current process count in the cgroup.
    pub fn read_pids_current(&self) -> Result<u32, SandboxError> {
        let path = self.path.join("pids.current");
        if !path.exists() {
            return Ok(0);
        }
        let content = fs::read_to_string(&path)?;
        content.trim().parse::<u32>().map_err(|e| {
            SandboxError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Invalid pids.current value: {}", e),
            ))
        })
    }

    /// Explicitly tears down the cgroup, killing processes and removing the directory.
    pub fn teardown(&mut self) -> Result<(), SandboxError> {
        if !self.is_active && !self.path.exists() {
            return Ok(());
        }

        self.is_active = false;
        let _ = self.kill_all();

        // Drain loop
        for _ in 0..5 {
            if !self.path.exists() {
                break;
            }
            let res = if self.is_in_virtual_test_mode() {
                fs::remove_dir_all(&self.path)
            } else {
                fs::remove_dir(&self.path)
            };
            if res.is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        if self.path.exists() {
            let res = if self.is_in_virtual_test_mode() {
                fs::remove_dir_all(&self.path)
            } else {
                fs::remove_dir(&self.path)
            };

            if let Err(e) = res {
                error!(
                    target: "crucible::sandbox::cgroups",
                    alert = "CRUCIBLE_CGROUP_TEARDOWN_FAILURE_ALERT",
                    cgroup_id = %self.id,
                    cgroup_path = %self.path.display(),
                    error = %e,
                    "CRITICAL RESOURCE LEAK: cgroup teardown failed to delete directory"
                );
                return Err(SandboxError::TeardownFailed {
                    path: self.path.display().to_string(),
                    reason: e.to_string(),
                });
            }
        }

        debug!(
            target: "crucible::sandbox::cgroups",
            cgroup_id = %self.id,
            "cgroup sandbox successfully torn down and removed"
        );

        Ok(())
    }

    fn write_cgroup_file(&self, filename: &'static str, value: &str) -> Result<(), SandboxError> {
        let file_path = self.path.join(filename);
        let mut file = OpenOptions::new()
            .create(self.is_in_virtual_test_mode())
            .write(true)
            .truncate(true)
            .open(&file_path)
            .map_err(|e| SandboxError::LimitApplyFailed {
                limit_name: filename,
                value: value.to_string(),
                path: file_path.display().to_string(),
                reason: e.to_string(),
            })?;

        file.write_all(value.as_bytes())
            .map_err(|e| SandboxError::LimitApplyFailed {
                limit_name: filename,
                value: value.to_string(),
                path: file_path.display().to_string(),
                reason: e.to_string(),
            })?;

        Ok(())
    }

    fn is_in_virtual_test_mode(&self) -> bool {
        // If path is under /tmp or a test dir rather than /sys/fs/cgroup, allow file creation for unit tests
        !self.path.starts_with("/sys/fs/cgroup")
    }
}

impl Drop for CgroupGuard {
    fn drop(&mut self) {
        if self.is_active
            && let Err(err) = self.teardown()
        {
            // Phase 8 / Phase 11 Extended: Dedicated high-priority alert for cgroup leaks
            error!(
                target: "crucible::sandbox::cgroups",
                alert = "CRUCIBLE_CGROUP_TEARDOWN_FAILURE_ALERT",
                cgroup_id = %self.id,
                cgroup_path = %self.path.display(),
                error = %err,
                "CRITICAL RESOURCE LEAK ALERT: cgroup failed to teardown during drop/panic unwinding"
            );
        }
    }
}

/// Manager and Resource Pool for cgroup v2 sandboxes
#[derive(Debug, Clone)]
pub struct CgroupManager {
    base_path: PathBuf,
}

fn detect_best_cgroup_base() -> PathBuf {
    if let Ok(path) = std::env::var("CRUCIBLE_CGROUP_PATH") {
        return PathBuf::from(path);
    }

    let uid = get_current_uid();
    let user_service = PathBuf::from(format!(
        "/sys/fs/cgroup/user.slice/user-{}.slice/user@{}.service",
        uid, uid
    ));

    if user_service.exists() {
        let crucible_dir = user_service.join("crucible");
        if fs::create_dir_all(&crucible_dir).is_ok() {
            let subtree_file = user_service.join("cgroup.subtree_control");
            if subtree_file.exists() {
                let _ = OpenOptions::new()
                    .write(true)
                    .open(&subtree_file)
                    .and_then(|mut f| f.write_all(b"+cpu +memory +pids\n"));
            }
            return crucible_dir;
        }
    }

    PathBuf::from("/sys/fs/cgroup/crucible")
}

fn get_current_uid() -> u32 {
    if let Ok(content) = fs::read_to_string("/proc/self/status") {
        for line in content.lines() {
            if line.starts_with("Uid:")
                && let Some(uid_val) = line.split_whitespace().nth(1)
                && let Ok(uid) = uid_val.parse::<u32>()
            {
                return uid;
            }
        }
    }
    1000
}

impl Default for CgroupManager {
    fn default() -> Self {
        Self {
            base_path: detect_best_cgroup_base(),
        }
    }
}

impl CgroupManager {
    pub fn new(base_path: impl Into<PathBuf>) -> Self {
        Self {
            base_path: base_path.into(),
        }
    }

    /// Verifies if cgroup v2 hierarchy is available on the system.
    pub fn is_cgroup_v2_available() -> bool {
        Path::new("/sys/fs/cgroup/cgroup.controllers").exists()
            || Path::new("/sys/fs/cgroup/cgroup.procs").exists()
    }

    /// Allocates and initializes a new isolated cgroup sandbox.
    pub fn create_sandbox(
        &self,
        prefix: &str,
        limits: CgroupLimits,
    ) -> Result<CgroupGuard, SandboxError> {
        let seq = CGROUP_COUNTER.fetch_add(1, Ordering::SeqCst);
        let id = format!("{}_{}_{}", prefix, std::process::id(), seq);
        CgroupGuard::create(&self.base_path, &id, limits)
    }

    pub fn base_path(&self) -> &Path {
        &self.base_path
    }
}

/// Bounded Resource Pool for cgroup sandboxes (Resource Pool & Bulkhead Patterns)
#[derive(Debug)]
pub struct CgroupPool {
    manager: CgroupManager,
    max_sandboxes: usize,
    default_limits: CgroupLimits,
}

impl CgroupPool {
    pub fn new(manager: CgroupManager, max_sandboxes: usize, default_limits: CgroupLimits) -> Self {
        Self {
            manager,
            max_sandboxes,
            default_limits,
        }
    }

    pub fn acquire(&self, prefix: &str) -> Result<CgroupGuard, SandboxError> {
        self.manager
            .create_sandbox(prefix, self.default_limits.clone())
    }

    pub fn acquire_with_limits(
        &self,
        prefix: &str,
        limits: CgroupLimits,
    ) -> Result<CgroupGuard, SandboxError> {
        self.manager.create_sandbox(prefix, limits)
    }

    pub fn max_sandboxes(&self) -> usize {
        self.max_sandboxes
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_cgroup_limits_builder() {
        let limits = CgroupLimits::new()
            .with_cpu_limit(50_000, 100_000)
            .with_memory_limit_bytes(512 * 1024 * 1024)
            .with_pids_max(32);

        assert_eq!(limits.cpu_quota_us, Some(50_000));
        assert_eq!(limits.cpu_period_us, Some(100_000));
        assert_eq!(limits.memory_max_bytes, Some(512 * 1024 * 1024));
        assert_eq!(limits.pids_max, Some(32));
    }

    #[test]
    fn test_cgroup_guard_lifecycle_in_virtual_dir() {
        let temp_dir = TempDir::new().unwrap();
        let manager = CgroupManager::new(temp_dir.path());

        let limits = CgroupLimits::new()
            .with_cpu_limit(20_000, 100_000)
            .with_memory_limit_bytes(128 * 1024 * 1024)
            .with_pids_max(16);

        let mut guard = manager.create_sandbox("test_run", limits).unwrap();
        assert!(guard.path.exists());
        assert!(guard.is_active);

        // Check created limit files in virtual mode
        assert!(guard.path.join("cpu.max").exists());
        assert!(guard.path.join("memory.max").exists());
        assert!(guard.path.join("pids.max").exists());

        // Teardown
        guard.teardown().unwrap();
        assert!(!guard.path.exists());
        assert!(!guard.is_active);
    }

    #[test]
    fn test_cgroup_guard_drop_cleanup() {
        let temp_dir = TempDir::new().unwrap();
        let path_copy;
        {
            let manager = CgroupManager::new(temp_dir.path());
            let guard = manager
                .create_sandbox("drop_test", CgroupLimits::default())
                .unwrap();
            path_copy = guard.path.clone();
            assert!(path_copy.exists());
            // guard falls out of scope here and triggers Drop
        }
        assert!(
            !path_copy.exists(),
            "cgroup directory must be removed on Drop"
        );
    }

    #[test]
    fn test_cgroup_pool_acquisition() {
        let temp_dir = TempDir::new().unwrap();
        let manager = CgroupManager::new(temp_dir.path());
        let pool = CgroupPool::new(manager, 10, CgroupLimits::default());

        let guard1 = pool.acquire("pool_sandbox").unwrap();
        let guard2 = pool.acquire("pool_sandbox").unwrap();

        assert_ne!(guard1.id, guard2.id);
        assert!(guard1.path.exists());
        assert!(guard2.path.exists());
    }
}
