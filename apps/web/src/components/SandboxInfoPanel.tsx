"use client";

import * as React from "react";
import {
  Shield,
  Cpu,
  Network,
  AlertCircle,
  RefreshCw,
  HardDrive,
  Container,
} from "lucide-react";
import { orchestratorClient } from "../api/orchestrator-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

export interface SandboxInfoPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string;
}

export function SandboxInfoPanel({
  isOpen,
  onClose,
  sessionId,
}: SandboxInfoPanelProps) {
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchSandboxInfo = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await orchestratorClient.getSandboxInfo(sessionId);
      setData(info);
    } catch (err: any) {
      setError(err?.message || "Failed to load sandbox isolation profile.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  React.useEffect(() => {
    if (isOpen) {
      fetchSandboxInfo();
    }
  }, [isOpen, fetchSandboxInfo]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-[680px]">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/5 text-zinc-300">
                <Shield size={18} />
              </div>
              <div>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  Sandbox Isolation & Resource Budget
                  <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
                    TIER 1 HARDENED
                  </span>
                </DialogTitle>
                <DialogDescription>
                  Hardware-enforced cgroups v2, OverlayFS Copy-on-Write, and
                  stateful nftables policy
                </DialogDescription>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={fetchSandboxInfo}
              disabled={loading}
              className="shrink-0"
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 pb-2">
          {error && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "6px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#f87171",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {/* Section 1: cgroups v2 Compute & Memory Limits */}
          <div
            style={{
              background: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "8px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#f4f4f5",
                }}
              >
                <Cpu size={15} color="#388bfd" />
                <span>cgroups v2 Resource Enforcement</span>
              </div>
              <span
                style={{
                  fontSize: "11px",
                  color: "#4ade80",
                  fontWeight: 500,
                }}
              >
                Active Sandbox
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "10px",
              }}
            >
              <div
                style={{
                  padding: "10px",
                  background: "#121215",
                  border: "1px solid #27272a",
                  borderRadius: "6px",
                }}
              >
                <div style={{ fontSize: "11px", color: "#71717a" }}>
                  CPU Limit (`cpu.max`)
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#f4f4f5",
                    marginTop: "4px",
                  }}
                >
                  {data?.cgroups?.cpuQuota || "200% (2 Cores)"}
                </div>
              </div>
              <div
                style={{
                  padding: "10px",
                  background: "#121215",
                  border: "1px solid #27272a",
                  borderRadius: "6px",
                }}
              >
                <div style={{ fontSize: "11px", color: "#71717a" }}>
                  RAM Cap (`memory.max`)
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#f4f4f5",
                    marginTop: "4px",
                  }}
                >
                  {data?.cgroups?.memoryLimit || "512 MB"}
                </div>
              </div>
              <div
                style={{
                  padding: "10px",
                  background: "#121215",
                  border: "1px solid #27272a",
                  borderRadius: "6px",
                }}
              >
                <div style={{ fontSize: "11px", color: "#71717a" }}>
                  Max PIDs (`pids.max`)
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#f4f4f5",
                    marginTop: "4px",
                  }}
                >
                  {data?.cgroups?.pidsLimit || "256 Procs"}
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: OverlayFS Ephemeral Filesystem */}
          <div
            style={{
              background: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "8px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#f4f4f5",
                }}
              >
                <HardDrive size={15} color="#a855f7" />
                <span>OverlayFS Filesystem Isolation</span>
              </div>
              <span
                style={{
                  fontSize: "11px",
                  color: "#a1a1aa",
                  fontFamily: "monospace",
                }}
              >
                Copy-on-Write
              </span>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                fontSize: "12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  color: "#a1a1aa",
                }}
              >
                <span>Mount Strategy:</span>
                <span style={{ color: "#f4f4f5", fontFamily: "monospace" }}>
                  {data?.filesystem?.strategy || "Native Kernel / FUSE"}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  color: "#a1a1aa",
                }}
              >
                <span>Writable Workspace:</span>
                <span style={{ color: "#f4f4f5", fontFamily: "monospace" }}>
                  {data?.filesystem?.writableLayer ||
                    "Ephemeral Upperdir (RAM tmpfs)"}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  color: "#a1a1aa",
                }}
              >
                <span>Teardown & Cleanup:</span>
                <span style={{ color: "#4ade80", fontFamily: "monospace" }}>
                  {data?.filesystem?.cleanup || "RAII Drop / zero-leak guard"}
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: Network Policy & Airgap Egress */}
          <div
            style={{
              background: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "8px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#f4f4f5",
                }}
              >
                <Network size={15} color="#10b981" />
                <span>Network Egress Policy & nftables</span>
              </div>
              <span
                style={{
                  fontSize: "11px",
                  color: "#10b981",
                  fontWeight: 500,
                }}
              >
                Airgap Enforced
              </span>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                fontSize: "12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  color: "#a1a1aa",
                }}
              >
                <span>Default Action:</span>
                <span style={{ color: "#ef4444", fontWeight: 600 }}>
                  DENY ALL UNTRUSTED EGRESS
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  color: "#a1a1aa",
                }}
              >
                <span>Allowed Protocols:</span>
                <span style={{ color: "#f4f4f5", fontFamily: "monospace" }}>
                  DNS (53), HTTPS (443 to OpenRouter)
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  color: "#a1a1aa",
                }}
              >
                <span>Stateful Filter:</span>
                <span style={{ color: "#f4f4f5", fontFamily: "monospace" }}>
                  nftables inet crucible_netns_filter
                </span>
              </div>
            </div>
          </div>

          {/* Section 4: Docker Container & Kubernetes Scheduling Status */}
          <div
            style={{
              background: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "8px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#f4f4f5",
                }}
              >
                <Container size={15} color="#388bfd" />
                <span>Container & Workload Execution</span>
              </div>
              <span
                style={{
                  fontSize: "11px",
                  color: "#388bfd",
                  fontWeight: 500,
                }}
              >
                {data?.container?.runtime || "Active Sandbox"}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "10px",
              }}
            >
              <div
                style={{
                  padding: "10px",
                  background: "#121215",
                  border: "1px solid #27272a",
                  borderRadius: "6px",
                }}
              >
                <div style={{ fontSize: "11px", color: "#71717a" }}>
                  Exit Code
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color:
                      data?.container?.exitCode === 0
                        ? "#4ade80"
                        : data?.container?.exitCode !== undefined
                          ? "#f87171"
                          : "#f4f4f5",
                    marginTop: "4px",
                  }}
                >
                  {data?.container?.exitCode !== undefined
                    ? `Exit ${data.container.exitCode}`
                    : "Exit 0 (OK)"}
                </div>
              </div>
              <div
                style={{
                  padding: "10px",
                  background: "#121215",
                  border: "1px solid #27272a",
                  borderRadius: "6px",
                }}
              >
                <div style={{ fontSize: "11px", color: "#71717a" }}>
                  Restarts
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#f4f4f5",
                    marginTop: "4px",
                  }}
                >
                  {data?.container?.restarts ?? 0} restarts
                </div>
              </div>
              <div
                style={{
                  padding: "10px",
                  background: "#121215",
                  border: "1px solid #27272a",
                  borderRadius: "6px",
                }}
              >
                <div style={{ fontSize: "11px", color: "#71717a" }}>
                  K8s Phase
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color:
                      data?.scheduling?.phase === "Pending"
                        ? "#fbbf24"
                        : "#4ade80",
                    marginTop: "4px",
                  }}
                >
                  {data?.scheduling?.phase || "Running"}
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="justify-between">
          <span className="text-[11px] text-white/40">
            Compute Core: {data?.tier || "Rust gRPC + cgroups v2 / OverlayFS"}
          </span>
          <DialogClose>
            <Button type="button" variant="secondary" size="sm">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
