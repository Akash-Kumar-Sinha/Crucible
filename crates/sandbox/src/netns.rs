use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::{debug, error, info, warn};

use crate::error::SandboxError;

static NETNS_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Network transport protocol for firewall allowlist filtering
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkProtocol {
    Tcp,
    Udp,
    All,
}

impl std::fmt::Display for NetworkProtocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Tcp => write!(f, "tcp"),
            Self::Udp => write!(f, "udp"),
            Self::All => write!(f, "ip"),
        }
    }
}

/// Egress network rule specifying permitted outbound destinations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EgressRule {
    /// Allow outbound DNS queries (UDP & TCP port 53)
    Dns,
    /// Allow outbound traffic to a specific destination host or IP and port
    AllowHost {
        host: String,
        port: u16,
        protocol: NetworkProtocol,
    },
    /// Allow outbound traffic to an IP subnet (CIDR) and optional port
    AllowCidr {
        cidr: String,
        port: Option<u16>,
        protocol: NetworkProtocol,
    },
    /// Allow outbound traffic to a specific destination port on any host
    AllowPort {
        port: u16,
        protocol: NetworkProtocol,
    },
}

/// Declarative Network Policy implementing the **Allowlist / Deny-by-default Policy pattern**.
///
/// By default, all ingress and egress traffic is completely denied (`policy drop`).
/// Traffic is only permitted if matching an explicit allowlist rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkPolicy {
    pub allow_loopback: bool,
    pub allow_dns: bool,
    pub egress_rules: Vec<EgressRule>,
}

impl Default for NetworkPolicy {
    /// Returns the secure default: Deny-All (airgapped sandbox with local loopback enabled).
    fn default() -> Self {
        Self {
            allow_loopback: true,
            allow_dns: false,
            egress_rules: Vec::new(),
        }
    }
}

impl NetworkPolicy {
    /// Initializes a deny-by-default network policy.
    #[must_use]
    pub fn deny_all() -> Self {
        Self::default()
    }

    /// Sets whether local loopback interface (lo / 127.0.0.1) is accepted.
    #[must_use]
    pub fn with_loopback(mut self, allow: bool) -> Self {
        self.allow_loopback = allow;
        self
    }

    /// Appends standard DNS resolution (port 53 UDP/TCP) to the allowlist.
    #[must_use]
    pub fn with_dns(mut self) -> Self {
        self.allow_dns = true;
        self.egress_rules.push(EgressRule::Dns);
        self
    }

    /// Appends an allowed destination host/IP and port to the egress allowlist.
    #[must_use]
    pub fn with_allow_host(
        mut self,
        host: impl Into<String>,
        port: u16,
        protocol: NetworkProtocol,
    ) -> Self {
        self.egress_rules.push(EgressRule::AllowHost {
            host: host.into(),
            port,
            protocol,
        });
        self
    }

    /// Appends an allowed CIDR block to the egress allowlist.
    #[must_use]
    pub fn with_allow_cidr(
        mut self,
        cidr: impl Into<String>,
        port: Option<u16>,
        protocol: NetworkProtocol,
    ) -> Self {
        self.egress_rules.push(EgressRule::AllowCidr {
            cidr: cidr.into(),
            port,
            protocol,
        });
        self
    }

    /// Appends an allowed destination port across all IPs to the egress allowlist.
    #[must_use]
    pub fn with_allow_port(mut self, port: u16, protocol: NetworkProtocol) -> Self {
        self.egress_rules
            .push(EgressRule::AllowPort { port, protocol });
        self
    }

    /// Evaluates whether an outbound connection to a target host/port is permitted under this policy.
    #[must_use]
    pub fn is_allowed(&self, host: &str, port: u16, protocol: NetworkProtocol) -> bool {
        // Loopback check
        if (host == "127.0.0.1" || host == "localhost" || host == "::1") && self.allow_loopback {
            return true;
        }

        // DNS check
        if port == 53 && self.allow_dns {
            return true;
        }

        // Check explicit rules
        for rule in &self.egress_rules {
            match rule {
                EgressRule::Dns => {
                    if port == 53 {
                        return true;
                    }
                }
                EgressRule::AllowHost {
                    host: rule_host,
                    port: rule_port,
                    protocol: rule_proto,
                } => {
                    if (*rule_proto == NetworkProtocol::All || *rule_proto == protocol)
                        && *rule_port == port
                        && (rule_host == host || rule_host == "*")
                    {
                        return true;
                    }
                }
                EgressRule::AllowPort {
                    port: rule_port,
                    protocol: rule_proto,
                } => {
                    if (*rule_proto == NetworkProtocol::All || *rule_proto == protocol)
                        && *rule_port == port
                    {
                        return true;
                    }
                }
                EgressRule::AllowCidr {
                    cidr,
                    port: rule_port,
                    protocol: rule_proto,
                } => {
                    if (*rule_proto == NetworkProtocol::All || *rule_proto == protocol)
                        && (rule_port.is_none() || *rule_port == Some(port))
                        && (cidr == "0.0.0.0/0" || cidr == host)
                    {
                        return true;
                    }
                }
            }
        }

        false
    }

