import { describe, expect, it } from "bun:test";
import { MemoryJobQueue } from "./memory-job-queue";
import { JobScheduler } from "./job-scheduler";
import type { Job } from "./types";

describe("Job Queue & Scheduling Subsystem", () => {
  describe("MemoryJobQueue (Priority Queue & State Transitions)", () => {
    it("should enqueue and dequeue jobs respecting priority ordering", async () => {
      const queue = new MemoryJobQueue();

      await queue.enqueue({
        sessionId: "sess_1",
        payload: { prompt: "low priority" },
        priority: "low",
      });

      await queue.enqueue({
        sessionId: "sess_2",
        payload: { prompt: "critical priority" },
        priority: "critical",
      });

      await queue.enqueue({
        sessionId: "sess_3",
        payload: { prompt: "normal priority" },
        priority: "normal",
      });

      const first = await queue.dequeue();
      const second = await queue.dequeue();
      const third = await queue.dequeue();
      const fourth = await queue.dequeue();

      expect(first?.sessionId).toBe("sess_2");
      expect(first?.priority).toBe(30);
      expect(second?.sessionId).toBe("sess_3");
      expect(second?.priority).toBe(10);
      expect(third?.sessionId).toBe("sess_1");
      expect(third?.priority).toBe(0);
      expect(fourth).toBeNull();

      await queue.close();
    });

    it("should handle ack and update execution metrics", async () => {
      const queue = new MemoryJobQueue();
      const job = await queue.enqueue({
        sessionId: "sess_metrics",
        payload: { prompt: "test ack" },
      });

      const dequeued = await queue.dequeue();
      expect(dequeued?.id).toBe(job.id);
      expect(dequeued?.status).toBe("processing");

      await queue.ack(job.id, { finalResponse: "success" });

      const fetched = await queue.getJob(job.id);
      expect(fetched?.status).toBe("completed");
      expect((fetched?.result as any)?.finalResponse).toBe("success");

      const metrics = queue.getMetrics();
      expect(metrics.completedCount).toBe(1);
      expect(metrics.processingCount).toBe(0);
      expect(metrics.backlogCount).toBe(0);

      await queue.close();
    });

    it("should retry transient failures with exponential backoff and transition to dead-letter on max retries", async () => {
      const queue = new MemoryJobQueue({ maxRetries: 2, backoffBaseMs: 20 });
      const job = await queue.enqueue({
        sessionId: "sess_retry",
        payload: { prompt: "flaky run" },
        maxRetries: 2,
      });

      const firstRun = await queue.dequeue();
      expect(firstRun?.id).toBe(job.id);

      const nack1 = await queue.nack(
        job.id,
        new Error("Transient network drop"),
        true,
      );
      expect(nack1.retrying).toBe(true);
      expect(nack1.attempts).toBe(1);

      // Wait for backoff delay
      await new Promise((r) => setTimeout(r, 60));

      const secondRun = await queue.dequeue();
      expect(secondRun?.id).toBe(job.id);
      expect(secondRun?.attempts).toBe(1);

      const nack2 = await queue.nack(
        job.id,
        new Error("Persistent compute failure"),
        true,
      );
      expect(nack2.retrying).toBe(false);
      expect(nack2.attempts).toBe(2);

      const deadLetterJobs = await queue.getDeadLetterJobs();
      expect(deadLetterJobs.length).toBe(1);
      expect(deadLetterJobs[0].id).toBe(job.id);
      expect(deadLetterJobs[0].status).toBe("dead_letter");
      expect(deadLetterJobs[0].deadLetterReason).toBe(
        "Persistent compute failure",
      );

      // Test DLQ retry
      const retried = await queue.retryDeadLetterJob(job.id);
      expect(retried?.status).toBe("queued");
      expect(retried?.attempts).toBe(0);

      const thirdRun = await queue.dequeue();
      expect(thirdRun?.id).toBe(job.id);

      await queue.close();
    });
  });

  describe("JobScheduler (Queue-Based Load Leveling & Competing Consumers)", () => {
    it("should level load across concurrent worker pool without exceeding concurrency limit", async () => {
      let maxActiveConcurrent = 0;
      let currentActive = 0;
      const completedJobs: string[] = [];

      const scheduler = new JobScheduler({
        concurrency: 2,
        autoStart: false,
      });

      scheduler.registerHandler("session_run", async (job: Job) => {
        currentActive += 1;
        if (currentActive > maxActiveConcurrent) {
          maxActiveConcurrent = currentActive;
        }
        await new Promise((r) => setTimeout(r, 40));
        completedJobs.push(job.sessionId);
        currentActive -= 1;
        return { ok: true };
      });

      scheduler.start();

      // Enqueue a burst of 6 jobs simultaneously
      const promises = [
        scheduler.enqueue({
          sessionId: "sess_burst_1",
          payload: { prompt: "1" },
        }),
        scheduler.enqueue({
          sessionId: "sess_burst_2",
          payload: { prompt: "2" },
        }),
        scheduler.enqueue({
          sessionId: "sess_burst_3",
          payload: { prompt: "3" },
        }),
        scheduler.enqueue({
          sessionId: "sess_burst_4",
          payload: { prompt: "4" },
        }),
        scheduler.enqueue({
          sessionId: "sess_burst_5",
          payload: { prompt: "5" },
        }),
        scheduler.enqueue({
          sessionId: "sess_burst_6",
          payload: { prompt: "6" },
        }),
      ];

      await Promise.all(promises);

      // Wait for competing consumers to drain the burst
      await new Promise((r) => setTimeout(r, 250));

      expect(maxActiveConcurrent).toBeLessThanOrEqual(2);
      expect(completedJobs.length).toBe(6);

      const metrics = scheduler.getMetrics();
      expect(metrics.completedCount).toBe(6);
      expect(metrics.backlogCount).toBe(0);
      expect(metrics.processingCount).toBe(0);

      await scheduler.close();
    });

    it("should emit dead-letter alerts when jobs exhaust retries", async () => {
      let deadLetterAlertReceived = false;

      const scheduler = new JobScheduler({
        concurrency: 1,
        maxRetries: 1,
        backoffBaseMs: 10,
        autoStart: false,
      });

      scheduler.on("jobDeadLetter", (job, _reason) => {
        if (job.sessionId === "sess_failing_task") {
          deadLetterAlertReceived = true;
        }
      });

      scheduler.registerHandler("session_run", async () => {
        throw new Error("Unrecoverable downstream LLM model failure");
      });

      scheduler.start();

      await scheduler.enqueue({
        sessionId: "sess_failing_task",
        payload: { prompt: "fail" },
        maxRetries: 1,
      });

      await new Promise((r) => setTimeout(r, 80));

      expect(deadLetterAlertReceived).toBe(true);
      const dlq = await scheduler.getDeadLetterJobs();
      expect(dlq.some((j) => j.sessionId === "sess_failing_task")).toBe(true);

      await scheduler.close();
    });

    it("should trigger backlog growth alerts when queue depth crosses threshold", async () => {
      let backlogAlertTriggered = false;

      const queue = new MemoryJobQueue({ backlogAlertThreshold: 3 });
      const scheduler = new JobScheduler(
        {
          concurrency: 1,
          backlogAlertThreshold: 3,
          autoStart: false,
        },
        queue,
      );

      scheduler.on("backlogAlert", (_metrics, _reason) => {
        backlogAlertTriggered = true;
      });

      // Enqueue 4 jobs with worker stopped to build backlog
      await scheduler.enqueue({
        sessionId: "sess_bl_1",
        payload: { prompt: "1" },
      });
      await scheduler.enqueue({
        sessionId: "sess_bl_2",
        payload: { prompt: "2" },
      });
      await scheduler.enqueue({
        sessionId: "sess_bl_3",
        payload: { prompt: "3" },
      });
      await scheduler.enqueue({
        sessionId: "sess_bl_4",
        payload: { prompt: "4" },
      });

      const metrics = scheduler.getMetrics();
      expect(metrics.backlogCount).toBe(4);
      expect(backlogAlertTriggered).toBe(true);

      await scheduler.close();
    });
  });
});
