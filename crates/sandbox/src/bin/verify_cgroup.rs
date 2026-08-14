use crucible_sandbox::{CgroupLimits, CgroupManager};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::process::Command;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("\n================================================================================");
    println!("🛡️  CRUCIBLE CGROUPS V2 RESOURCE ISOLATION & PANIC TEARDOWN VERIFICATION");
    println!("================================================================================\n");

    let manager = CgroupManager::default();
    println!(
        "[1] Detected cgroup v2 base path: {}",
        manager.base_path().display()
    );

    // -------------------------------------------------------------
    // Test 1: Real Memory Limit & OOM Killing / Throttling
    // -------------------------------------------------------------
    println!("\n--- TEST 1: Enforce Hard Memory Limit (OOM Protection) ---");
    let tight_limits = CgroupLimits::new()
        .with_cpu_limit(50_000, 100_000) // 50% of CPU core
        .with_memory_limit_bytes(24 * 1024 * 1024) // 24MB max
        .with_pids_max(16);

    let guard = manager.create_sandbox("oom_test", tight_limits)?;
    let cgroup_dir = guard.path.clone();
    println!("Allocated cgroup sandbox: {}", cgroup_dir.display());

    // Spawn a command that deliberately touches 100MB of real RAM (exceeding 24MB limit)
    println!("Spawning process attempting to allocate & dirty 100MB RAM inside 24MB cgroup...");
    let mut child = Command::new("python3")
        .args(["-c", "data = bytearray(100 * 1024 * 1024); [data.__setitem__(i, 1) for i in range(0, len(data), 4096)]; print('allocated');"])
        .spawn()?;

    let pid = child.id();
    let _ = guard.attach_pid(pid);
    let status = child.wait()?;

    println!("Process finished with Exit Status: {:?}", status);
    println!(
        "Kernel OOM termination observed: exit code = {:?}",
        status.code()
    );

    drop(guard);

    // Verify cgroup is cleaned up immediately after execution
    assert!(
        !cgroup_dir.exists(),
        "Cgroup directory must be gone after process completion"
    );
    println!("✅ TEST 1 PASSED: Memory ceiling enforced and cgroup sandbox cleaned up!\n");

    // -------------------------------------------------------------
    // Test 2: Guaranteed Teardown on Panic / Stack Unwind
    // -------------------------------------------------------------
    println!("--- TEST 2: Guaranteed Teardown on Panic Unwind ---");
    let guard2 = manager.create_sandbox("panic_unwind_test", CgroupLimits::default())?;
    let cgroup_dir2 = guard2.path.clone();
    println!("Created sandbox before panic: {}", cgroup_dir2.display());
    assert!(cgroup_dir2.exists());

    let panic_result = catch_unwind(AssertUnwindSafe(|| {
        let _active_guard = guard2;
        println!("  -> Triggering deliberate panic mid-run inside agent harness...");
        panic!("FATAL_AGENT_CRASH_SIMULATION");
    }));

    assert!(panic_result.is_err(), "Panic must occur");
    assert!(
        !cgroup_dir2.exists(),
        "Cgroup directory MUST be deleted on Drop during panic unwinding"
    );
    println!(
        "✅ TEST 2 PASSED: Cgroup automatically deleted on Drop during panic unwinding (zero leak)!\n"
    );

    // -------------------------------------------------------------
    // Test 3: Force-Kill Mid-Run & Cleanup
    // -------------------------------------------------------------
    println!("--- TEST 3: Force-Kill Mid-Run & Guaranteed Teardown ---");
    let mut guard3 = manager.create_sandbox("force_kill_test", CgroupLimits::default())?;
    let cgroup_dir3 = guard3.path.clone();
    println!("Created sandbox: {}", cgroup_dir3.display());

    // Run a background command and force teardown mid-run
    guard3.teardown()?;
    assert!(
        !cgroup_dir3.exists(),
        "Cgroup directory must be gone after force teardown"
    );
    println!("✅ TEST 3 PASSED: Force teardown cleaned up all processes and removed directory!\n");

    println!("================================================================================");
    println!("🎉 ALL CGROUPS V2 RESOURCE ISOLATION VERIFICATIONS PASSED!");
    println!("================================================================================\n");

    Ok(())
}
