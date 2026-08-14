import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";

export interface ExecuteRequest {
  command: string;
  args?: string[];
  working_dir?: string;
  env?: Record<string, string>;
  timeout_ms?: number;
  max_buffer_bytes?: number;
  session_id?: string;
  tool_name?: string;
}

export interface ExecuteResponse {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
  error_message?: string;
}

export enum StreamType {
  STREAM_TYPE_UNSPECIFIED = 0,
  STREAM_TYPE_STDOUT = 1,
  STREAM_TYPE_STDERR = 2,
  STREAM_TYPE_COMPLETION = 3,
}

export interface ExecutionStreamChunk {
  stream: StreamType;
  payload: Buffer | Uint8Array;
  exit_code?: number;
  duration_ms?: number;
  timed_out?: boolean;
}

export interface ExecutorServiceClient extends grpc.Client {
  Execute(
    request: ExecuteRequest,
    options: grpc.CallOptions | null,
    callback: (
      error: grpc.ServiceError | null,
      response: ExecuteResponse,
    ) => void,
  ): grpc.ClientUnaryCall;
  Execute(
    request: ExecuteRequest,
    callback: (
      error: grpc.ServiceError | null,
      response: ExecuteResponse,
    ) => void,
  ): grpc.ClientUnaryCall;

  StreamExecute(
    request: ExecuteRequest,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<ExecutionStreamChunk>;
}

export function findExecutorProtoPath(): string {
  // Candidate relative locations across workspace executions
  const candidates = [
    join(process.cwd(), "crates/ipc-proto/proto/executor.proto"),
    join(process.cwd(), "../../crates/ipc-proto/proto/executor.proto"),
    join(process.cwd(), "../../../crates/ipc-proto/proto/executor.proto"),
    resolve(
      import.meta.dir || "",
      "../../../crates/ipc-proto/proto/executor.proto",
    ),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export function loadExecutorProtoDefinition(): grpc.GrpcObject {
  const protoPath = findExecutorProtoPath();
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  return grpc.loadPackageDefinition(packageDefinition);
}

export function createExecutorClient(
  address: string,
  credentials: grpc.ChannelCredentials = grpc.credentials.createInsecure(),
): ExecutorServiceClient {
  const proto = loadExecutorProtoDefinition();
  const crucible = proto.crucible as any;
  const executor = crucible.executor.v1;
  const ExecutorService = executor.ExecutorService;

  return new ExecutorService(address, credentials) as ExecutorServiceClient;
}
