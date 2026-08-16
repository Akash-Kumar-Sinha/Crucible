import { EventEmitter } from "node:events";
import type { JobQueue } from "./job-queue.interface";
import { MemoryJobQueue } from "./memory-job-queue";
import type {
  EnqueueJobOptions,
  Job,
  JobHandler,
  JobId,
  JobPayload,
  JobQueueConfig,
  JobType,
  QueueMetrics,
} from "./types";
import { logger } from "../observability/logger";
import { tracer } from "../observability/otel";
import { getErrorReporter } from "../observability/error-reporter";

export class JobScheduler extends EventEmitter {
  private readonly queue: JobQueue<any, any>;
  private readonly concurrency: number;
  private readonly backlogAlertThreshold: number;
  private readonly maxWaitTimeAlertThresholdMs: number;
  private readonly handlers = new Map<JobType, JobHandler<any, any>>();
  private defaultHandler?: JobHandler<any, any>;

  private isRunning = false;
  private activeWorkers = 0;
  private lastBacklogAlertTimestamp = 0;
  private backlogMonitorTimer?: any;

  constructor(config: JobQueueConfig = {}, queue?: JobQueue<any, any>) {
    super();
    this.concurrency =
      config.concurrency ||
      Number(process.env.CRUCIBLE_QUEUE_CONCURRENCY || "4");
    this.backlogAlertThreshold =
      config.backlogAlertThreshold ||
      Number(process.env.CRUCIBLE_QUEUE_BACKLOG_ALERT_THRESHOLD || "20");
    this.maxWaitTimeAlertThresholdMs =
      config.maxWaitTimeAlertThresholdMs ||
      Number(process.env.CRUCIBLE_QUEUE_MAX_WAIT_TIME_MS || "30000");

    this.queue = queue || new MemoryJobQueue(config);

    if (this.queue instanceof EventEmitter) {
      this.queue.on("jobDeadLetter", (job: Job, reason: string) => {
        this.emit("jobDeadLetter", job, reason);
        this.handleDeadLetterAlert(job, reason);
      });
      this.queue.on("jobCompleted", (job: Job) => {
        this.emit("jobCompleted", job);
      });
      this.queue.on("jobFailed", (job: Job, error: Error) => {
        this.emit("jobFailed", job, error);
      });
    }

    if (config.autoStart !== false) {
      this.start();
    }
  }

  registerHandler<T = JobPayload, R = unknown>(
    type: JobType,
    handler: JobHandler<T, R>,
  ): this {
    this.handlers.set(type, handler);
    return this;
  }

  setDefaultHandler<T = JobPayload, R = unknown>(
    handler: JobHandler<T, R>,
  ): this {
    this.defaultHandler = handler;
    return this;
  }

  start(): this {
    if (this.isRunning) return this;
    this.isRunning = true;

    for (let i = 0; i < this.concurrency; i++) {
      void this.spawnConsumerWorker(i);
    }

    this.backlogMonitorTimer = setInterval(() => {
      this.checkBacklogHealth();
    }, 5000);

    logger.info(
      {
        concurrency: this.concurrency,
        alertThreshold: this.backlogAlertThreshold,
      },
      "[JobScheduler] Started competing consumer worker pool",
    );
    return this;
  }

  stop(): void {
    this.isRunning = false;
    if (this.backlogMonitorTimer) {
      clearInterval(this.backlogMonitorTimer);
      this.backlogMonitorTimer = undefined;
    }
  }

