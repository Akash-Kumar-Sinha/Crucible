/**
 * Execution Request parameters passed to an Executor adapter
 */
export interface ExecutionRequest {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  sessionId?: string;
  signal?: AbortSignal;
}

/**
 * Normalized Execution Result returned by an Executor adapter
 */
export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed?: boolean;
}

/**
 * Adapter Pattern: Executor Interface
 * Abstraction layer separating harness tool dispatch from concrete compute backends
 * (Local Subprocess, Rust Sandbox, Docker Container, Kubernetes Pod, Remote Worker).
 */
export interface Executor {
  readonly name: string;

  /**
   * Execute a command within the execution environment
   */
  execute(request: ExecutionRequest): Promise<ExecutionResult>;

  /**
   * Check if the execution backend is available and healthy
   */
  isAvailable(): Promise<boolean>;
}
