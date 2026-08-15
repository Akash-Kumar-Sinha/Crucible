import { existsSync, readFileSync } from "node:fs";
import type {
  ExecutionRequest,
  ExecutionResult,
  Executor,
} from "./executor.interface";
import { DockerImageFactory } from "./docker-executor";
import { logger } from "../observability/logger";
import {
  captureAgentError,
  getErrorReporter,
} from "../observability/error-reporter";
import { tracer } from "../observability/otel";

export interface K8sJobConfigBuilderOptions {
  jobName: string;
  namespace: string;
  image: string;
  command: string;
  workingDir?: string;
  env?: Record<string, string>;
  memoryLimitBytes: number;
  cpuLimitNano: number;
  timeoutSeconds: number;
  sessionId?: string;
  traceparent?: string;
}

/**
 * Builder Pattern: Encapsulates creation of Kubernetes batch/v1 Job manifests
 * adhering to the Restricted Pod Security Standard.
 */
export class K8sJobConfigBuilder {
  private readonly options: K8sJobConfigBuilderOptions;

  constructor(options: K8sJobConfigBuilderOptions) {
    this.options = options;
  }

  build(): Record<string, any> {
    const memoryLimitMb = Math.max(
      32,
      Math.round(this.options.memoryLimitBytes / 1024 / 1024),
    );
    const cpuLimitMilli = Math.max(
      50,
      Math.round((this.options.cpuLimitNano / 1_000_000_000) * 1000),
    );

    const envList = Object.entries({
      ...(this.options.env || {}),
      ...(this.options.traceparent
        ? { TRACEPARENT: this.options.traceparent }
        : {}),
    }).map(([name, value]) => ({ name, value }));

    return {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: this.options.jobName,
        namespace: this.options.namespace,
        labels: {
          "app.kubernetes.io/name": "crucible-job",
          "app.kubernetes.io/part-of": "crucible",
          "crucible.managed": "true",
          "crucible.session": this.options.sessionId || "default",
          "crucible.timestamp": String(Date.now()),
        },
      },
      spec: {
        backoffLimit: 0,
        activeDeadlineSeconds: this.options.timeoutSeconds,
        ttlSecondsAfterFinished: 60,
        template: {
          metadata: {
            labels: {
              "app.kubernetes.io/name": "crucible-job",
              "app.kubernetes.io/part-of": "crucible",
              "crucible.managed": "true",
              "crucible.session": this.options.sessionId || "default",
            },
          },
          spec: {
            restartPolicy: "Never",
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 10001,
              runAsGroup: 10001,
              fsGroup: 10001,
              seccompProfile: {
                type: "RuntimeDefault",
              },
            },
            containers: [
              {
                name: "executor",
                image: this.options.image,
                imagePullPolicy: "IfNotPresent",
                command: [
                  "/bin/sh",
                  "-c",
                  `(${this.options.command}); EXIT_CODE=$?; touch /var/run/crucible/done; exit $EXIT_CODE`,
                ],
                workingDir: this.options.workingDir || "/workspace",
                env: envList,
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  capabilities: {
                    drop: ["ALL"],
                  },
                },
                resources: {
                  requests: {
                    memory: `${Math.max(32, Math.floor(memoryLimitMb / 2))}Mi`,
                    cpu: `${Math.max(20, Math.floor(cpuLimitMilli / 4))}m`,
                  },
                  limits: {
                    memory: `${memoryLimitMb}Mi`,
                    cpu: `${cpuLimitMilli}m`,
                  },
                },
                volumeMounts: [
                  { name: "workspace", mountPath: "/workspace" },
                  { name: "tmp", mountPath: "/tmp" },
                  { name: "ipc-pipe", mountPath: "/var/run/crucible" },
                ],
              },
              {
                name: "observability-sidecar",
                image: "busybox:1.36",
                imagePullPolicy: "IfNotPresent",
                command: [
                  "/bin/sh",
                  "-c",
                  "while [ ! -f /var/run/crucible/done ]; do sleep 1; done",
                ],
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  capabilities: {
                    drop: ["ALL"],
                  },
                },
                resources: {
                  requests: {
                    memory: "16Mi",
                    cpu: "10m",
                  },
                  limits: {
                    memory: "64Mi",
                    cpu: "50m",
                  },
                },
                volumeMounts: [
                  { name: "ipc-pipe", mountPath: "/var/run/crucible" },
                  { name: "tmp", mountPath: "/tmp" },
                ],
              },
            ],
            volumes: [
              { name: "workspace", emptyDir: {} },
              { name: "tmp", emptyDir: {} },
              { name: "ipc-pipe", emptyDir: {} },
            ],
          },
        },
      },
    };
  }
}

