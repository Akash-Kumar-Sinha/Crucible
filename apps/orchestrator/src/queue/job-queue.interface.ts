import type {
  EnqueueJobOptions,
  Job,
  JobId,
  JobPayload,
  JobStatus,
  QueueMetrics,
} from "./types";

export interface JobQueue<T = JobPayload, R = unknown> {
  enqueue(options: EnqueueJobOptions<T>): Promise<Job<T, R>>;
  dequeue(): Promise<Job<T, R> | null>;
  ack(jobId: JobId, result?: R): Promise<void>;
  nack(
    jobId: JobId,
    error: Error | string,
    retryable?: boolean,
  ): Promise<{ retrying: boolean; attempts: number }>;
  getJob(jobId: JobId): Promise<Job<T, R> | null>;
  listJobs(filter?: {
    status?: JobStatus;
    sessionId?: string;
    tenantId?: string;
    namespace?: string;
    limit?: number;
  }): Promise<Job<T, R>[]>;
  getDeadLetterJobs(limit?: number): Promise<Job<T, R>[]>;
  retryDeadLetterJob(jobId: JobId): Promise<Job<T, R> | null>;
  getQueuePosition(jobIdOrSessionId: string): number;
  getMetrics(): QueueMetrics;
  purge(): Promise<void>;
  close(): Promise<void>;
}
