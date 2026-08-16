export type JobId = string;

export type JobType = "session_run" | "session_message" | "task";

export type JobStatus =
  "queued" | "processing" | "completed" | "failed" | "dead_letter";

export type JobPriority = "low" | "normal" | "high" | "critical";

export interface JobPayload {
  sessionId?: string;
  prompt?: string;
  tenantId?: string;
  namespace?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Job<T = JobPayload, R = unknown> {
  id: JobId;
  type: JobType;
  sessionId: string;
  tenantId: string;
  namespace: string;
  payload: T;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxRetries: number;
  backoffMs: number;
  createdAt: Date;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: R;
  error?: string;
  deadLetterReason?: string;
  traceparent?: string;
}

export interface EnqueueJobOptions<T = JobPayload> {
  id?: JobId;
  type?: JobType;
  sessionId: string;
  tenantId?: string;
  namespace?: string;
  payload: T;
  priority?: number | JobPriority;
  maxRetries?: number;
  backoffMs?: number;
  delayMs?: number;
  traceparent?: string;
}

export interface QueueMetrics {
  backlogCount: number;
  processingCount: number;
  completedCount: number;
  failedCount: number;
  deadLetterCount: number;
  activeConsumers: number;
  maxConcurrency: number;
  oldestJobAgeMs: number;
  avgWaitTimeMs: number;
  avgExecutionTimeMs: number;
  lagMs: number;
  timestamp: string;
}

export interface JobQueueConfig {
  concurrency?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  maxBackoffMs?: number;
  backlogAlertThreshold?: number;
  maxWaitTimeAlertThresholdMs?: number;
  staleJobTimeoutMs?: number;
  dlqMaxEntries?: number;
  autoStart?: boolean;
}

export type JobHandler<T = JobPayload, R = unknown> = (
  job: Job<T, R>,
) => Promise<R>;

export interface JobQueueEvents {
  jobEnqueued: (job: Job) => void;
  jobStarted: (job: Job) => void;
  jobCompleted: (job: Job) => void;
  jobFailed: (job: Job, error: Error) => void;
  jobDeadLetter: (job: Job, reason: string) => void;
  backlogAlert: (metrics: QueueMetrics, reason: string) => void;
}
