use std::future::Future;
use std::time::Duration;
use tokio::time::timeout;

use crate::error::ExecutorError;

/// Enforces a wall-clock timeout on an asynchronous execution future.
///
/// If the timeout expires, the future is cancelled via RAII drop semantics
/// and a structured timeout error is emitted.
pub async fn enforce_timeout<F, T>(
    duration: Duration,
    command_desc: &str,
    future: F,
) -> Result<T, ExecutorError>
where
    F: Future<Output = Result<T, ExecutorError>>,
{
    match timeout(duration, future).await {
        Ok(result) => result,
        Err(_) => {
            let timeout_ms = duration.as_millis() as u64;
            tracing::error!(
                error_type = "TIMEOUT",
                command = %command_desc,
                timeout_ms = timeout_ms,
                "Process execution timed out after {}ms",
                timeout_ms
            );
            Err(ExecutorError::Timeout {
                command: command_desc.to_string(),
                duration_ms: timeout_ms,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn test_enforce_timeout_success() {
        let res = enforce_timeout(Duration::from_millis(100), "test_cmd", async {
            Ok::<_, ExecutorError>(42)
        })
        .await;

        assert!(res.is_ok());
        assert_eq!(res.unwrap(), 42);
    }

    #[tokio::test]
    async fn test_enforce_timeout_expires() {
        let res = enforce_timeout(Duration::from_millis(20), "sleep_cmd", async {
            tokio::time::sleep(Duration::from_millis(100)).await;
            Ok::<_, ExecutorError>(42)
        })
        .await;

        assert!(res.is_err());
        match res.unwrap_err() {
            ExecutorError::Timeout {
                command,
                duration_ms,
            } => {
                assert_eq!(command, "sleep_cmd");
                assert_eq!(duration_ms, 20);
            }
            other => panic!("Expected Timeout error, got: {:?}", other),
        }
    }
}
