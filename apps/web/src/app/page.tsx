"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  Shield,
  Layers,
  Radio,
  TerminalSquare,
  GitBranch,
  Lock,
  Activity,
  ArrowUpRight,
  Cpu,
} from "lucide-react";
import { BackgroundBeams } from "@/components/ui/background-beams";
import { ProximityGlowCard } from "@/components/ui/proximity-glow";
import { CodeBlock } from "@/components/ui/code-block";
import { RadialSeparator } from "@/components/ui/radial-separator";
import { Notch } from "@/components/ui/notch";
import { GooeyInput } from "@/components/ui/gooey-input";
import { LoaderFive } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Logo, CrucibleWordmark } from "@/components/Logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Header } from "@/components/home/header";
import { HeroSection } from "@/components/home/hero-section";
import { Features } from "@/components/home/features";
import { About } from "@/components/home/about";
import { Footer } from "@/components/home/footer";
import { NotchSection } from "@/components/home/notch-section";

const FEATURES = [
  {
    index: "01",
    title: "Policy Guardrails",
    subtitle:
      "Human checkpoints intercept and pause dangerous or irreversible tool calls before they execute on the host.",
    icon: Shield,
    tags: [
      "Human in the Loop",
      "Irreversible Action Policy",
      "Turn Budget Enforcer",
    ],
  },
  {
    index: "02",
    title: "Sandboxed Compute",
    subtitle:
      "High-throughput Rust execution core isolated via Linux cgroups v2, ephemeral OverlayFS, and strict nftables network airgapping.",
    icon: Cpu,
    tags: ["cgroups v2", "OverlayFS Union Mount", "0.4ms gRPC IPC"],
  },
  {
    index: "03",
    title: "Multi-Session Actors",
    subtitle:
      "Actor-based orchestration with concurrent agent execution loops, strict Zod envelope schemas, and Redis persistence.",
    icon: Layers,
    tags: ["Actor Model FSM", "Redis Hot Cache", "Zod Envelope V1"],
  },
  {
    index: "04",
    title: "Live Observability",
    subtitle:
      "W3C Distributed TraceContext propagation, structured Pino telemetry, per-session latency histograms, and tool error rates.",
    icon: Activity,
    tags: ["W3C TraceContext", "Latency Percentiles", "Pino Structured Logs"],
  },
];

export default function LandingPage() {
  const router = useRouter();
  const [query, setQuery] = React.useState("");

  const handleSearchNavigate = React.useCallback(
    (value: string) => {
      const q = value.trim().toLowerCase();
      if (!q) return;
      if (q.includes("feature")) {
        document
          .getElementById("features")
          ?.scrollIntoView({ behavior: "smooth" });
      } else if (q.includes("about")) {
        document
          .getElementById("about")
          ?.scrollIntoView({ behavior: "smooth" });
      } else if (q.includes("workspace") || q.includes("app")) {
        router.push("/workspace");
      } else if (q.includes("metric")) {
        router.push("/metrics");
      }
    },
    [router],
  );

  return (
    <div className="relative min-h-dvh bg-background text-foreground">
      <BackgroundBeams className="pointer-events-none fixed inset-0 opacity-40" />

      <Header />

      <main>
        <HeroSection />

        <RadialSeparator />
        <Features />
        <RadialSeparator />

        <About />

        <section className="relative z-10 pb-28 min-h-screen py-12 flex flex-col justify-between items-center bg-neutral-50">
          <div className="mx-auto max-w-6xl px-6">
            <div
              className="relative overflow-hidden rounded-lg
 border border-white/8 bg-zinc-950 px-8 py-12 sm:px-12"
            >
              <BackgroundBeams className="opacity-30" />
              <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-xl">
                  <p className="text-xs font-medium tracking-[0.22em] text-white/35 uppercase font-mono">
                    Get started
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                    Open the harness and run your first session.
                  </h2>
                  <p className="mt-3 text-sm text-white/45">
                    Search the surface or jump straight into the workspace.
                  </p>
                </div>

                <div className="flex flex-col justify-start items-start gap-3.5">
                  <GooeyInput
                    placeholder="Search features..."
                    collapsedWidth={150}
                    expandedWidth={260}
                    expandedOffset={48}
                    value={query}
                    onValueChange={(value) => {
                      setQuery(value);
                      if (value.trim().length >= 3) {
                        handleSearchNavigate(value);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="lg"
                    className="gap-2"
                    onClick={() => router.push("/workspace")}
                  >
                    Enter Workspace
                    <ArrowUpRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <Footer />
        </section>
      </main>

      <NotchSection />
    </div>
  );
}
