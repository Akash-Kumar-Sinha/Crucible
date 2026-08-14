use executor_core::{ExecutorError, ProcessExecutor};
use std::time::{Duration, Instant};

#[tokio::test]
async fn test_trivial_command_execution() {
    let output = ProcessExecutor::new()
        .command("echo")
        .arg("hello-crucible-core")
        .execute()
        .await
        .expect("Trivial execution failed");

    assert_eq!(output.exit_code, 0);
    assert_eq!(output.stdout, "hello-crucible-core");
    assert_eq!(output.stderr, "");
    assert!(!output.timed_out);
}

#[tokio::test]
async fn test_stdout_and_stderr_stream_isolation() {
    let output = ProcessExecutor::new()
        .command("sh")
        .args(["-c", "echo 'stdout_payload'; echo 'stderr_payload' >&2"])
        .execute()
        .await
        .expect("Stream execution failed");

    assert_eq!(output.exit_code, 0);
    assert_eq!(output.stdout, "stdout_payload");
    assert_eq!(output.stderr, "stderr_payload");
}

#[tokio::test]
async fn test_slow_command_killed_at_timeout() {
    let start = Instant::now();
    let result = ProcessExecutor::new()
        .command("sleep")
        .arg("10")
        .timeout(Duration::from_millis(100))
        .execute()
        .await;

    let elapsed = start.elapsed();
    assert!(result.is_err());
    assert!(
        elapsed < Duration::from_secs(2),
        "Process did not get terminated promptly at timeout (took {:?})",
        elapsed
    );

    match result.unwrap_err() {
        ExecutorError::Timeout {
            command,
            duration_ms,
        } => {
            assert!(command.contains("sleep"));
            assert_eq!(duration_ms, 100);
        }
        other => panic!("Expected Timeout error variant, got: {:?}", other),
    }
}
