mod server;

use executor_core::init_json_logging;
use ipc_proto::executor_service_server::ExecutorServiceServer;
use server::GrpcExecutorService;
use std::net::SocketAddr;
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

    // 2. Configure standard gRPC Health Check service (tonic-health)
    let (mut health_reporter, health_service) = tonic_health::server::health_reporter();
    health_reporter
        .set_serving::<ExecutorServiceServer<GrpcExecutorService>>()
        .await;

    let executor_service = ExecutorServiceServer::new(GrpcExecutorService);

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
