use executor_core::{ProcessExecutor, init_json_logging};
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize structured JSON logging (Pino equivalent in Rust)
    init_json_logging();

    println!("=== Crucible Rust Executor Core Demo ===");

    // 1. Successful command execution
    let output = ProcessExecutor::new()
        .command("echo")
        .arg("Hello from Crucible Rust Execution Core!")
        .execute()
        .await?;

    println!("Output: {}", output.stdout);
    println!("Duration: {}ms", output.duration_ms);

    // 2. Command with environment variables and custom working directory
    let env_output = ProcessExecutor::new()
        .command("sh")
        .args(["-c", "echo Mode: $CRUCIBLE_MODE, Path: $(pwd)"])
        .env("CRUCIBLE_MODE", "sandboxed_rust_compute")
        .current_dir("/tmp")
        .execute()
        .await?;

    println!("Env Output: {}", env_output.stdout);

    // 3. Timeout enforcement test
    println!("\nTesting timeout enforcement (sleeping 2s with 100ms timeout)...");
    match ProcessExecutor::new()
        .command("sleep")
        .arg("2")
        .timeout(Duration::from_millis(100))
        .execute()
        .await
    {
        Ok(_) => println!("Unexpected success!"),
        Err(err) => println!("Caught expected timeout error: {}", err),
    }

    Ok(())
}
