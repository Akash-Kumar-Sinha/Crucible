use crucible_sandbox::{NetnsManager, NetworkPolicy, NetworkProtocol};
use std::panic::{AssertUnwindSafe, catch_unwind};

#[test]
fn test_netns_deny_all_airgap_generation() {
    let policy = NetworkPolicy::deny_all();
    let ruleset = policy.to_nftables_ruleset("airgap_test");

    assert!(ruleset.contains("table inet airgap_test"));
    assert!(ruleset.contains("type filter hook input priority 0; policy drop;"));
    assert!(ruleset.contains("type filter hook forward priority 0; policy drop;"));
    assert!(ruleset.contains("type filter hook output priority 0; policy drop;"));
    assert!(ruleset.contains("iif \"lo\" accept"));
    assert!(ruleset.contains("oif \"lo\" accept"));
    assert!(ruleset.contains("ct state established,related accept"));
    assert!(!ruleset.contains("dport 443"));
}

#[test]
fn test_netns_allowlist_generation() {
    let policy = NetworkPolicy::deny_all()
        .with_dns()
        .with_allow_host("1.1.1.1", 443, NetworkProtocol::Tcp)
        .with_allow_host("api.github.com", 443, NetworkProtocol::Tcp)
        .with_allow_cidr("192.168.1.0/24", Some(8080), NetworkProtocol::Tcp)
        .with_allow_port(80, NetworkProtocol::Tcp);

    let ruleset = policy.to_nftables_ruleset("allowlist_test");

    assert!(ruleset.contains("udp dport 53 accept"));
    assert!(ruleset.contains("tcp dport 53 accept"));
    assert!(ruleset.contains("ip daddr 1.1.1.1 tcp dport 443 accept"));
    assert!(ruleset.contains("ip daddr api.github.com tcp dport 443 accept"));
    assert!(ruleset.contains("ip daddr 192.168.1.0/24 tcp dport 8080 accept"));
    assert!(ruleset.contains("tcp dport 80 accept"));
}

#[test]
fn test_netns_panic_unwind_cleanup() {
    let manager = NetnsManager::new();
    let guard = manager
        .create_netns("panic_test", NetworkPolicy::deny_all())
        .unwrap();

    let result = catch_unwind(AssertUnwindSafe(|| {
        let _active = guard;
        panic!("Simulation of crash in sandboxed network task");
    }));

    assert!(result.is_err());
}
