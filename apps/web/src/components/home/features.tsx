import * as React from "react";
import { Shield, Layers, Activity, Cpu } from "lucide-react";
import { ProximityGlowCard } from "@/components/ui/proximity-glow";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    index: "01",
    title: "Policy Guardrails",
    subtitle:
      "Human checkpoints intercept and pause dangerous or irreversible tool calls before they execute on the host.",
    icon: Shield,
  },
  {
    index: "02",
    title: "Sandboxed Compute",
    subtitle:
      "High-throughput Rust execution core isolated via Linux cgroups v2, ephemeral OverlayFS, and strict nftables network airgapping.",
    icon: Cpu,
  },
  {
    index: "03",
    title: "Multi-Session Actors",
    subtitle:
      "Actor-based orchestration with concurrent agent execution loops, strict Zod envelope schemas, and Redis persistence.",
    icon: Layers,
  },
  {
    index: "04",
    title: "Live Observability",
    subtitle:
      "W3C Distributed TraceContext propagation, structured Pino telemetry, per-session latency histograms, and tool error rates.",
    icon: Activity,
  },
];
export const Features = () => {
  return (
    <section
      id="features"
      className="relative z-10 bg-white py-24 text-zinc-950 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-6 sm:px-8">
        <div className="mb-14 max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-zinc-500">
            Features
          </p>

          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-zinc-900 sm:text-4xl">
            Built like infrastructure, not a chatbot shell.
          </h2>

          <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-500">
            Every surface is designed for operators who need isolation,
            auditability, and deterministic agent loops.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:auto-rows-75 md:gap-5">
          {FEATURES.map((feature, index) => {
            return (
              <ProximityGlowCard
                key={feature.index}
                radius={350}
                intensity={0.08}
                className={cn(
                  "min-h-70",
                  index === 0 || index === 3
                    ? "md:col-span-2"
                    : "md:col-span-1",
                )}
              >
                <div className="flex h-full flex-col p-6 sm:p-7 md:p-8">
                  <div className="mt-10 max-w-2xl">
                    <h3
                      className="
                        text-xl font-medium
                        tracking-tight
                        text-white
                        md:text-2xl
                      "
                    >
                      {feature.title}
                    </h3>

                    <p
                      className="
                        mt-3 max-w-xl
                        text-sm leading-6
                        text-white/40
                        transition-colors duration-300
                        group-hover:text-white/55
                      "
                    >
                      {feature.subtitle}
                    </p>
                  </div>
                </div>
              </ProximityGlowCard>
            );
          })}
        </div>
      </div>
    </section>
  );
};
