use crucible_sandbox::OverlayFsManager;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("\n================================================================================");
    println!("⚡ CRUCIBLE CONCURRENT PARALLEL OVERLAYFS ISOLATION VERIFICATION");
    println!("================================================================================\n");

    let temp_root =
        std::env::temp_dir().join(format!("crucible_parallel_overlay_{}", std::process::id()));
    let base_workspace = temp_root.join("base_repo");
    fs::create_dir_all(&base_workspace)?;

    // 1. Create initial shared file in base workspace (lowerdir)
    let shared_filename = "shared_config.json";
    let initial_content = "{\"status\": \"pristine_initial_state\", \"counter\": 0}";
    let mut f = File::create(base_workspace.join(shared_filename))?;
    f.write_all(initial_content.as_bytes())?;

    let manager = Arc::new(OverlayFsManager::new(temp_root.join("overlays")));
    println!("[1] Base Pristine Workspace: {}", base_workspace.display());
    println!(
        "[2] OverlayFS Manager Path:   {}",
        manager.base_path().display()
    );
    println!(
        "[3] Spawning 2 concurrent sandboxed processes writing to '{}'...\n",
        shared_filename
    );

    let base_ws_a = base_workspace.clone();
    let base_ws_b = base_workspace.clone();
    let manager_a = Arc::clone(&manager);
    let manager_b = Arc::clone(&manager);

    // Track instance paths for post-execution cleanup verification
    let (tx_a, rx_a) = tokio::sync::oneshot::channel::<PathBuf>();
    let (tx_b, rx_b) = tokio::sync::oneshot::channel::<PathBuf>();

    // Process A: Writes unique content to shared_config.json
    let task_a = tokio::spawn(async move {
        let guard_a = manager_a
            .create_overlay("process_a", std::slice::from_ref(&base_ws_a))
            .expect("Failed to create OverlayFS for Process A");

        let merged_file = guard_a.merged_path().join("shared_config.json");
        let instance_dir = guard_a.merged_path().parent().unwrap().to_path_buf();
        let _ = tx_a.send(instance_dir.clone());

        println!(
            "[Process A] Mounted overlay at: {}",
            guard_a.merged_path().display()
        );
        println!("[Process A] Writing 'MUTATION_PROCESS_A' to shared_config.json");
        fs::write(&merged_file, "MUTATION_PROCESS_A").expect("Process A write failed");

        // Small delay to ensure concurrent overlap
        tokio::time::sleep(Duration::from_millis(50)).await;

        let read_back = fs::read_to_string(&merged_file).expect("Process A read failed");
        println!("[Process A] Read back content: '{}'", read_back);

        assert_eq!(read_back, "MUTATION_PROCESS_A");
        println!("[Process A] Completed execution. Dropping guard...");
        drop(guard_a);
    });

    // Process B: Writes different unique content to the same shared_config.json
    let task_b = tokio::spawn(async move {
        let guard_b = manager_b
            .create_overlay("process_b", std::slice::from_ref(&base_ws_b))
            .expect("Failed to create OverlayFS for Process B");

        let merged_file = guard_b.merged_path().join("shared_config.json");
        let instance_dir = guard_b.merged_path().parent().unwrap().to_path_buf();
        let _ = tx_b.send(instance_dir.clone());

        println!(
            "[Process B] Mounted overlay at: {}",
            guard_b.merged_path().display()
        );
        println!("[Process B] Writing 'MUTATION_PROCESS_B' to shared_config.json");
        fs::write(&merged_file, "MUTATION_PROCESS_B").expect("Process B write failed");

        // Small delay to ensure concurrent overlap
        tokio::time::sleep(Duration::from_millis(50)).await;

        let read_back = fs::read_to_string(&merged_file).expect("Process B read failed");
        println!("[Process B] Read back content: '{}'", read_back);

        assert_eq!(read_back, "MUTATION_PROCESS_B");
        println!("[Process B] Completed execution. Dropping guard...");
        drop(guard_b);
    });

    // Wait for both concurrent tasks to complete
    let (res_a, res_b) = tokio::join!(task_a, task_b);
    res_a?;
    res_b?;

    println!("\n-------------------------------------------------------------");
    println!("🔍 VERIFYING ISOLATION AND CLEANUP RESULTS");
    println!("-------------------------------------------------------------");

    // 1. Verify shared base file is 100% untouched
    let lower_read = fs::read_to_string(base_workspace.join(shared_filename))?;
    println!("[Base Lowerdir] Shared file content: '{}'", lower_read);
    assert_eq!(
        lower_read, initial_content,
        "Lower base directory MUST remain untouched"
    );
    println!("✅ VERIFIED: Base lowerdir remained completely unmodified & pristine!");

    // 2. Verify both ephemeral overlay instances were unmounted and deleted on Drop
    let dir_a = rx_a.await?;
    let dir_b = rx_b.await?;

    println!(
        "[Teardown Check A] Path exists: {} ({})",
        dir_a.exists(),
        dir_a.display()
    );
    println!(
        "[Teardown Check B] Path exists: {} ({})",
        dir_b.exists(),
        dir_b.display()
    );

    assert!(
        !dir_a.exists(),
        "Process A overlay directory must be cleanly removed on Drop"
    );
    assert!(
        !dir_b.exists(),
        "Process B overlay directory must be cleanly removed on Drop"
    );
    println!("✅ VERIFIED: Both OverlayFS instances unmounted and cleaned up with 0 disk leaks!");

    // Cleanup root
    let _ = fs::remove_dir_all(&temp_root);

    println!("\n================================================================================");
    println!("🎉 ALL PARALLEL OVERLAYFS ISOLATION VERIFICATIONS PASSED!");
    println!("================================================================================\n");

    Ok(())
}
