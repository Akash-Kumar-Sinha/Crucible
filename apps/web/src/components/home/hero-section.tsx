import { motion } from "motion/react";
import { Logo } from "../Logo";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export const HeroSection = () => {
  const router = useRouter();
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white text-zinc-950">
      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center px-6 pb-20 pt-28 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <Logo className="w-14 h-14 sm:w-18 sm:h-18 md:w-22 md:h-22 text-black" />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.4 }}
          className="mb-4 text-xs font-medium tracking-[0.28em] uppercase"
        >
          Crucible Reasoning Harness
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.16,
            duration: 0.55,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl lg:leading-[1.1]"
        >
          Agent execution,
          <span className="block text-black/70">forged for production.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.26, duration: 0.45 }}
          className="mt-6 max-w-xl text-base sm:text-lg leading-relaxed text-black/70"
        >
          Self-hostable autonomous reasoning orchestrator with sandboxed
          compute, policy checkpoints, and live observability.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36, duration: 0.4 }}
          className="mt-9 flex flex-wrap items-center justify-center gap-3.5"
        >
          <Button
            type="button"
            size="lg"
            onClick={() => router.push("/workspace/session")}
          >
            Launch Session
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={() =>
              document
                .getElementById("features")
                ?.scrollIntoView({ behavior: "smooth" })
            }
            className="hover:bg-zinc-950 hover:text-zinc-50 bg-white text-zinc-950 transition-all durationduration-300 "
          >
            Explore Features
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.48, duration: 0.55 }}
          className="mt-12 flex flex-wrap items-center justify-center gap-3 text-xs uppercase text-zinc-800"
        >
          <span className="rounded-full border-2 border-white bg-zinc-100/60 p-2 px-3 flex items-center justify-center text-nowrap">
            Sandboxed Compute
          </span>
          <span className="rounded-full border-2 border-white bg-zinc-100/60 p-2 px-3 flex items-center justify-center text-nowrap">
            Multi-Session Actors
          </span>
          <span className="rounded-full border-2 border-white bg-zinc-100/60 p-2 px-3 flex items-center justify-center text-nowrap">
            Live Observability
          </span>
          <span className="rounded-full border-2 border-white bg-zinc-100/60 p-2 px-3 flex items-center justify-center text-nowrap">
            Policy Guardrails
          </span>
        </motion.div>
      </div>
    </section>
  );
};