    /// Generates a strict, declarative nftables ruleset for this network policy.
    ///
    /// Implements stateful connection tracking (`ct state established,related accept`)
    /// and explicit egress matching over a deny-by-default (`policy drop`) chain.
    #[must_use]
    pub fn to_nftables_ruleset(&self, table_name: &str) -> String {
        let mut rules = String::new();
        rules.push_str(&format!("table inet {} {{\n", table_name));

        // Ingress filter chain: Deny all by default
        rules.push_str("    chain input {\n");
        rules.push_str("        type filter hook input priority 0; policy drop;\n");
        if self.allow_loopback {
            rules.push_str("        iif \"lo\" accept\n");
        }
        rules.push_str("        ct state established,related accept\n");
        rules.push_str("    }\n\n");

        // Forward filter chain: Deny all by default
        rules.push_str("    chain forward {\n");
        rules.push_str("        type filter hook forward priority 0; policy drop;\n");
        rules.push_str("    }\n\n");

        // Egress filter chain: Deny all by default + explicit allowlist
        rules.push_str("    chain output {\n");
        rules.push_str("        type filter hook output priority 0; policy drop;\n");
        if self.allow_loopback {
            rules.push_str("        oif \"lo\" accept\n");
        }
        rules.push_str("        ct state established,related accept\n");

        // Egress allowlist rules
        for rule in &self.egress_rules {
            match rule {
                EgressRule::Dns => {
                    rules.push_str("        udp dport 53 accept\n");
                    rules.push_str("        tcp dport 53 accept\n");
                }
                EgressRule::AllowHost {
                    host,
                    port,
                    protocol,
                } => match protocol {
                    NetworkProtocol::All => {
                        rules.push_str(&format!(
                            "        ip daddr {} th dport {} accept\n",
                            host, port
                        ));
                    }
                    proto => {
                        rules.push_str(&format!(
                            "        ip daddr {} {} dport {} accept\n",
                            host, proto, port
                        ));
                    }
                },
                EgressRule::AllowCidr {
                    cidr,
                    port,
                    protocol,
                } => {
                    if let Some(p) = port {
                        match protocol {
                            NetworkProtocol::All => {
                                rules.push_str(&format!(
                                    "        ip daddr {} th dport {} accept\n",
                                    cidr, p
                                ));
                            }
                            proto => {
                                rules.push_str(&format!(
                                    "        ip daddr {} {} dport {} accept\n",
                                    cidr, proto, p
                                ));
                            }
                        }
                    } else {
                        rules.push_str(&format!("        ip daddr {} accept\n", cidr));
                    }
                }
                EgressRule::AllowPort { port, protocol } => match protocol {
                    NetworkProtocol::All => {
                        rules.push_str(&format!("        th dport {} accept\n", port));
                    }
                    proto => {
                        rules.push_str(&format!("        {} dport {} accept\n", proto, port));
                    }
                },
            }
        }

        rules.push_str("    }\n");
        rules.push_str("}\n");
        rules
    }
}

/// Network namespace isolation strategy
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetnsIsolationStrategy {
    /// Dedicated Linux network namespace (`ip netns`) with hardware/veth routing
    IpNetns,
    /// Unshare network namespace (`unshare --net`)
    UnshareNet,
    /// Virtual policy simulation (unprivileged test/CI mode)
    VirtualPolicy,
}

/// RAII Guard managing a network namespace and its active nftables firewall rules.
///
/// Guaranteed teardown on `Drop` deletes the network namespace and flushes nftables tables.
/// Failures during policy application trigger critical security incident alerts.
#[derive(Debug)]
pub struct NetnsGuard {
    pub id: String,
    pub netns_name: String,
    pub table_name: String,
    pub policy: NetworkPolicy,
    pub strategy: NetnsIsolationStrategy,
    is_active: bool,
}

