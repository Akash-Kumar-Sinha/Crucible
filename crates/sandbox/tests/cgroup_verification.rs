use crucible_sandbox::{CgroupLimits, CgroupManager};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::process::Command;

#[tokio::test]
async fn test_cgroup_teardown_on_panic_unwind() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let manager = CgroupManager::new(temp_dir.path());
    let limits = CgroupLimits::new()
        .with_cpu_limit(25_000, 100_000)
        .with_memory_limit_bytes(64 * 1024 * 1024)
        .with_pids_max(16);

    let guard = manager.create_sandbox("panic_test", limits).unwrap();
    let cgroup_dir = guard.path.clone();

    assert!(cgroup_dir.exists(), "Cgroup directory must exist initially");

    // Deliberately trigger panic with guard in scope
    let result = catch_unwind(AssertUnwindSafe(|| {
        let _active_guard = guard;
        panic!("Simulated agent task crash / panic mid-run");
    }));

    assert!(
        result.is_err(),
        "Panic should have occurred and been caught"
    );
    // Verify RAII Drop executed during stack unwinding and deleted the cgroup directory
    assert!(
        !cgroup_dir.exists(),
        "Cgroup directory must be deleted on Drop during panic unwinding (zero resource leak)"
    );
}

#[tokio::test]
async fn test_cgroup_force_kill_and_cleanup() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let manager = CgroupManager::new(temp_dir.path());
    let limits = CgroupLimits::default();

    let mut guard = manager.create_sandbox("kill_test", limits).unwrap();
    let cgroup_dir = guard.path.clone();

    assert!(cgroup_dir.exists());

    // Explicit teardown kills any lingering tasks and removes the directory
    guard.teardown().unwrap();
    assert!(
        !cgroup_dir.exists(),
        "Cgroup directory must be gone after teardown"
    );
}

#[tokio::test]
async fn test_process_execution_with_cgroup_isolation() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let manager = CgroupManager::new(temp_dir.path());
    let limits = CgroupLimits::new()
        .with_cpu_limit(50_000, 100_000)
        .with_memory_limit_bytes(128 * 1024 * 1024)
        .with_pids_max(32);

    let guard = manager.create_sandbox("isolation_run", limits).unwrap();
    let guard_path = guard.path.clone();

    let mut child = Command::new("echo")
        .arg("bulkhead_isolation_ok")
        .spawn()
        .expect("Failed to spawn process");

    let pid = child.id();
    guard.attach_pid(pid).unwrap();
    let status = child.wait().unwrap();

    assert!(status.success());
    drop(guard);
    assert!(
        !guard_path.exists(),
        "Cgroup must be cleaned up on process drop"
    );
}
