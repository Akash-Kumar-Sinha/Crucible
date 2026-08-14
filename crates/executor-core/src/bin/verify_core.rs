use executor_core::{ExecutorError, ProcessExecutor, init_json_logging};
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Initialize structured JSON logging (Pino-compatible)
    init_json_logging();

    println!("\n=======================================================");
    println!("🦀 CRUCIBLE RUST EXECUTOR-CORE LIVE VERIFICATION");
    println!("=======================================================\n");

    // -------------------------------------------------------------
    // Test 1: Typestate configuration & trivial command execution
    // -------------------------------------------------------------
    println!("--- TEST 1: Typestate Configuration & Execution ---");
    let t0 = Instant::now();
    let trivial_output = ProcessExecutor::new()
        .command("echo")
        .arg("crucible-execution-core-live-ok")
        .execute()
        .await?;

    println!("Stdout: \"{}\"", trivial_output.stdout);
    println!("Exit Code: {}", trivial_output.exit_code);
    println!("Execution Duration: {}ms", trivial_output.duration_ms);

    assert_eq!(trivial_output.exit_code, 0);
    assert_eq!(trivial_output.stdout, "crucible-execution-core-live-ok");
    println!(
        "✅ TEST 1 PASSED: Typestate configured and trivial command executed cleanly in {:?}.\n",
        t0.elapsed()
    );

    // -------------------------------------------------------------
    // Test 2: Concurrent Stdout & Stderr Stream Capture
    // -------------------------------------------------------------
    println!("--- TEST 2: Concurrent Stdout & Stderr Stream Capture ---");
    let stream_output = ProcessExecutor::new()
        .command("sh")
        .args([
            "-c",
            "echo 'streamed_to_stdout'; echo 'streamed_to_stderr' >&2",
        ])
        .execute()
        .await?;

    println!("Captured Stdout: \"{}\"", stream_output.stdout);
    println!("Captured Stderr: \"{}\"", stream_output.stderr);
    println!("Exit Code: {}", stream_output.exit_code);

    assert_eq!(stream_output.stdout, "streamed_to_stdout");
    assert_eq!(stream_output.stderr, "streamed_to_stderr");
    assert_eq!(stream_output.exit_code, 0);
    println!(
        "✅ TEST 2 PASSED: Both stdout and stderr streams multiplexed and captured correctly.\n"
    );

    // -------------------------------------------------------------
    // Test 3: Deliberately slow command killed at timeout threshold
    // -------------------------------------------------------------
    println!("--- TEST 3: Deliberately Slow Command Timeout & RAII Termination ---");
    println!("Spawning 'sleep 30' with a 150ms timeout threshold...");
    let slow_start = Instant::now();

    let timeout_result = ProcessExecutor::new()
        .command("sleep")
        .arg("30")
        .timeout(Duration::from_millis(150))
        .execute()
        .await;

    let elapsed = slow_start.elapsed();
    println!("Command returned in {:?}", elapsed);

    match timeout_result {
        Ok(output) => {
            panic!(
                "❌ TEST 3 FAILED: Command was expected to time out, but returned: {:?}",
                output
            );
        }
        Err(ExecutorError::Timeout {
            command,
            duration_ms,
        }) => {
            println!(
                "Caught Expected Timeout Error: command=\"{}\", configured_timeout={}ms",
                command, duration_ms
            );
            println!(
                "Actual elapsed wall-clock time: {:?} (expected ~150ms-250ms, NOT 30s)",
                elapsed
            );
            assert!(
                elapsed < Duration::from_secs(2),
                "Process hung instead of timing out promptly!"
            );
            println!(
                "✅ TEST 3 PASSED: Slow process was terminated promptly by RAII guard at timeout threshold."
            );
        }
        Err(other) => {
            panic!("❌ TEST 3 FAILED: Unexpected error variant: {:?}", other);
        }
    }

    println!("\n=======================================================");
    println!("🎉 ALL RUST EXECUTOR-CORE VERIFICATIONS PASSED!");
    println!("=======================================================\n");

    Ok(())
}
