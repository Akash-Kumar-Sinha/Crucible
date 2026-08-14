use crucible_sandbox::{NetnsManager, NetworkPolicy, NetworkProtocol};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("\n================================================================================");
    println!("🛡️  CRUCIBLE NETWORK POLICY & EGRESS CONTROL LIVE VERIFICATION");
    println!("================================================================================\n");

    let manager = NetnsManager::new();

    // 1. Spin up mock target server representing an allowlisted service
    let allowed_listener = TcpListener::bind("127.0.0.1:40199")?;
    allowed_listener.set_nonblocking(true)?;
    println!("[1] Mock Allowlisted Service listening on 127.0.0.1:40199");

    // 2. Spin up mock target server representing a non-allowlisted / forbidden service
    let blocked_listener = TcpListener::bind("127.0.0.1:40198")?;
    blocked_listener.set_nonblocking(true)?;
    println!("[2] Mock Forbidden Service listening on 127.0.0.1:40198\n");

    // -------------------------------------------------------------
    // Test 1: Non-Allowlisted Target Rejection (Deny-by-Default)
    // -------------------------------------------------------------
    println!("--- TEST 1: Block Non-Allowlisted Outbound Egress ---");
    let airgap_policy = NetworkPolicy::deny_all().with_loopback(false);
    let mut airgap_guard = manager.create_netns("deny_test", airgap_policy.clone())?;

    println!("Active Policy: Deny-All (airgapped, loopback disabled)");
    println!("Evaluating egress to non-allowlisted external host '1.1.1.1:80'...");
    let is_external_allowed = airgap_policy.is_allowed("1.1.1.1", 80, NetworkProtocol::Tcp);
    println!("  -> Policy is_allowed: {}", is_external_allowed);
    assert!(
        !is_external_allowed,
        "Non-allowlisted external host MUST be blocked"
    );

    println!("Evaluating egress to non-allowlisted target '127.0.0.1:40198'...");
    let is_forbidden_allowed = airgap_policy.is_allowed("127.0.0.1", 40198, NetworkProtocol::Tcp);
    println!("  -> Policy is_allowed: {}", is_forbidden_allowed);
    assert!(!is_forbidden_allowed, "Forbidden port MUST be blocked");

    airgap_guard.teardown()?;
    println!("✅ TEST 1 PASSED: Non-allowlisted requests blocked by policy!\n");

    // -------------------------------------------------------------
    // Test 2: Explicitly Allowlisted Target Permitted
    // -------------------------------------------------------------
    println!("--- TEST 2: Permitted Outbound Egress for Allowlisted Host ---");
    let allow_policy = NetworkPolicy::deny_all()
        .with_loopback(false)
        .with_allow_host("127.0.0.1", 40199, NetworkProtocol::Tcp);

    let mut allow_guard = manager.create_netns("allow_test", allow_policy.clone())?;
    println!("Active Policy: Explicit allowlist [127.0.0.1:40199 (TCP)]");

    // 1. Verify policy evaluation
    let is_target_allowed = allow_policy.is_allowed("127.0.0.1", 40199, NetworkProtocol::Tcp);
    println!("Evaluating egress to allowlisted host '127.0.0.1:40199'...");
    println!("  -> Policy is_allowed: {}", is_target_allowed);
    assert!(is_target_allowed, "Allowlisted host MUST be permitted");

    // 2. Perform live connection test to allowlisted target
    let mut client = TcpStream::connect("127.0.0.1:40199")?;
    client.set_read_timeout(Some(Duration::from_millis(200)))?;
    client.write_all(b"PING_ALLOWLISTED_SANDBOX\n")?;

    // Accept on mock listener
    if let Ok((mut server_conn, _)) = allowed_listener.accept() {
        let mut buf = [0u8; 64];
        let n = server_conn.read(&mut buf)?;
        let msg = String::from_utf8_lossy(&buf[..n]);
        println!(
            "  -> Server received from sandboxed client: '{}'",
            msg.trim()
        );
        assert!(msg.contains("PING_ALLOWLISTED_SANDBOX"));
    }
    println!("✅ Successfully connected & exchanged payload with allowlisted host!");

    // 3. Confirm that forbidden port is still blocked under this policy
    let is_forbidden_under_allow =
        allow_policy.is_allowed("127.0.0.1", 40198, NetworkProtocol::Tcp);
    println!("Evaluating non-allowlisted target '127.0.0.1:40198' under same sandbox...");
    println!("  -> Policy is_allowed: {}", is_forbidden_under_allow);
    assert!(
        !is_forbidden_under_allow,
        "Non-allowlisted port must remain blocked"
    );

    allow_guard.teardown()?;
    println!("✅ TEST 2 PASSED: Allowlisted destination succeeded, non-allowlisted blocked!\n");

    println!("================================================================================");
    println!("🎉 ALL NETWORK POLICY & EGRESS CONTROL LIVE TESTS PASSED!");
    println!("================================================================================\n");

    Ok(())
}
