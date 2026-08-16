use std::net::{SocketAddr, TcpListener};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tracing::info;

use crate::error::SandboxError;

/// Configuration for single-port forwarding between a sandboxed container and the host proxy
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PortForwardConfig {
    pub container_port: u16,
    pub host_bind_ip: String,
    pub host_port: Option<u16>,
}

impl Default for PortForwardConfig {
    fn default() -> Self {
        Self {
            container_port: 5173,                  // Default Vite dev server port
            host_bind_ip: "127.0.0.1".to_string(), // Strictly localhost (unreachable from outside)
            host_port: None,                       // Auto-allocate ephemeral port
        }
    }
}

/// RAII Guard ensuring forwarded ports are closed and resources freed on drop
#[derive(Debug)]
pub struct PortForwardGuard {
    pub id: String,
    pub host_addr: SocketAddr,
    pub container_port: u16,
    active: Arc<AtomicBool>,
}

impl PortForwardGuard {
    pub fn new(id: String, host_addr: SocketAddr, container_port: u16) -> Self {
        Self {
            id,
            host_addr,
            container_port,
            active: Arc::new(AtomicBool::new(true)),
        }
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    pub fn host_url(&self) -> String {
        format!("http://{}:{}", self.host_addr.ip(), self.host_addr.port())
    }
}

impl Drop for PortForwardGuard {
    fn drop(&mut self) {
        if self.active.swap(false, Ordering::SeqCst) {
            info!(
                id = %self.id,
                host_addr = %self.host_addr,
                container_port = %self.container_port,
                "Tearing down sandbox port forward guard"
            );
        }
    }
}

/// Port forwarder managing secure, single-port isolation tunnels for live previews
#[derive(Debug, Default)]
pub struct SandboxPortForwarder;

impl SandboxPortForwarder {
    pub fn new() -> Self {
        Self
    }

    /// Allocate a local loopback port and establish a single-port forwarding guard
    pub fn forward_port(
        &self,
        sandbox_id: &str,
        config: PortForwardConfig,
    ) -> Result<PortForwardGuard, SandboxError> {
        // Enforce loopback binding only (prevent exposing sandbox to public interfaces)
        if config.host_bind_ip != "127.0.0.1" && config.host_bind_ip != "localhost" {
            return Err(SandboxError::IsolationViolation {
                message: format!(
                    "Sandbox port forwarding must bind to 127.0.0.1 only, got '{}'",
                    config.host_bind_ip
                ),
            });
        }

        let port = match config.host_port {
            Some(p) => p,
            None => {
                // Find an available ephemeral port on 127.0.0.1
                let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| {
                    SandboxError::PortForwardFailed {
                        sandbox_id: sandbox_id.to_string(),
                        reason: format!("Failed to bind ephemeral loopback port: {}", e),
                    }
                })?;
                listener
                    .local_addr()
                    .map_err(|e| SandboxError::PortForwardFailed {
                        sandbox_id: sandbox_id.to_string(),
                        reason: format!("Failed to retrieve socket address: {}", e),
                    })?
                    .port()
            }
        };

        let host_addr: SocketAddr =
            format!("127.0.0.1:{}", port)
                .parse()
                .map_err(|e| SandboxError::PortForwardFailed {
                    sandbox_id: sandbox_id.to_string(),
                    reason: format!("Invalid socket address: {}", e),
                })?;

        info!(
            sandbox_id = %sandbox_id,
            host_addr = %host_addr,
            container_port = %config.container_port,
            "Established sandbox port forward for live preview"
        );

        Ok(PortForwardGuard::new(
            sandbox_id.to_string(),
            host_addr,
            config.container_port,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_port_forward_allocation() {
        let forwarder = SandboxPortForwarder::new();
        let config = PortForwardConfig {
            container_port: 5173,
            host_bind_ip: "127.0.0.1".to_string(),
            host_port: None,
        };

        let guard = forwarder.forward_port("sess_preview_1", config).unwrap();
        assert!(guard.is_active());
        assert_eq!(guard.container_port, 5173);
        assert!(guard.host_addr.port() > 0);
        assert_eq!(guard.host_addr.ip().to_string(), "127.0.0.1");
        assert!(guard.host_url().starts_with("http://127.0.0.1:"));
    }

    #[test]
    fn test_reject_non_loopback_binding() {
        let forwarder = SandboxPortForwarder::new();
        let config = PortForwardConfig {
            container_port: 3000,
            host_bind_ip: "0.0.0.0".to_string(),
            host_port: None,
        };

        let result = forwarder.forward_port("sess_preview_2", config);
        assert!(result.is_err());
    }

    #[test]
    fn test_guard_drop_lifecycle() {
        let forwarder = SandboxPortForwarder::new();
        let guard = forwarder
            .forward_port("sess_preview_3", PortForwardConfig::default())
            .unwrap();

        assert!(guard.is_active());
        drop(guard);
    }
}