  private async spawnConsumerWorker(workerIndex: number): Promise<void> {
    while (this.isRunning) {
      let job: Job | null = null;
      try {
        job = await this.queue.dequeue();
      } catch (err) {
        logger.error(
          { err, workerIndex },
          "[JobScheduler] Error during dequeue",
        );
      }

      if (!job) {
        await new Promise<void>((resolve) => {
          let resolved = false;
          const onAvailable = () => {
            if (!resolved) {
              resolved = true;
              cleanup();
              resolve();
            }
          };
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              cleanup();
              resolve();
            }
          }, 30);

          const cleanup = () => {
            clearTimeout(timeout);
            if (this.queue instanceof EventEmitter) {
              this.queue.off("jobAvailable", onAvailable);
            }
            this.off("wakeWorkers", onAvailable);
          };

          if (this.queue instanceof EventEmitter) {
            this.queue.once("jobAvailable", onAvailable);
          }
          this.once("wakeWorkers", onAvailable);
        });
        continue;
      }

      this.activeWorkers += 1;
      try {
        await this.processJob(job);
      } finally {
        this.activeWorkers -= 1;
        this.emit("wakeWorkers");
      }
    }
  }

  private async processJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type) || this.defaultHandler;

    if (!handler) {
      const err = new Error(
        `No registered handler found for job type: ${job.type}`,
      );
      await this.queue.nack(job.id, err, false);
      return;
    }

    await tracer.withSpan(
      "job_queue.execute",
      {
        jobId: job.id,
        jobType: job.type,
        sessionId: job.sessionId,
        tenantId: job.tenantId,
        namespace: job.namespace,
        attempts: job.attempts + 1,
        priority: job.priority,
      },
      async (span) => {
        try {
          const result = await handler(job);
          await this.queue.ack(job.id, result);
          span.setAttribute("jobStatus", "completed");
        } catch (err: any) {
          span.setAttribute("jobStatus", "failed");
          span.setAttribute("error", err?.message || String(err));
          const nackRes = await this.queue.nack(job.id, err, true);
          logger.warn(
            {
              jobId: job.id,
              sessionId: job.sessionId,
              attempts: nackRes.attempts,
              retrying: nackRes.retrying,
              err: err?.message,
            },
            "[JobScheduler] Job execution failed",
          );
        }
      },
    );
  }

  private handleDeadLetterAlert(job: Job, reason: string): void {
    logger.error(
      {
        alert: "CRUCIBLE_DEAD_LETTER_JOB_ALERT",
        jobId: job.id,
        sessionId: job.sessionId,
        tenantId: job.tenantId,
        namespace: job.namespace,
        attempts: job.attempts,
        reason,
      },
      `[Dead Letter Alert] Job ${job.id} (Session: ${job.sessionId}) exceeded maximum retries and entered DLQ`,
    );

    getErrorReporter().captureAgentError(
      new Error(`Dead letter job: ${reason}`),
      {
        alert: "CRUCIBLE_DEAD_LETTER_JOB_ALERT",
        sessionId: job.sessionId,
        tenantId: job.tenantId,
        namespace: job.namespace,
        extra: {
          jobId: job.id,
          jobType: job.type,
          attempts: job.attempts,
          maxRetries: job.maxRetries,
          deadLetterReason: reason,
        },
      },
    );
  }

  private checkBacklogHealth(): void {
    const metrics = this.getMetrics();
    const now = Date.now();

    if (
      metrics.backlogCount >= this.backlogAlertThreshold ||
      (metrics.oldestJobAgeMs >= this.maxWaitTimeAlertThresholdMs &&
        metrics.backlogCount > 0)
    ) {
      if (now - this.lastBacklogAlertTimestamp > 30000) {
        this.lastBacklogAlertTimestamp = now;
        const alertReason =
          metrics.backlogCount >= this.backlogAlertThreshold
            ? `Queue backlog count exceeded threshold: ${metrics.backlogCount} pending (limit: ${this.backlogAlertThreshold})`
            : `Queue latency exceeded threshold: oldest job waiting ${Math.round(metrics.oldestJobAgeMs / 1000)}s (limit: ${Math.round(this.maxWaitTimeAlertThresholdMs / 1000)}s)`;

        logger.warn(
          {
            alert: "CRUCIBLE_QUEUE_BACKLOG_GROWTH_ALERT",
            backlogCount: metrics.backlogCount,
            processingCount: metrics.processingCount,
            oldestJobAgeMs: metrics.oldestJobAgeMs,
            threshold: this.backlogAlertThreshold,
          },
          `[Queue Backlog Alert] ${alertReason}`,
        );

        this.emit("backlogAlert", metrics, alertReason);

        getErrorReporter().captureAgentError(new Error(alertReason), {
          alert: "CRUCIBLE_QUEUE_BACKLOG_GROWTH_ALERT",
          extra: {
            backlogCount: metrics.backlogCount,
            processingCount: metrics.processingCount,
            oldestJobAgeMs: metrics.oldestJobAgeMs,
            activeConsumers: metrics.activeConsumers,
          },
        });
      }
    }
  }

  async enqueue<T = JobPayload, R = unknown>(
    options: EnqueueJobOptions<T>,
  ): Promise<Job<T, R>> {
    const job = await this.queue.enqueue(options);
    this.emit("wakeWorkers");
    this.checkBacklogHealth();
    return job as Job<T, R>;
  }

  getMetrics(): QueueMetrics {
    const raw = this.queue.getMetrics();
    return {
      ...raw,
      activeConsumers: this.activeWorkers,
      maxConcurrency: this.concurrency,
    };
  }

  getQueue(): JobQueue {
    return this.queue;
  }

  async listJobs(filter?: Parameters<JobQueue["listJobs"]>[0]): Promise<Job[]> {
    return this.queue.listJobs(filter);
  }

  async getDeadLetterJobs(limit?: number): Promise<Job[]> {
    return this.queue.getDeadLetterJobs(limit);
  }

  async retryDeadLetterJob(jobId: JobId): Promise<Job | null> {
    return this.queue.retryDeadLetterJob(jobId);
  }

  getQueuePosition(jobIdOrSessionId: string): number {
    return this.queue.getQueuePosition(jobIdOrSessionId);
  }

  async close(): Promise<void> {
    this.stop();
    await this.queue.close();
    this.removeAllListeners();
  }
}

let globalJobScheduler: JobScheduler | null = null;

export function getGlobalJobScheduler(config?: JobQueueConfig): JobScheduler {
  if (!globalJobScheduler) {
    globalJobScheduler = new JobScheduler(config);
  }
  return globalJobScheduler;
}

export function resetGlobalJobScheduler(): void {
  if (globalJobScheduler) {
    globalJobScheduler.stop();
    globalJobScheduler = null;
  }
}
