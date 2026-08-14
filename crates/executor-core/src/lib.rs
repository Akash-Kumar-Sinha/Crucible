//! # Executor Core
//!
//! High-performance asynchronous process execution harness and stream capture core for Crucible.
//!
//! ## Design Patterns
//! - **Typestate Pattern**: Prevents unconfigured process execution at compile time.
//! - **RAII Cleanup**: Automatic process termination and resource deallocation on drop.
//! - **Structured Observability**: Structured JSON tracing matching Pino conventions.

pub mod error;
pub mod process;
pub mod timeout;

pub use error::ExecutorError;
pub use process::{Configured, ExecutionOutput, ProcessExecutor, Unconfigured};
pub use timeout::enforce_timeout;

use std::sync::Once;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

static INIT_TRACING: Once = Once::new();

/// Initializes structured JSON logging for the executor core.
///
/// Outputs machine-readable JSON log events to stdout, matching the Pino structured logging format.
pub fn init_json_logging() {
    INIT_TRACING.call_once(|| {
        let env_filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("info,executor_core=debug"));

        let json_layer = tracing_subscriber::fmt::layer()
            .json()
            .flatten_event(true)
            .with_target(false)
            .with_current_span(false);

        let _ = tracing_subscriber::registry()
            .with(env_filter)
            .with(json_layer)
            .try_init();
    });
}