export type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface KubernetesJobExecutorConfig {
  apiUrl?: string;
  namespace?: string;
  token?: string;
  caCert?: string;
  imageFactory?: DockerImageFactory;
  defaultMemoryLimitBytes?: number;
  defaultCpuLimit?: number;
  defaultTimeoutMs?: number;
  maxBufferBytes?: number;
  pollIntervalMs?: number;
  fallbackExecutor?: Executor;
  customFetch?: FetchFunction;
}

/**
 * Kubernetes Job Executor (Compute Adapter Pattern)
 * Executes agent tool requests inside isolated, ephemeral Kubernetes Jobs
 * strictly governed by the Restricted Pod Security Standard.
 */
export class KubernetesJobExecutor implements Executor {
  readonly name = "k8s_job";
  private readonly apiUrl: string;
  private readonly namespace: string;
  private readonly token?: string;
  private readonly imageFactory: DockerImageFactory;
  private readonly defaultMemoryLimitBytes: number;
  private readonly defaultCpuLimit: number;
  private readonly defaultTimeoutMs: number;
  private readonly maxBufferBytes: number;
  private readonly pollIntervalMs: number;
  private readonly fallbackExecutor?: Executor;
  private readonly fetchImpl: FetchFunction;

  constructor(config: KubernetesJobExecutorConfig = {}) {
    this.namespace =
      config.namespace ||
      process.env.CRUCIBLE_K8S_NAMESPACE ||
      this.readServiceAccountNamespace() ||
      "crucible";

    this.apiUrl =
      config.apiUrl ||
      process.env.CRUCIBLE_K8S_API_URL ||
      this.detectInClusterApiUrl() ||
      "http://127.0.0.1:8001";

    this.token =
      config.token ||
      process.env.CRUCIBLE_K8S_TOKEN ||
      this.readServiceAccountToken();

    this.imageFactory = config.imageFactory || new DockerImageFactory();
    this.defaultMemoryLimitBytes =
      config.defaultMemoryLimitBytes || 512 * 1024 * 1024;
    this.defaultCpuLimit = config.defaultCpuLimit || 1_000_000_000;
    this.defaultTimeoutMs = config.defaultTimeoutMs || 60_000;
    this.maxBufferBytes = config.maxBufferBytes || 10 * 1024 * 1024;
    this.pollIntervalMs = config.pollIntervalMs || 500;
    this.fallbackExecutor = config.fallbackExecutor;
    this.fetchImpl = config.customFetch || fetch.bind(globalThis);
  }

  private detectInClusterApiUrl(): string | undefined {
    if (process.env.KUBERNETES_SERVICE_HOST) {
      const port = process.env.KUBERNETES_SERVICE_PORT || "443";
      return `https://${process.env.KUBERNETES_SERVICE_HOST}:${port}`;
    }
    return undefined;
  }

