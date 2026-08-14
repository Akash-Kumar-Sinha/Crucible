use crucible_sandbox::CgroupPool;
use executor_core::{ExecutorError, ProcessExecutor};
use ipc_proto::executor_service_server::ExecutorService;
use ipc_proto::{ExecuteRequest, ExecuteResponse, ExecutionStreamChunk, StreamType};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};

#[derive(Debug, Default, Clone)]
pub struct GrpcExecutorService {
    cgroup_pool: Option<Arc<CgroupPool>>,
}

impl GrpcExecutorService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_cgroup_pool(mut self, pool: Arc<CgroupPool>) -> Self {
        self.cgroup_pool = Some(pool);
        self
    }
}

#[tonic::async_trait]
impl ExecutorService for GrpcExecutorService {
    type StreamExecuteStream = ReceiverStream<Result<ExecutionStreamChunk, Status>>;

    async fn execute(
        &self,
        request: Request<ExecuteRequest>,
    ) -> Result<Response<ExecuteResponse>, Status> {
        let req = request.into_inner();

        if req.command.trim().is_empty() {
            return Err(Status::invalid_argument("Command cannot be empty"));
        }

        tracing::info!(
            command = %req.command,
            args = ?req.args,
            timeout_ms = ?req.timeout_ms,
            session_id = ?req.session_id,
            "Received gRPC process execution request"
        );

        let mut builder = ProcessExecutor::new().command(&req.command);

        if !req.args.is_empty() {
            builder = builder.args(req.args);
        }

        if let Some(cwd) = req.working_dir {
            builder = builder.current_dir(cwd);
        }

        for (k, v) in req.env {
            builder = builder.env(k, v);
        }

        if let Some(timeout_ms) = req.timeout_ms {
            builder = builder.timeout(Duration::from_millis(timeout_ms));
        }

        if let Some(max_buf) = req.max_buffer_bytes {
            builder = builder.max_buffer_bytes(max_buf as usize);
        }

        // Attach cgroup v2 sandbox if pool is configured
        if let Some(pool) = &self.cgroup_pool {
            let prefix = req.session_id.as_deref().unwrap_or("grpc_exec");
            match pool.acquire(prefix) {
                Ok(guard) => {
                    builder = builder.with_cgroup(guard);
                }
                Err(err) => {
                    tracing::error!(
                        alert = "CRUCIBLE_CGROUP_CREATION_FAILURE_ALERT",
                        error = %err,
                        "Failed to allocate cgroup sandbox for gRPC request"
                    );
                }
            }
        }

        match builder.execute().await {
            Ok(output) => Ok(Response::new(ExecuteResponse {
                exit_code: output.exit_code,
                stdout: output.stdout,
                stderr: output.stderr,
                duration_ms: output.duration_ms,
                timed_out: output.timed_out,
                error_message: String::new(),
            })),
            Err(ExecutorError::Timeout { duration_ms, .. }) => Ok(Response::new(ExecuteResponse {
                exit_code: 137,
                stdout: String::new(),
                stderr: format!("Process execution timed out after {}ms", duration_ms),
                duration_ms,
                timed_out: true,
                error_message: "Execution timed out".to_string(),
            })),
            Err(err) => Ok(Response::new(ExecuteResponse {
                exit_code: 1,
                stdout: String::new(),
                stderr: err.to_string(),
                duration_ms: 0,
                timed_out: false,
                error_message: err.to_string(),
            })),
        }
    }

    async fn stream_execute(
        &self,
        request: Request<ExecuteRequest>,
    ) -> Result<Response<Self::StreamExecuteStream>, Status> {
        let req = request.into_inner();
        let (tx, rx) = mpsc::channel(16);
        let pool_opt = self.cgroup_pool.clone();

        tokio::spawn(async move {
            let mut builder = ProcessExecutor::new().command(&req.command);
            if !req.args.is_empty() {
                builder = builder.args(req.args);
            }
            if let Some(cwd) = req.working_dir {
                builder = builder.current_dir(cwd);
            }
            for (k, v) in req.env {
                builder = builder.env(k, v);
            }
            if let Some(timeout_ms) = req.timeout_ms {
                builder = builder.timeout(Duration::from_millis(timeout_ms));
            }

            if let Some(pool) = &pool_opt {
                let prefix = req.session_id.as_deref().unwrap_or("grpc_exec");
                if let Ok(guard) = pool.acquire(prefix) {
                    builder = builder.with_cgroup(guard);
                }
            }

            match builder.execute().await {
                Ok(output) => {
                    if !output.stdout.is_empty() {
                        let _ = tx
                            .send(Ok(ExecutionStreamChunk {
                                stream: StreamType::Stdout as i32,
                                payload: output.stdout.into_bytes(),
                                exit_code: None,
                                duration_ms: None,
                                timed_out: None,
                            }))
                            .await;
                    }
                    if !output.stderr.is_empty() {
                        let _ = tx
                            .send(Ok(ExecutionStreamChunk {
                                stream: StreamType::Stderr as i32,
                                payload: output.stderr.into_bytes(),
                                exit_code: None,
                                duration_ms: None,
                                timed_out: None,
                            }))
                            .await;
                    }
                    let _ = tx
                        .send(Ok(ExecutionStreamChunk {
                            stream: StreamType::Completion as i32,
                            payload: Vec::new(),
                            exit_code: Some(output.exit_code),
                            duration_ms: Some(output.duration_ms),
                            timed_out: Some(output.timed_out),
                        }))
                        .await;
                }
                Err(err) => {
                    let _ = tx
                        .send(Ok(ExecutionStreamChunk {
                            stream: StreamType::Stderr as i32,
                            payload: err.to_string().into_bytes(),
                            exit_code: Some(1),
                            duration_ms: Some(0),
                            timed_out: Some(matches!(err, ExecutorError::Timeout { .. })),
                        }))
                        .await;
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }
}
