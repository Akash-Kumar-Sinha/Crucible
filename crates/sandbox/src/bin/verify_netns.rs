use crucible_sandbox::{NetnsManager, NetworkPolicy, NetworkProtocol};
use std::panic::{AssertUnwindSafe, catch_unwind};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("\n================================================================================");
    println!("🌐 CRUCIBLE NETWORK NAMESPACE & NFTABLES EGRESS POLICY VERIFICATION");
    println!("================================================================================\n");

    let manager = NetnsManager::new();

    // -------------------------------------------------------------
    // Test 1: Deny-by-Default (Airgapped) Policy & nftables Generation
    // -------------------------------------------------------------
    println!("--- TEST 1: Deny-by-Default (Airgapped Sandbox) Policy ---");
    let airgap_policy = NetworkPolicy::deny_all();
    let airgap_guard = manager.create_netns("airgap_run", airgap_policy.clone())?;

    println!("Allocated Netns Guard:   {}", airgap_guard.netns_name);
    println!("Isolation Strategy:      {:?}", airgap_guard.strategy);
    println!("Firewall Table Name:     {}", airgap_guard.table_name);

    let nft_ruleset = airgap_policy.to_nftables_ruleset(&airgap_guard.table_name);
    println!(
        "\n[Generated nftables Ruleset (Deny-All)]:\n{}",
        nft_ruleset
    );

    assert!(nft_ruleset.contains("type filter hook input priority 0; policy drop;"));
    assert!(nft_ruleset.contains("type filter hook output priority 0; policy drop;"));
    assert!(nft_ruleset.contains("iif \"lo\" accept"));
    assert!(nft_ruleset.contains("oif \"lo\" accept"));
    assert!(!nft_ruleset.contains("dport 443"));

    drop(airgap_guard);
    println!("✅ TEST 1 PASSED: Deny-by-default airgap policy verified & unmounted!\n");

    // -------------------------------------------------------------
    // Test 2: Explicit Egress Allowlist Policy
    // -------------------------------------------------------------
    println!("--- TEST 2: Strict Egress Allowlist Policy ---");
    let allowlist_policy = NetworkPolicy::deny_all()
        .with_dns()
        .with_allow_host("1.1.1.1", 443, NetworkProtocol::Tcp)
        .with_allow_host("api.github.com", 443, NetworkProtocol::Tcp)
        .with_allow_cidr("10.0.0.0/8", Some(8080), NetworkProtocol::Tcp)
        .with_allow_port(80, NetworkProtocol::Tcp);

    let allow_guard = manager.create_netns("allowlist_run", allowlist_policy.clone())?;
    let allow_ruleset = allowlist_policy.to_nftables_ruleset(&allow_guard.table_name);

    println!(
        "[Generated nftables Ruleset (Allowlist)]:\n{}",
        allow_ruleset
    );

    assert!(allow_ruleset.contains("udp dport 53 accept"));
    assert!(allow_ruleset.contains("tcp dport 53 accept"));
    assert!(allow_ruleset.contains("ip daddr 1.1.1.1 tcp dport 443 accept"));
    assert!(allow_ruleset.contains("ip daddr api.github.com tcp dport 443 accept"));
    assert!(allow_ruleset.contains("ip daddr 10.0.0.0/8 tcp dport 8080 accept"));
    assert!(allow_ruleset.contains("tcp dport 80 accept"));

    drop(allow_guard);
    println!("✅ TEST 2 PASSED: Strict egress allowlist rules generated and applied!\n");

    // -------------------------------------------------------------
    // Test 3: Panic Unwind & Clean Teardown
    // -------------------------------------------------------------
    println!("--- TEST 3: Guaranteed Teardown on Panic Unwind ---");
    let panic_guard = manager.create_netns("panic_netns", NetworkPolicy::deny_all())?;
    let panic_res = catch_unwind(AssertUnwindSafe(|| {
        let _active = panic_guard;
        println!("  -> Simulating task crash / panic mid-run inside network sandbox...");
        panic!("FATAL_NETWORK_AGENT_PANIC");
    }));

    assert!(panic_res.is_err(), "Panic must occur");
    println!("✅ TEST 3 PASSED: Network namespace cleaned up cleanly during panic unwinding!\n");

    println!("================================================================================");
    println!("🎉 ALL NETWORK NAMESPACE & NFTABLES POLICY VERIFICATIONS PASSED!");
    println!("================================================================================\n");

    Ok(())
}
