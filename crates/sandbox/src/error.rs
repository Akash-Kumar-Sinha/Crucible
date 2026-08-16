use thiserror::Error;

#[derive(Error, Debug)]
pub enum SandboxError {
    #[error("I/O error during sandbox operation: {0}")]
    Io(#[from] std::io::Error),

    #[error("cgroup v2 is not mounted or available at '{path}'")]
    CgroupNotMounted { path: String },

    #[error("cgroup creation failed at '{path}': {reason}")]
    CreationFailed { path: String, reason: String },

    #[error("failed to apply limit '{limit_name}'='{value}' to cgroup '{path}': {reason}")]
    LimitApplyFailed {
        limit_name: &'static str,
        value: String,
        path: String,
        reason: String,
    },

    #[error("failed to attach PID {pid} to cgroup '{path}': {reason}")]
    AttachPidFailed {
        pid: u32,
        path: String,
        reason: String,
    },

    #[error("cgroup teardown failed at '{path}' (resource leak alert): {reason}")]
    TeardownFailed { path: String, reason: String },

    #[error("cgroup pool exhausted (no available sandbox slots in bulkhead)")]
    PoolExhausted,

    #[error("OverlayFS directory creation failed at '{path}': {reason}")]
    OverlayDirectoryCreationFailed { path: String, reason: String },

    #[error("OverlayFS mount failed for target '{path}': {reason}")]
    OverlayMountFailed { path: String, reason: String },

    #[error("OverlayFS unmount failed for target '{path}' (disk leak alert): {reason}")]
    OverlayUnmountFailed { path: String, reason: String },

    #[error("Network namespace creation failed for '{name}': {reason}")]
    NetnsCreationFailed { name: String, reason: String },

    #[error("Network namespace teardown failed for '{name}': {reason}")]
    NetnsTeardownFailed { name: String, reason: String },

    #[error("nftables rule application failed for table '{table}': {reason}")]
    NftablesApplyFailed { table: String, reason: String },

    #[error("CRITICAL SECURITY INCIDENT: Sandbox network policy enforcement failed: {message}")]
    NetworkSecurityIncident { message: String },

    #[error("Sandbox port forwarding failed for '{sandbox_id}': {reason}")]
    PortForwardFailed { sandbox_id: String, reason: String },

    #[error("CRITICAL SECURITY INCIDENT: Sandbox isolation boundary violation: {message}")]
    IsolationViolation { message: String },
}