  private readServiceAccountToken(): string | undefined {
    const tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token";
    if (existsSync(tokenPath)) {
      try {
        return readFileSync(tokenPath, "utf8").trim();
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private readServiceAccountNamespace(): string | undefined {
    const nsPath = "/var/run/secrets/kubernetes.io/serviceaccount/namespace";
    if (existsSync(nsPath)) {
      try {
        return readFileSync(nsPath, "utf8").trim();
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Check if Kubernetes API is accessible
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await this.fetchImpl(`${this.apiUrl}/version`, {
        method: "GET",
        headers: this.getAuthHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Execute command inside an ephemeral Kubernetes Job
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    return tracer.withSpan(
      "k8s.job_exec",
      {
        sessionId: request.sessionId,
        toolName: request.toolName,
        command: request.command,
      },
      async (span) => {
        const startTime = Date.now();
        const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
        const memoryLimit =
          request.memoryLimitBytes ?? this.defaultMemoryLimitBytes;
        const cpuLimit = request.cpuLimit ?? this.defaultCpuLimit;

        // Check availability; fallback if unreachable
        const available = await this.isAvailable();
        if (!available) {
          if (this.fallbackExecutor) {
            logger.warn(
              { command: request.command },
              "[KubernetesJobExecutor] Kubernetes API unavailable, falling back to secondary executor",
            );
            return this.fallbackExecutor.execute(request);
          }
          const errMsg = `Kubernetes API is unreachable at configured address '${this.apiUrl}'.`;
          captureAgentError(new Error(errMsg), {
            sessionId: request.sessionId,
            toolName: request.toolName,
            extra: {
              executor: this.name,
              errorType: "K8S_API_UNAVAILABLE",
            },
          });
          return {
            exitCode: 1,
            stdout: "",
            stderr: errMsg,
            durationMs: Date.now() - startTime,
            killed: false,
          };
        }

        const image = this.imageFactory.resolveImage(
          request.language,
          request.toolName,
          request.image,
        );

        const cleanSession = (request.sessionId || "default")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 16);
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const jobName = `crucible-job-${cleanSession || "run"}-${randomSuffix}`;
        const timeoutSeconds = Math.max(5, Math.ceil(timeoutMs / 1000));

        const builder = new K8sJobConfigBuilder({
          jobName,
          namespace: this.namespace,
          image,
          command: request.command,
          workingDir: request.cwd,
          env: request.env,
          memoryLimitBytes: memoryLimit,
          cpuLimitNano: cpuLimit,
          timeoutSeconds,
          sessionId: request.sessionId,
          traceparent: span.getTraceparent(),
        });

        const jobManifest = builder.build();
        let jobCreated = false;
        let killed = false;
        let timer: NodeJS.Timeout | null = null;

        try {
          // 1. Submit Job creation
          const createRes = await this.fetchImpl(
            `${this.apiUrl}/apis/batch/v1/namespaces/${this.namespace}/jobs`,
            {
              method: "POST",
              headers: this.getAuthHeaders(),
              body: JSON.stringify(jobManifest),
            },
          );

          if (!createRes.ok) {
            const errText = await createRes.text();
            throw new Error(
              `Failed to create Kubernetes Job: HTTP ${createRes.status} - ${errText}`,
            );
          }
          jobCreated = true;

          // 2. Set timeout and signal handlers
          if (timeoutMs > 0) {
            timer = setTimeout(async () => {
              killed = true;
              await this.deleteJob(jobName).catch(() => {});
            }, timeoutMs);
          }

          if (request.signal) {
            request.signal.addEventListener("abort", async () => {
              killed = true;
              await this.deleteJob(jobName).catch(() => {});
            });
          }

          // 3. Poll for Pod and wait for completion
          const { podName, exitCode, oomKilled } = await this.waitForJobPod(
            jobName,
            timeoutMs,
          );
          if (timer) clearTimeout(timer);

          // 4. Fetch pod logs
          const stdout = podName
            ? await this.fetchPodLogs(podName, "executor")
            : "";
          const durationMs = Date.now() - startTime;

          if (request.onStdout && stdout) {
            request.onStdout(stdout);
          }

          const result: ExecutionResult = {
            exitCode: killed ? 137 : exitCode,
            stdout: stdout.trimEnd(),
            stderr:
              exitCode !== 0 && !stdout
                ? `Job failed with exit code ${exitCode}`
                : "",
            durationMs,
            killed,
            oomKilled,
            containerId: podName || jobName,
            image,
          };

          // 5. Failure telemetry
          if (oomKilled) {
            getErrorReporter().captureInfraFailure({
              podName,
              jobName,
              namespace: this.namespace,
              image,
              exitCode: 137,
              oomKilled: true,
              reason: "INFRA_POD_OOM_KILLED",
              sessionId: request.sessionId,
              toolName: request.toolName,
            });
            getErrorReporter().captureContainerFailure({
              containerId: podName || jobName,
              image,
              exitCode: 137,
              oomKilled: true,
              memoryLimitBytes: memoryLimit,
              reason: "CONTAINER_OOM_KILLED",
              sessionId: request.sessionId,
              toolName: request.toolName,
            });
          } else if (exitCode !== 0 && !killed) {
            getErrorReporter().captureContainerFailure({
              containerId: podName || jobName,
              image,
              exitCode,
              oomKilled: false,
              reason: "CONTAINER_NON_ZERO_EXIT",
              stderr: result.stderr,
              sessionId: request.sessionId,
              toolName: request.toolName,
            });
          } else if (killed) {
            getErrorReporter().captureInfraFailure({
              podName,
              jobName,
              namespace: this.namespace,
              image,
              exitCode: 137,
              reason: "INFRA_SCHEDULING_TIMEOUT",
              sessionId: request.sessionId,
              toolName: request.toolName,
            });
            getErrorReporter().captureContainerFailure({
              containerId: podName || jobName,
              image,
              exitCode: 137,
              oomKilled: false,
              reason: "CONTAINER_TIMEOUT",
              sessionId: request.sessionId,
              toolName: request.toolName,
            });
          }

          return result;
        } catch (err: unknown) {
          if (timer) clearTimeout(timer);
          const error = err instanceof Error ? err : new Error(String(err));
          logger.error(
            { err: error, command: request.command, jobName, image },
            `[KubernetesJobExecutor] Job execution failed: ${error.message}`,
          );

          captureAgentError(error, {
            sessionId: request.sessionId,
            toolName: request.toolName,
            extra: { executor: this.name, jobName, image },
          });

          return {
            exitCode: 1,
            stdout: "",
            stderr: error.message,
            durationMs: Date.now() - startTime,
            killed,
            image,
          };
        } finally {
          if (jobCreated) {
            this.deleteJob(jobName).catch(() => {});
          }
        }
      },
    );
  }

  private async waitForJobPod(
    jobName: string,
    timeoutMs: number,
  ): Promise<{ podName?: string; exitCode: number; oomKilled: boolean }> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const podsRes = await this.fetchImpl(
        `${this.apiUrl}/api/v1/namespaces/${this.namespace}/pods?labelSelector=job-name=${jobName}`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
        },
      );

      if (podsRes.ok) {
        const podsData = (await podsRes.json()) as any;
        const items = podsData.items || [];
        if (items.length > 0) {
          const pod = items[0];
          const podName = pod.metadata?.name;
          const containerStatuses = pod.status?.containerStatuses || [];
          const execStatus = containerStatuses.find(
            (c: any) => c.name === "executor",
          );

          if (execStatus?.state?.terminated) {
            const terminated = execStatus.state.terminated;
            const exitCode = terminated.exitCode ?? 0;
            const oomKilled =
              terminated.reason === "OOMKilled" || exitCode === 137;
            return { podName, exitCode, oomKilled };
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    return { exitCode: 137, oomKilled: false };
  }

  private async fetchPodLogs(
    podName: string,
    containerName: string,
  ): Promise<string> {
    try {
      const res = await this.fetchImpl(
        `${this.apiUrl}/api/v1/namespaces/${this.namespace}/pods/${podName}/log?container=${containerName}`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
        },
      );
      if (res.ok) {
        const text = await res.text();
        return text.slice(0, this.maxBufferBytes);
      }
      return "";
    } catch {
      return "";
    }
  }

  private async deleteJob(jobName: string): Promise<void> {
    try {
      await this.fetchImpl(
        `${this.apiUrl}/apis/batch/v1/namespaces/${this.namespace}/jobs/${jobName}?propagationPolicy=Background`,
        {
          method: "DELETE",
          headers: this.getAuthHeaders(),
        },
      );
    } catch {
      // Best-effort cleanup
    }
  }
}
