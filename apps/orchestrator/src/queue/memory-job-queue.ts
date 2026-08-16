import { EventEmitter } from "node:events";
import type { JobQueue } from "./job-queue.interface";
import type {
  EnqueueJobOptions,
  Job,
  JobId,
  JobPayload,
  JobPriority,
  JobQueueConfig,
  JobStatus,
  QueueMetrics,
} from "./types";

function parsePriority(priority?: number | JobPriority): number {
  if (typeof priority === "number") return priority;
  switch (priority) {
    case "critical":
      return 30;
    case "high":
      return 20;
    case "low":
      return 0;
    case "normal":
    default:
      return 10;
  }
}

export class MemoryJobQueue<T = JobPayload, R = unknown>
  extends EventEmitter
  implements JobQueue<T, R>
{
  private queuedJobs: Job<T, R>[] = [];
  private delayedJobs: Map<
    JobId,
    { job: Job<T, R>; readyAt: number; timer?: any }
  > = new Map();
  private processingJobs: Map<JobId, Job<T, R>> = new Map();
  private completedJobs: Map<JobId, Job<T, R>> = new Map();
  private deadLetterJobs: Map<JobId, Job<T, R>> = new Map();

  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly maxBackoffMs: number;
  private readonly dlqMaxEntries: number;

  private totalCompletedCount = 0;
  private totalFailedCount = 0;
  private totalWaitTimeMs = 0;
  private totalExecutionTimeMs = 0;
  private totalRecordedRuns = 0;

  constructor(config: JobQueueConfig = {}) {
    super();
    this.maxRetries = config.maxRetries ?? 3;
    this.backoffBaseMs = config.backoffBaseMs ?? 1000;
    this.maxBackoffMs = config.maxBackoffMs ?? 30000;
    this.dlqMaxEntries = config.dlqMaxEntries ?? 1000;
  }

  private sortQueue(): void {
    this.queuedJobs.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.queuedAt.getTime() - b.queuedAt.getTime();
    });
  }

  private flushDelayedJobs(): void {
    const now = Date.now();
    for (const [id, delayed] of this.delayedJobs.entries()) {
      if (delayed.readyAt <= now) {
        if (delayed.timer) clearTimeout(delayed.timer);
        this.delayedJobs.delete(id);
        delayed.job.status = "queued";
        delayed.job.queuedAt = new Date();
        this.queuedJobs.push(delayed.job);
      }
    }
    this.sortQueue();
  }

  async enqueue(options: EnqueueJobOptions<T>): Promise<Job<T, R>> {
    const now = new Date();
    const id: JobId =
      options.id ||
      `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const priority = parsePriority(options.priority);
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const backoffMs = options.backoffMs ?? this.backoffBaseMs;
    const tenantId =
      options.tenantId ||
      (options.payload as any)?.tenantId ||
      process.env.CRUCIBLE_TENANT_ID ||
      "default";
    const namespace =
      options.namespace ||
      (options.payload as any)?.namespace ||
      process.env.CRUCIBLE_NAMESPACE ||
      "crucible";

    const job: Job<T, R> = {
      id,
      type: options.type || "session_run",
      sessionId: options.sessionId,
      tenantId,
      namespace,
      payload: options.payload,
      status: "queued",
      priority,
      attempts: 0,
      maxRetries,
      backoffMs,
      createdAt: now,
      queuedAt: now,
      traceparent: options.traceparent,
    };

    if (options.delayMs && options.delayMs > 0) {
      const readyAt = Date.now() + options.delayMs;
      const timer = setTimeout(() => {
        this.flushDelayedJobs();
        this.emit("jobAvailable");
      }, options.delayMs);

      this.delayedJobs.set(id, { job, readyAt, timer });
    } else {
      this.queuedJobs.push(job);
      this.sortQueue();
    }

    this.emit("jobEnqueued", job);
    this.emit("jobAvailable");
    return job;
  }

  async dequeue(): Promise<Job<T, R> | null> {
    this.flushDelayedJobs();
    if (this.queuedJobs.length === 0) {
      return null;
    }

    const job = this.queuedJobs.shift()!;
    job.status = "processing";
    job.startedAt = new Date();
    this.processingJobs.set(job.id, job);

    const waitMs = job.startedAt.getTime() - job.queuedAt.getTime();
    this.totalWaitTimeMs += waitMs;

    this.emit("jobStarted", job);
    return job;
  }

  async ack(jobId: JobId, result?: R): Promise<void> {
    const job = this.processingJobs.get(jobId);
    if (!job) {
      return;
    }

    this.processingJobs.delete(jobId);
    job.status = "completed";
    job.completedAt = new Date();
    job.result = result;

    if (job.startedAt) {
      const executionTime = job.completedAt.getTime() - job.startedAt.getTime();
      this.totalExecutionTimeMs += executionTime;
      this.totalRecordedRuns += 1;
    }

    this.totalCompletedCount += 1;
    this.completedJobs.set(job.id, job);
    if (this.completedJobs.size > 500) {
      const oldestKey = this.completedJobs.keys().next().value;
      if (oldestKey) this.completedJobs.delete(oldestKey);
    }

    this.emit("jobCompleted", job);
  }

  async nack(
    jobId: JobId,
    error: Error | string,
    retryable = true,
  ): Promise<{ retrying: boolean; attempts: number }> {
    const job = this.processingJobs.get(jobId);
    if (!job) {
      return { retrying: false, attempts: 0 };
    }

    this.processingJobs.delete(jobId);
    job.attempts += 1;
    const errorMsg = error instanceof Error ? error.message : String(error);
    job.error = errorMsg;

    if (retryable && job.attempts < job.maxRetries) {
      const delayMs = Math.min(
        this.maxBackoffMs,
        this.backoffBaseMs * Math.pow(2, job.attempts - 1) +
          Math.floor(Math.random() * Math.min(20, this.backoffBaseMs * 0.1)),
      );

      job.status = "queued";
      const readyAt = Date.now() + delayMs;
      const timer = setTimeout(() => {
        this.flushDelayedJobs();
        this.emit("jobAvailable");
      }, delayMs);

      this.delayedJobs.set(job.id, { job, readyAt, timer });
      this.emit("jobRetryScheduled", job, delayMs);
      return { retrying: true, attempts: job.attempts };
    }

    // Dead letter state
    job.status = "dead_letter";
    job.deadLetterReason = errorMsg;
    this.totalFailedCount += 1;
    this.deadLetterJobs.set(job.id, job);
    if (this.deadLetterJobs.size > this.dlqMaxEntries) {
      const oldestKey = this.deadLetterJobs.keys().next().value;
      if (oldestKey) this.deadLetterJobs.delete(oldestKey);
    }

    this.emit("jobDeadLetter", job, errorMsg);
    this.emit(
      "jobFailed",
      job,
      error instanceof Error ? error : new Error(errorMsg),
    );
    return { retrying: false, attempts: job.attempts };
  }

  async getJob(jobId: JobId): Promise<Job<T, R> | null> {
    return (
      this.processingJobs.get(jobId) ||
      this.queuedJobs.find((j) => j.id === jobId) ||
      this.delayedJobs.get(jobId)?.job ||
      this.deadLetterJobs.get(jobId) ||
      this.completedJobs.get(jobId) ||
      null
    );
  }

  async listJobs(filter?: {
    status?: JobStatus;
    sessionId?: string;
    tenantId?: string;
    namespace?: string;
    limit?: number;
  }): Promise<Job<T, R>[]> {
    this.flushDelayedJobs();
    let all: Job<T, R>[] = [
      ...this.queuedJobs,
      ...Array.from(this.delayedJobs.values()).map((d) => d.job),
      ...Array.from(this.processingJobs.values()),
      ...Array.from(this.deadLetterJobs.values()),
      ...Array.from(this.completedJobs.values()),
    ];

    if (filter?.status) {
      all = all.filter((j) => j.status === filter.status);
    }
    if (filter?.sessionId) {
      all = all.filter((j) => j.sessionId === filter.sessionId);
    }
    if (filter?.tenantId && filter.tenantId !== "all") {
      all = all.filter((j) => j.tenantId === filter.tenantId);
    }
    if (filter?.namespace && filter.namespace !== "all") {
      all = all.filter((j) => j.namespace === filter.namespace);
    }

    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (filter?.limit && filter.limit > 0) {
      return all.slice(0, filter.limit);
    }
    return all;
  }

  async getDeadLetterJobs(limit = 100): Promise<Job<T, R>[]> {
    const list = Array.from(this.deadLetterJobs.values());
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return list.slice(0, limit);
  }

  async retryDeadLetterJob(jobId: JobId): Promise<Job<T, R> | null> {
    const job = this.deadLetterJobs.get(jobId);
    if (!job) {
      return null;
    }

    this.deadLetterJobs.delete(jobId);
    job.status = "queued";
    job.attempts = 0;
    job.error = undefined;
    job.deadLetterReason = undefined;
    job.queuedAt = new Date();

    this.queuedJobs.push(job);
    this.sortQueue();
    this.emit("jobEnqueued", job);
    this.emit("jobAvailable");
    return job;
  }

  getQueuePosition(jobIdOrSessionId: string): number {
    this.flushDelayedJobs();
    const idx = this.queuedJobs.findIndex(
      (j) => j.id === jobIdOrSessionId || j.sessionId === jobIdOrSessionId,
    );
    return idx === -1 ? -1 : idx + 1;
  }

  getMetrics(): QueueMetrics {
    this.flushDelayedJobs();
    const now = Date.now();
    const backlogCount = this.queuedJobs.length + this.delayedJobs.size;
    const processingCount = this.processingJobs.size;

    let oldestJobAgeMs = 0;
    if (this.queuedJobs.length > 0) {
      oldestJobAgeMs = now - this.queuedJobs[0].queuedAt.getTime();
    }

    const avgWaitTimeMs =
      this.totalRecordedRuns > 0
        ? Math.round(this.totalWaitTimeMs / this.totalRecordedRuns)
        : 0;
    const avgExecutionTimeMs =
      this.totalRecordedRuns > 0
        ? Math.round(this.totalExecutionTimeMs / this.totalRecordedRuns)
        : 0;

    return {
      backlogCount,
      processingCount,
      completedCount: this.totalCompletedCount,
      failedCount: this.totalFailedCount,
      deadLetterCount: this.deadLetterJobs.size,
      activeConsumers: processingCount,
      maxConcurrency: 0,
      oldestJobAgeMs,
      avgWaitTimeMs,
      avgExecutionTimeMs,
      lagMs: oldestJobAgeMs,
      timestamp: new Date().toISOString(),
    };
  }

  async purge(): Promise<void> {
    for (const delayed of this.delayedJobs.values()) {
      if (delayed.timer) clearTimeout(delayed.timer);
    }
    this.queuedJobs = [];
    this.delayedJobs.clear();
    this.processingJobs.clear();
    this.deadLetterJobs.clear();
    this.completedJobs.clear();
  }

  async close(): Promise<void> {
    await this.purge();
    this.removeAllListeners();
  }
}
