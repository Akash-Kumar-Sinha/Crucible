mod server;

use crucible_sandbox::{CgroupLimits, CgroupManager, CgroupPool};
use executor_core::init_json_logging;
use ipc_proto::executor_service_server::ExecutorServiceServer;
use server::GrpcExecutorService;
use std::net::SocketAddr;
use std::sync::Arc;
use tonic::transport::Server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Initialize Pino-compatible structured JSON logging
    init_json_logging();

    let port: u16 = std::env::var("CRUCIBLE_GRPC_PORT")
        .or_else(|_| std::env::var("PORT"))
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(50051);

    let addr: SocketAddr = format!("0.0.0.0:{}", port).parse()?;

    // 2. Configure cgroup v2 sandbox pool if available
    let cgroup_service = if CgroupManager::is_cgroup_v2_available() {
        let base_cgroup = std::env::var("CRUCIBLE_CGROUP_PATH")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from("/sys/fs/cgroup/crucible"));
        let manager = CgroupManager::new(base_cgroup);
        let pool = Arc::new(CgroupPool::new(manager, 64, CgroupLimits::default()));
        tracing::info!("cgroup v2 resource isolation active and pool initialized");
        GrpcExecutorService::new().with_cgroup_pool(pool)
    } else {
        tracing::warn!("cgroup v2 not available on host; running without kernel cgroups");
        GrpcExecutorService::new()
    };

    // 3. Configure standard gRPC Health Check service (tonic-health)
    let (mut health_reporter, health_service) = tonic_health::server::health_reporter();
    health_reporter
        .set_serving::<ExecutorServiceServer<GrpcExecutorService>>()
        .await;

    let executor_service = ExecutorServiceServer::new(cgroup_service);

    tracing::info!(
        addr = %addr,
        port = port,
        "Starting Crucible Rust gRPC Executor Service with tonic-health"
    );

    Server::builder()
        .add_service(health_service)
        .add_service(executor_service)
        .serve_with_shutdown(addr, async {
            tokio::signal::ctrl_c()
                .await
                .expect("Failed to listen for shutdown signal");
            tracing::info!("Received shutdown signal, terminating gRPC server gracefully");
        })
        .await?;

    Ok(())
}
