use crate::cgroups::CgroupLimits;
use crate::netns::{EgressRule, NetworkPolicy, NetworkProtocol};

/// Seccomp syscall filtering tier for compute isolation
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SeccompTier {
    /// Standard container baseline: blocks dangerous root/kernel operations
    Standard,
    /// Strict red-team audit tier: blocks ptrace, raw sockets, bpf, keyctl, user namespaces
    Strict,
}

/// Strategy pattern: Named sandbox execution profile configured per agent role
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SandboxProfile {
    pub name: String,
    pub role: String,
    pub cgroup_limits: CgroupLimits,
    pub air_gapped: bool,
    pub read_only_root: bool,
    pub seccomp_tier: SeccompTier,
    pub blocked_syscalls: Vec<String>,
    pub max_execution_timeout_secs: u64,
}

impl SandboxProfile {
    /// Standard sandbox profile for general coding, test writing, and bug fixing
    pub fn standard() -> Self {
        Self {
            name: "standard".to_string(),
            role: "coder".to_string(),
            cgroup_limits: CgroupLimits {
                cpu_quota_us: Some(100_000), // 1.0 CPU core
                cpu_period_us: Some(100_000),
                memory_max_bytes: Some(512 * 1024 * 1024), // 512 MB
                pids_max: Some(128),
            },
            air_gapped: false,
            read_only_root: false,
            seccomp_tier: SeccompTier::Standard,
            blocked_syscalls: vec![
                "pivot_root".to_string(),
                "reboot".to_string(),
                "kexec_load".to_string(),
                "init_module".to_string(),
                "delete_module".to_string(),
            ],
            max_execution_timeout_secs: 60,
        }
    }

    /// Hardened adversarial profile for Bug Hunter security testing & vulnerability probing
    pub fn restricted_bug_hunter() -> Self {
        Self {
            name: "restricted_bug_hunter".to_string(),
            role: "bug_hunter".to_string(),
            cgroup_limits: CgroupLimits {
                cpu_quota_us: Some(50_000), // 0.5 CPU core (strict throttle)
                cpu_period_us: Some(100_000),
                memory_max_bytes: Some(256 * 1024 * 1024), // 256 MB (tight memory limit)
                pids_max: Some(32),                        // 32 tasks max to block fork bombs
            },
            air_gapped: true,     // Deny all network egress by default
            read_only_root: true, // Read-only filesystem
            seccomp_tier: SeccompTier::Strict,
            blocked_syscalls: vec![
                "ptrace".to_string(),
                "bpf".to_string(),
                "socket_raw".to_string(),
                "keyctl".to_string(),
                "clone_newuser".to_string(),
                "unshare".to_string(),
                "setns".to_string(),
                "mount".to_string(),
                "umount2".to_string(),
                "pivot_root".to_string(),
                "reboot".to_string(),
                "kexec_load".to_string(),
                "init_module".to_string(),
                "delete_module".to_string(),
            ],
            max_execution_timeout_secs: 30, // Shorter 30s timeout for safety
        }
    }

    /// Select sandbox profile based on agent role
    pub fn for_role(role: &str) -> Self {
        match role.to_lowercase().as_str() {
            "bug_hunter" | "bughunter" | "adversarial" | "red_team" => {
                Self::restricted_bug_hunter()
            }
            "coder" => {
                let mut p = Self::standard();
                p.role = "coder".to_string();
                p
            }
            "test_writer" => {
                let mut p = Self::standard();
                p.role = "test_writer".to_string();
                p
            }
            "bug_fixer" => {
                let mut p = Self::standard();
                p.role = "bug_fixer".to_string();
                p
            }
            _ => Self::standard(),
        }
    }

    /// Build corresponding NetworkPolicy for this profile
    pub fn build_network_policy(&self) -> NetworkPolicy {
        if self.air_gapped {
            NetworkPolicy::deny_all()
        } else {
            NetworkPolicy {
                allow_loopback: true,
                allow_dns: true,
                egress_rules: vec![
                    EgressRule::AllowPort {
                        port: 443,
                        protocol: NetworkProtocol::Tcp,
                    },
                    EgressRule::AllowPort {
                        port: 80,
                        protocol: NetworkProtocol::Tcp,
                    },
                ],
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_standard_profile_defaults() {
        let p = SandboxProfile::standard();
        expect_eq(p.air_gapped, false);
        expect_eq(p.read_only_root, false);
        expect_eq(p.cgroup_limits.memory_max_bytes, Some(512 * 1024 * 1024));
        expect_eq(p.cgroup_limits.pids_max, Some(128));
        let net = p.build_network_policy();
        expect_eq(net.allow_dns, true);
        expect_eq(net.egress_rules.len(), 2);
    }

    #[test]
    fn test_bug_hunter_profile_hardening() {
        let p = SandboxProfile::for_role("bug_hunter");
        expect_eq(p.air_gapped, true);
        expect_eq(p.read_only_root, true);
        expect_eq(p.seccomp_tier, SeccompTier::Strict);
        expect_eq(p.cgroup_limits.memory_max_bytes, Some(256 * 1024 * 1024));
        expect_eq(p.cgroup_limits.pids_max, Some(32));
        expect_eq(p.cgroup_limits.cpu_quota_us, Some(50_000));
        assert!(p.blocked_syscalls.contains(&"ptrace".to_string()));
        assert!(p.blocked_syscalls.contains(&"bpf".to_string()));

        let net = p.build_network_policy();
        expect_eq(net.allow_dns, false);
        expect_eq(net.egress_rules.is_empty(), true);
    }

    fn expect_eq<T: std::fmt::Debug + PartialEq>(a: T, b: T) {
        assert_eq!(a, b);
    }
}