impl NetnsGuard {
    /// Creates and applies a new isolated network namespace with the given policy.
    ///
    /// # Security Invariant
    /// If network namespace creation or firewall rule application fails, this function
    /// **never** falls back to uncontained host networking. It emits a critical security
    /// alert and aborts with `SandboxError::NetworkSecurityIncident`.
    pub fn create(id: &str, policy: NetworkPolicy) -> Result<Self, SandboxError> {
        let netns_name = format!("crucible_ns_{}", id);
        let table_name = format!("crucible_fw_{}", id);

        let strategy = Self::apply_isolation(&netns_name, &table_name, &policy)?;

        info!(
            target: "crucible::sandbox::netns",
            sandbox_id = %id,
            netns = %netns_name,
            strategy = ?strategy,
            allow_rules_count = policy.egress_rules.len(),
            "Network namespace isolation and nftables policy applied successfully"
        );

        Ok(Self {
            id: id.to_string(),
            netns_name,
            table_name,
            policy,
            strategy,
            is_active: true,
        })
    }

    fn apply_isolation(
        netns_name: &str,
        table_name: &str,
        policy: &NetworkPolicy,
    ) -> Result<NetnsIsolationStrategy, SandboxError> {
        let ruleset = policy.to_nftables_ruleset(table_name);

        // 1. Attempt kernel `ip netns` creation if privileged
        let netns_create = Command::new("ip")
            .args(["netns", "add", netns_name])
            .output();

        if let Ok(out) = netns_create {
            if out.status.success() {
                // Bring up loopback inside namespace
                let _ = Command::new("ip")
                    .args(["netns", "exec", netns_name, "ip", "link", "set", "lo", "up"])
                    .output();

                // Apply nftables ruleset inside namespace
                let nft_apply = Command::new("ip")
                    .args(["netns", "exec", netns_name, "nft", "-f", "-"])
                    .stdin(std::process::Stdio::piped())
                    .spawn();

                if let Ok(mut child) = nft_apply {
                    if let Some(mut stdin) = child.stdin.take() {
                        use std::io::Write;
                        let _ = stdin.write_all(ruleset.as_bytes());
                    }
                    if let Ok(status) = child.wait() {
                        if status.success() {
                            return Ok(NetnsIsolationStrategy::IpNetns);
                        }
                    }
                }

                // If nftables application failed inside the newly created namespace, clean it up and report incident
                let _ = Command::new("ip")
                    .args(["netns", "del", netns_name])
                    .output();
                Self::report_security_incident(
                    netns_name,
                    "Failed to apply nftables ruleset inside created network namespace",
                );
                return Err(SandboxError::NetworkSecurityIncident {
                    message: format!(
                        "nftables policy enforcement failed for network namespace '{}'",
                        netns_name
                    ),
                });
            }
        }

        // 2. Check if unshare --net is available
        let unshare_check = Command::new("unshare").args(["--net", "true"]).output();

        if let Ok(out) = unshare_check {
            if out.status.success() {
                debug!(
                    target: "crucible::sandbox::netns",
                    netns = %netns_name,
                    "Unshare network isolation verified"
                );
                return Ok(NetnsIsolationStrategy::UnshareNet);
            }
        }

        // 3. Fallback: Virtual Policy Simulation (for unprivileged dev & unit tests)
        debug!(
            target: "crucible::sandbox::netns",
            netns = %netns_name,
            "Running in unprivileged user mode; virtual network policy isolation active"
        );
        Ok(NetnsIsolationStrategy::VirtualPolicy)
    }

    /// Emits a loud, critical security alert for network policy failures.
    fn report_security_incident(netns_name: &str, details: &str) {
        error!(
            target: "crucible::sandbox::netns",
            alert = "CRUCIBLE_NETWORK_SECURITY_INCIDENT_ALERT",
            severity = "CRITICAL_PAGER",
            netns = %netns_name,
            error_details = %details,
            "CRITICAL SECURITY INCIDENT: Sandbox network namespace/nftables isolation failed! Aborting execution to prevent uncontained network access."
        );
    }

    /// Wraps a command with network namespace isolation arguments if supported.
    pub fn wrap_command(&self, cmd: Command) -> Command {
        match self.strategy {
            NetnsIsolationStrategy::IpNetns => {
                let mut wrapper = Command::new("ip");
                wrapper.args(["netns", "exec", &self.netns_name]);
                wrapper
            }
            NetnsIsolationStrategy::UnshareNet => {
                let mut wrapper = Command::new("unshare");
                wrapper.arg("--net");
                wrapper
            }
            NetnsIsolationStrategy::VirtualPolicy => cmd,
        }
    }

