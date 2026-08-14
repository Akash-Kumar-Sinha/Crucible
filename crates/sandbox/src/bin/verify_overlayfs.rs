use crucible_sandbox::OverlayFsManager;
use std::fs::{self, File};
use std::io::Write;
use std::panic::{AssertUnwindSafe, catch_unwind};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("\n================================================================================");
    println!("📂 CRUCIBLE OVERLAYFS COPY-ON-WRITE & EPHEMERAL ISOLATION VERIFICATION");
    println!("================================================================================\n");

    let temp_root =
        std::env::temp_dir().join(format!("crucible_overlay_verify_{}", std::process::id()));
    let base_workspace = temp_root.join("base_workspace");
    fs::create_dir_all(&base_workspace)?;

    // Create seed files in pristine base workspace (lowerdir)
    let initial_file = base_workspace.join("package.json");
    let mut f = File::create(&initial_file)?;
    f.write_all(b"{\"name\": \"crucible-project\", \"version\": \"1.0.0\"}")?;

    let manager = OverlayFsManager::new(temp_root.join("overlays"));
    println!(
        "[1] Overlay manager initialized at: {}",
        manager.base_path().display()
    );

    // -------------------------------------------------------------
    // Test 1: Copy-on-Write Isolation & File Mutation
    // -------------------------------------------------------------
    println!("\n--- TEST 1: Ephemeral Copy-on-Write Isolation ---");
    let guard = manager.create_overlay("run_isolation", std::slice::from_ref(&base_workspace))?;
    let merged_path = guard.merged_path().to_path_buf();
    let instance_dir = merged_path.parent().unwrap().to_path_buf();

    println!("Mount Strategy active: {:?}", guard.strategy);
    println!("Merged union path:     {}", merged_path.display());
    println!("Upper writable layer:  {}", guard.upper_path().display());

    // 1. Verify read-through
    let merged_file = merged_path.join("package.json");
    assert!(merged_file.exists());
    assert_eq!(
        fs::read_to_string(&merged_file)?,
        "{\"name\": \"crucible-project\", \"version\": \"1.0.0\"}"
    );

    // 2. Perform destructive edit in merged sandbox view
    fs::write(
        &merged_file,
        "{\"name\": \"corrupted-in-sandbox\", \"version\": \"99.9.9\"}",
    )?;
    println!("Modified package.json in merged view...");

    // 3. Create newly generated files in sandbox
    let new_artifact = merged_path.join("generated_output.txt");
    fs::write(&new_artifact, "AI agent execution output data")?;

    // 4. Assert lower directory is 100% pristine and unaltered!
    let lower_file_content = fs::read_to_string(&initial_file)?;
    assert_eq!(
        lower_file_content,
        "{\"name\": \"crucible-project\", \"version\": \"1.0.0\"}"
    );
    assert!(!base_workspace.join("generated_output.txt").exists());
    println!("✅ Lower base directory verified 100% pristine & unaltered!");

    // 5. Drop guard and assert entire ephemeral overlay directory is deleted
    drop(guard);
    assert!(
        !instance_dir.exists(),
        "Overlay instance directory must be deleted on Drop"
    );
    println!("✅ TEST 1 PASSED: Copy-on-write isolation & automatic Drop teardown verified!\n");

    // -------------------------------------------------------------
    // Test 2: Panic-Safe Stack Unwind & Teardown
    // -------------------------------------------------------------
    println!("--- TEST 2: Guaranteed Teardown on Panic Unwind ---");
    let guard2 = manager.create_overlay("panic_run", std::slice::from_ref(&base_workspace))?;
    let instance_dir2 = guard2.merged_path().parent().unwrap().to_path_buf();
    assert!(instance_dir2.exists());

    let panic_res = catch_unwind(AssertUnwindSafe(|| {
        let _active_guard = guard2;
        println!("  -> Triggering deliberate panic mid-execution...");
        panic!("FATAL_AGENT_FS_CRASH_SIMULATION");
    }));

    assert!(panic_res.is_err(), "Panic must be caught");
    assert!(
        !instance_dir2.exists(),
        "OverlayFS directory MUST be deleted during panic unwinding (zero disk leak)"
    );
    println!("✅ TEST 2 PASSED: OverlayFS automatically cleaned up during panic unwinding!\n");

    // Cleanup root
    let _ = fs::remove_dir_all(&temp_root);

    println!("================================================================================");
    println!("🎉 ALL OVERLAYFS COPY-ON-WRITE ISOLATION VERIFICATIONS PASSED!");
    println!("================================================================================\n");

    Ok(())
}
