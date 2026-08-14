use thiserror::Error;

#[derive(Error, Debug)]
pub enum ExecutorError {
    #[error("Failed to spawn process '{command}': {source}")]
    SpawnFailed {
        command: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Process execution timed out after {duration_ms}ms: '{command}'")]
    Timeout { command: String, duration_ms: u64 },

    #[error("I/O error during process execution: {0}")]
    Io(#[from] std::io::Error),

    #[error("Failed to read process {stream} stream: {source}")]
    StreamReadFailed {
        stream: &'static str,
        #[source]
        source: std::io::Error,
    },

    #[error("Process was terminated by signal (code: {signal:?})")]
    ProcessKilled { signal: Option<i32> },

    #[error("Invalid executor configuration: {message}")]
    InvalidConfiguration { message: String },
}
