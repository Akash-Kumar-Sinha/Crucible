import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { LoaderFive } from "../ui/loader";
import { CodeBlock } from "../ui/code-block";

const DEMO_CODE = `import { AgentLoop } from "@crucible/orchestrator";

  const loop = new AgentLoop({
  provider: "openrouter",
  tools: registry.list(),
  guardrails: ["irreversible-action", "resource-budget"],
});

await loop.run({
  sessionId,
  goal: "Audit sandbox isolation and report quotas",
});`;

export const About = () => {
  return (
    <section
      id="about"
      className="relative z-10 py-24 sm:py-28 mih-h-screen bg-white text-zinc-950"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
        <div>
          <p className="text-xs font-medium tracking-[0.22em] text-neutral-800 uppercase">
            About
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-600 sm:text-4xl">
            A harness for serious agent workloads.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-neutral-600 sm:text-base">
            Crucible combines a TypeScript orchestration layer with a Rust
            execution core. Sessions are actors, tools are typed, and dangerous
            actions wait for human approval.
          </p>
          <div className="mt-8 flex items-center gap-3 text-neutral-600">
            <LoaderFive text="Orchestrating" />
          </div>
          <div className="mt-10 grid gap-3.5 sm:grid-cols-2">
            <Card className="bg-zinc-900 text-neutral-50">
              <CardHeader className="p-4 sm:p-5">
                <CardTitle className="flex items-center gap-2 text-sm ">
                  OpenRouter native
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm text-neutral-300">
                  One gateway for models, tools, and streaming.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card className="bg-zinc-900 text-neutral-50">
              <CardHeader className="p-4 sm:p-5">
                <CardTitle className="flex items-center gap-2 text-sm ">
                  Operator UI
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm text-neutral-300">
                  Sessions, approvals, sandbox budgets, and traces.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>

        <Card className="bg-zinc-900 text-neutral-50">
          <CardHeader className="p-4 sm:p-5">
            <CardTitle className="flex items-center gap-2 text-sm ">
              Agent loop sketch
            </CardTitle>
            <CardDescription>
              Finite-state orchestration with guardrail checkpoints.
            </CardDescription>
          </CardHeader>
          <CardContent className="">
            <CodeBlock
              language="typescript"
              filename="agent-loop.ts"
              code={DEMO_CODE}
              highlightLines={[6, 7, 11]}
            />
          </CardContent>
        </Card>
      </div>
    </section>
  );
};