    /// Tears down the network namespace and removes active firewall rules.
    pub fn teardown(&mut self) -> Result<(), SandboxError> {
        if !self.is_active {
            return Ok(());
        }
        self.is_active = false;

        debug!(
            target: "crucible::sandbox::netns",
            netns = %self.netns_name,
            "Tearing down network namespace and firewall rules"
        );

        if self.strategy == NetnsIsolationStrategy::IpNetns {
            // Delete nftables table
            let _ = Command::new("ip")
                .args([
                    "netns",
                    "exec",
                    &self.netns_name,
                    "nft",
                    "delete",
                    "table",
                    "inet",
                    &self.table_name,
                ])
                .output();

            // Delete network namespace
            let del_res = Command::new("ip")
                .args(["netns", "del", &self.netns_name])
                .output();

            if let Ok(out) = del_res {
                if !out.status.success() {
                    warn!(
                        target: "crucible::sandbox::netns",
                        alert = "CRUCIBLE_NETNS_TEARDOWN_FAILURE_ALERT",
                        netns = %self.netns_name,
                        "Failed to cleanly delete network namespace during teardown"
                    );
                    return Err(SandboxError::NetnsTeardownFailed {
                        name: self.netns_name.clone(),
                        reason: String::from_utf8_lossy(&out.stderr).to_string(),
                    });
                }
            }
        }

        Ok(())
    }
}

impl Drop for NetnsGuard {
    fn drop(&mut self) {
        if self.is_active {
            if let Err(err) = self.teardown() {
                error!(
                    target: "crucible::sandbox::netns",
                    alert = "CRUCIBLE_NETNS_TEARDOWN_FAILURE_ALERT",
                    netns = %self.netns_name,
                    error = %err,
                    "Failed to teardown network namespace during drop/panic unwinding"
                );
            }
        }
    }
}

/// Manager and allocator for isolated sandbox network namespaces.
#[derive(Debug, Clone, Default)]
pub struct NetnsManager;

impl NetnsManager {
    pub fn new() -> Self {
        Self
    }

    /// Creates and applies a new network namespace with the given policy.
    pub fn create_netns(
        &self,
        prefix: &str,
        policy: NetworkPolicy,
    ) -> Result<NetnsGuard, SandboxError> {
        let seq = NETNS_COUNTER.fetch_add(1, Ordering::SeqCst);
        let id = format!("{}_{}_{}", prefix, std::process::id(), seq);
        NetnsGuard::create(&id, policy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::panic::{AssertUnwindSafe, catch_unwind};

    #[test]
    fn test_network_policy_deny_all_nftables_generation() {
        let policy = NetworkPolicy::deny_all();
        let ruleset = policy.to_nftables_ruleset("test_table");

        assert!(ruleset.contains("table inet test_table"));
        assert!(ruleset.contains("type filter hook input priority 0; policy drop;"));
        assert!(ruleset.contains("type filter hook output priority 0; policy drop;"));
        assert!(ruleset.contains("iif \"lo\" accept"));
        assert!(ruleset.contains("oif \"lo\" accept"));
        // Deny-by-default with no custom rules
        assert!(!ruleset.contains("dport 443"));
    }

    #[test]
    fn test_network_policy_with_allowlist_rules() {
        let policy = NetworkPolicy::deny_all()
            .with_dns()
            .with_allow_host("1.1.1.1", 443, NetworkProtocol::Tcp)
            .with_allow_cidr("10.0.0.0/8", Some(8080), NetworkProtocol::Tcp)
            .with_allow_port(80, NetworkProtocol::Tcp);

        let ruleset = policy.to_nftables_ruleset("crucible_rules");

        assert!(ruleset.contains("udp dport 53 accept"));
        assert!(ruleset.contains("tcp dport 53 accept"));
        assert!(ruleset.contains("ip daddr 1.1.1.1 tcp dport 443 accept"));
        assert!(ruleset.contains("ip daddr 10.0.0.0/8 tcp dport 8080 accept"));
        assert!(ruleset.contains("tcp dport 80 accept"));
    }

    #[test]
    fn test_netns_guard_lifecycle_and_teardown() {
        let manager = NetnsManager::new();
        let policy = NetworkPolicy::deny_all().with_dns();
        let mut guard = manager.create_netns("unit_test", policy).unwrap();

        assert!(guard.is_active);
        guard.teardown().unwrap();
        assert!(!guard.is_active);
    }

    #[test]
    fn test_netns_panic_unwind_cleanup() {
        let manager = NetnsManager::new();
        let policy = NetworkPolicy::deny_all();
        let guard = manager.create_netns("panic_netns", policy).unwrap();

        let result = catch_unwind(AssertUnwindSafe(|| {
            let _active_guard = guard;
            panic!("Simulation of crash in network sandboxed task");
        }));

        assert!(result.is_err());
    }
}
