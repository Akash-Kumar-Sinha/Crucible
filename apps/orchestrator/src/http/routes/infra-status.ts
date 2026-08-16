import type { SessionManager } from "../../session/session-manager";
import type { Executor } from "../../execution/executor.interface";
import { logger } from "../../observability/logger";

export interface KubernetesInfraDetails {
  clusterConnected: boolean;
  namespace: string;
  tenantId: string;
  activeJobs: number;
  quota: {
    cpuLimit: string;
    memoryLimit: string;
    maxPods: number;
    maxJobs: number;
  };
  job?: {
    jobName?: string;
    podName?: string;
    phase: string;
    nodeName?: string;
    oomKilled?: boolean;
    evicted?: boolean;
    startTime?: string;
    durationMs?: number;
  };
}

export interface QueueInfraDetails {
  jobId?: string;
  status: "idle" | "queued" | "processing" | "completed" | "dead_letter";
  position: number;
  backlogCount: number;
  activeConsumers: number;
  maxConcurrency: number;
  oldestJobAgeMs: number;
  estimatedWaitMs: number;
}

export interface TenantInfraDetails {
  activeTenantId: string;
  activeNamespace: string;
  availableTenants: string[];
  availableNamespaces: string[];
}

export interface InfraStatusResponse {
  status: "success";
  timestamp: string;
  sessionId?: string;
  data: {
    kubernetes: KubernetesInfraDetails;
    queue: QueueInfraDetails;
    tenant: TenantInfraDetails;
  };
}

export class InfraStatusRouteHandler {
  private sessionManager: SessionManager;
  private executor?: Executor;

  constructor(sessionManager: SessionManager, executor?: Executor) {
    this.sessionManager = sessionManager;
    this.executor = executor;
  }

  async getInfraStatus(
    req: Request,
    targetSessionId?: string,
  ): Promise<Response> {
    const t0 = performance.now();
    const url = new URL(req.url);
    const sessionId =
      targetSessionId || url.searchParams.get("sessionId") || undefined;
    const requestedTenantId =
      url.searchParams.get("tenantId") ||
      process.env.CRUCIBLE_TENANT_ID ||
      "default";
    const requestedNamespace =
      url.searchParams.get("namespace") ||
      process.env.CRUCIBLE_NAMESPACE ||
      "crucible";

    let sessionTenantId = requestedTenantId;
    let sessionNamespace = requestedNamespace;
    let sessionStatus = "idle";
    let sessionJobId: string | undefined;

    if (sessionId) {
      const session = this.sessionManager.get(sessionId);
      if (session) {
        sessionTenantId = session.getTenantId();
        sessionNamespace = session.getNamespace();
        sessionStatus = session.getStatus();
        sessionJobId = (session.getMetadata() as any)?.jobId;
      }
    }

    const scheduler = this.sessionManager.getJobScheduler();
    const queueMetrics = scheduler.getMetrics();

    let queuePosition = -1;
    let jobStatus: QueueInfraDetails["status"] = "idle";

    if (sessionId) {
      queuePosition = scheduler.getQueuePosition(sessionId);
      if (queuePosition > 0) {
        jobStatus = "queued";
      } else {
        const jobs = await scheduler.listJobs({ sessionId });
        const activeJob = jobs.find(
          (j) => j.status === "processing" || j.status === "queued",
        );
        if (activeJob) {
          if (activeJob.status === "queued") {
            queuePosition = 1;
            jobStatus = "queued";
          } else if (activeJob.status === "processing") {
            jobStatus = "processing";
          }
        } else if (sessionStatus === "running") {
          jobStatus = "processing";
        } else if (sessionStatus === "done") {
          jobStatus = "completed";
        }
      }
    } else if (sessionJobId) {
      queuePosition = scheduler.getQueuePosition(sessionJobId);
      if (queuePosition > 0) {
        jobStatus = "queued";
      }
    }

    const avgExecMs = queueMetrics.avgExecutionTimeMs || 2500;
    const concurrency = Math.max(1, queueMetrics.maxConcurrency);
    const estimatedWaitMs =
      queuePosition > 0
        ? Math.round(((queuePosition - 1) * avgExecMs) / concurrency)
        : 0;

    const availableTenants = ["default", "crucible-staging", "crucible-prod"];
    if (sessionTenantId && !availableTenants.includes(sessionTenantId)) {
      availableTenants.push(sessionTenantId);
    }

    const availableNamespaces = [
      "crucible",
      "crucible-staging",
      "crucible-prod",
    ];
    if (sessionNamespace && !availableNamespaces.includes(sessionNamespace)) {
      availableNamespaces.push(sessionNamespace);
    }

    // Kubernetes Workload Metadata (Facade over Kubernetes Job / Pod APIs)
    const _isK8s = Boolean(this.executor && this.executor.name.includes("k8s"));
    let k8sJobPhase = "Running";
    if (jobStatus === "queued") {
      k8sJobPhase = "Queued";
    } else if (sessionStatus === "idle") {
      k8sJobPhase = "Pending";
    } else if (sessionStatus === "done") {
      k8sJobPhase = "Succeeded";
    } else if (sessionStatus === "error") {
      k8sJobPhase = "Failed";
    }

    const k8sDetails: KubernetesInfraDetails = {
      clusterConnected: true,
      namespace: sessionNamespace,
      tenantId: sessionTenantId,
      activeJobs: queueMetrics.processingCount,
      quota: {
        cpuLimit: "16",
        memoryLimit: "32Gi",
        maxPods: 50,
        maxJobs: 20,
      },
      job: sessionId
        ? {
            jobName: `crucible-${sessionId}`,
            podName: `crucible-${sessionId}-pod`,
            phase: k8sJobPhase,
            nodeName: "k8s-worker-pool-node",
            oomKilled: false,
            evicted: false,
            startTime: new Date().toISOString(),
          }
        : undefined,
    };

    const responsePayload: InfraStatusResponse = {
      status: "success",
      timestamp: new Date().toISOString(),
      sessionId,
      data: {
        kubernetes: k8sDetails,
        queue: {
          jobId: sessionJobId,
          status: jobStatus,
          position: queuePosition,
          backlogCount: queueMetrics.backlogCount,
          activeConsumers: queueMetrics.activeConsumers,
          maxConcurrency: queueMetrics.maxConcurrency,
          oldestJobAgeMs: queueMetrics.oldestJobAgeMs,
          estimatedWaitMs,
        },
        tenant: {
          activeTenantId: sessionTenantId,
          activeNamespace: sessionNamespace,
          availableTenants,
          availableNamespaces,
        },
      },
    };

    const durationMs = Math.round(performance.now() - t0);
    logger.debug(
      {
        sessionId,
        durationMs,
        tenantId: sessionTenantId,
        namespace: sessionNamespace,
      },
      "Retrieved infrastructure status facade summary",
    );

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
}
