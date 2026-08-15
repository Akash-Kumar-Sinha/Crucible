import { describe, expect, it } from "bun:test";
import {
  K8sJobConfigBuilder,
  KubernetesJobExecutor,
  type FetchFunction,
} from "./k8s-job-executor";
import type { ExecutionRequest, Executor } from "./executor.interface";

describe("Kubernetes Job Executor & Manifest Builder", () => {
  describe("K8sJobConfigBuilder (Builder Pattern & Pod Security Standards)", () => {
    it("should build a valid Kubernetes Job manifest complying with the Restricted PodSecurity profile", () => {
      const builder = new K8sJobConfigBuilder({
        jobName: "crucible-job-test-1234",
        namespace: "crucible",
        image: "crucible-sandbox-node:latest",
        command: "echo 'hello from k8s'",
        workingDir: "/workspace",
        memoryLimitBytes: 256 * 1024 * 1024,
        cpuLimitNano: 500_000_000,
        timeoutSeconds: 30,
        sessionId: "sess_k8s_test",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      });

      const manifest = builder.build();

      expect(manifest.apiVersion).toBe("batch/v1");
      expect(manifest.kind).toBe("Job");
      expect(manifest.metadata.name).toBe("crucible-job-test-1234");
      expect(manifest.metadata.namespace).toBe("crucible");
      expect(manifest.spec.backoffLimit).toBe(0);
      expect(manifest.spec.activeDeadlineSeconds).toBe(30);
      expect(manifest.spec.ttlSecondsAfterFinished).toBe(60);

      const podSpec = manifest.spec.template.spec;
      expect(podSpec.restartPolicy).toBe("Never");

      // Pod-level Restricted Security Context
      expect(podSpec.securityContext.runAsNonRoot).toBe(true);
      expect(podSpec.securityContext.runAsUser).toBe(10001);
      expect(podSpec.securityContext.runAsGroup).toBe(10001);
      expect(podSpec.securityContext.fsGroup).toBe(10001);
      expect(podSpec.securityContext.seccompProfile.type).toBe(
        "RuntimeDefault",
      );

      // Main container
      const execContainer = podSpec.containers.find(
        (c: any) => c.name === "executor",
      );
      expect(execContainer).toBeDefined();
      expect(execContainer.image).toBe("crucible-sandbox-node:latest");
      expect(execContainer.securityContext.allowPrivilegeEscalation).toBe(
        false,
      );
      expect(execContainer.securityContext.readOnlyRootFilesystem).toBe(true);
      expect(execContainer.securityContext.capabilities.drop).toContain("ALL");
      expect(execContainer.resources.limits.memory).toBe("256Mi");
      expect(execContainer.resources.limits.cpu).toBe("500m");

      // Sidecar container (Sidecar Pattern)
      const sidecarContainer = podSpec.containers.find(
        (c: any) => c.name === "observability-sidecar",
      );
      expect(sidecarContainer).toBeDefined();
      expect(sidecarContainer.securityContext.allowPrivilegeEscalation).toBe(
        false,
      );
      expect(sidecarContainer.securityContext.readOnlyRootFilesystem).toBe(
        true,
      );

      // Volumes
      expect(podSpec.volumes.some((v: any) => v.name === "workspace")).toBe(
        true,
      );
      expect(podSpec.volumes.some((v: any) => v.name === "tmp")).toBe(true);
      expect(podSpec.volumes.some((v: any) => v.name === "ipc-pipe")).toBe(
        true,
      );

      // Injected Traceparent
      expect(
        execContainer.env.some(
          (e: any) =>
            e.name === "TRACEPARENT" &&
            e.value ===
              "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        ),
      ).toBe(true);
    });
  });

  describe("KubernetesJobExecutor (Compute Adapter Pattern)", () => {
    it("should have correct executor identity", () => {
      const executor = new KubernetesJobExecutor();
      expect(executor.name).toBe("k8s_job");
    });

    it("should report availability true when Kubernetes API version endpoint returns 200", async () => {
      const mockFetch: FetchFunction = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes("/version")) {
          return new Response(
            JSON.stringify({ major: "1", minor: "29", gitVersion: "v1.29.0" }),
            { status: 200 },
          );
        }
        return new Response("Not found", { status: 404 });
      };

      const executor = new KubernetesJobExecutor({
        apiUrl: "http://mock-k8s.test",
        customFetch: mockFetch,
      });

      const isAvailable = await executor.isAvailable();
      expect(isAvailable).toBe(true);
    });

    it("should report availability false when Kubernetes API version endpoint fails", async () => {
      const mockFetch: FetchFunction = async () => {
        throw new Error("Connection refused to mock k8s");
      };

      const executor = new KubernetesJobExecutor({
        apiUrl: "http://unreachable-k8s.test",
        customFetch: mockFetch,
      });

      const isAvailable = await executor.isAvailable();
      expect(isAvailable).toBe(false);
    });

    it("should fallback to secondary executor when Kubernetes API is unavailable", async () => {
      const fallbackExecuted: ExecutionRequest[] = [];
      const mockFallback: Executor = {
        name: "mock_fallback",
        async isAvailable() {
          return true;
        },
        async execute(req: ExecutionRequest) {
          fallbackExecuted.push(req);
          return {
            exitCode: 0,
            stdout: "fallback output",
            stderr: "",
            durationMs: 15,
          };
        },
      };

      const mockFetch: FetchFunction = async () => {
        throw new Error("Cluster unreachable");
      };

      const executor = new KubernetesJobExecutor({
        apiUrl: "http://unreachable-k8s.test",
        fallbackExecutor: mockFallback,
        customFetch: mockFetch,
      });

      const result = await executor.execute({
        command: "echo fallback test",
        sessionId: "sess_fallback_test",
      });

      expect(fallbackExecuted.length).toBe(1);
      expect(result.stdout).toBe("fallback output");
      expect(result.exitCode).toBe(0);
    });

    it("should create Job, wait for Pod completion, stream logs, and delete Job", async () => {
      const apiCalls: { method: string; url: string; body?: any }[] = [];

      const mockFetch: FetchFunction = async (input: any, init?: any) => {
        const url = String(input);
        const method = init?.method || "GET";
        const body = init?.body ? JSON.parse(init.body) : undefined;
        apiCalls.push({ method, url, body });

        if (url.includes("/version")) {
          return new Response(JSON.stringify({ gitVersion: "v1.29.0" }), {
            status: 200,
          });
        }

        if (method === "POST" && url.includes("/apis/batch/v1/namespaces/")) {
          return new Response(JSON.stringify({ status: "Success" }), {
            status: 201,
          });
        }

        if (
          method === "GET" &&
          url.includes("/api/v1/namespaces/crucible/pods?labelSelector=")
        ) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  metadata: { name: "crucible-job-test-pod-abc" },
                  status: {
                    phase: "Succeeded",
                    containerStatuses: [
                      {
                        name: "executor",
                        state: {
                          terminated: {
                            exitCode: 0,
                            reason: "Completed",
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url.includes("/log?container=executor")) {
          return new Response(
            "K8S Task Output Line 1\nK8S Task Output Line 2\n",
            {
              status: 200,
            },
          );
        }

        if (method === "DELETE" && url.includes("/apis/batch/v1/namespaces/")) {
          return new Response(JSON.stringify({ status: "Success" }), {
            status: 200,
          });
        }

        return new Response(JSON.stringify({ status: "OK" }), { status: 200 });
      };

      const executor = new KubernetesJobExecutor({
        apiUrl: "http://mock-k8s.test",
        namespace: "crucible",
        customFetch: mockFetch,
        pollIntervalMs: 10,
      });

      let streamedStdout = "";
      const result = await executor.execute({
        command:
          'node -e \'console.log("K8S Task Output Line 1"); console.log("K8S Task Output Line 2")\'',
        sessionId: "sess_k8s_run",
        language: "node",
        onStdout: (chunk) => {
          streamedStdout += chunk;
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("K8S Task Output Line 1");
      expect(result.stdout).toContain("K8S Task Output Line 2");
      expect(streamedStdout).toContain("K8S Task Output Line 1");
      expect(result.containerId).toBe("crucible-job-test-pod-abc");

      // Verify Job creation and deletion calls
      const jobCreate = apiCalls.find(
        (c) =>
          c.method === "POST" &&
          c.url.includes("/apis/batch/v1/namespaces/crucible/jobs"),
      );
      expect(jobCreate).toBeDefined();

      const jobDelete = apiCalls.find(
        (c) =>
          c.method === "DELETE" &&
          c.url.includes("/apis/batch/v1/namespaces/crucible/jobs"),
      );
      expect(jobDelete).toBeDefined();
    });

    it("should capture OOMKilled state and report container failure telemetry", async () => {
      const mockFetch: FetchFunction = async (input: any, init?: any) => {
        const url = String(input);
        const method = init?.method || "GET";

        if (url.includes("/version")) {
          return new Response(JSON.stringify({ gitVersion: "v1.29.0" }), {
            status: 200,
          });
        }

        if (method === "POST" && url.includes("/jobs")) {
          return new Response(JSON.stringify({ status: "Success" }), {
            status: 201,
          });
        }

        if (method === "GET" && url.includes("/pods?labelSelector=")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  metadata: { name: "crucible-job-oom-pod" },
                  status: {
                    phase: "Failed",
                    containerStatuses: [
                      {
                        name: "executor",
                        state: {
                          terminated: {
                            exitCode: 137,
                            reason: "OOMKilled",
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url.includes("/log?container=executor")) {
          return new Response("JavaScript heap out of memory\n", {
            status: 200,
          });
        }

        return new Response(JSON.stringify({ status: "Success" }), {
          status: 200,
        });
      };

      const executor = new KubernetesJobExecutor({
        apiUrl: "http://mock-k8s.test",
        namespace: "crucible",
        customFetch: mockFetch,
        pollIntervalMs: 10,
      });

      const result = await executor.execute({
        command: "node -e 'const a = []; while(true) a.push(new Array(1e6))'",
        sessionId: "sess_oom_test",
        language: "node",
        memoryLimitBytes: 64 * 1024 * 1024,
      });

      expect(result.exitCode).toBe(137);
      expect(result.oomKilled).toBe(true);
      expect(result.stdout).toContain("heap out of memory");
    });
  });
});
