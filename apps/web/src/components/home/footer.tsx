import Link from "next/link";
import { CrucibleWordmark, Logo } from "../Logo";
import { motion, useReducedMotion } from "motion/react";
import { fadeVariants, itemVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "About", href: "#about" },
];

const WORKSPACE_LINK = [
  { label: "Workspace", href: "/workspace" },
  { label: "Metrics", href: "/metrics" },
];

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black";

export const Footer = () => {
  const prefersReduced = useReducedMotion();
  const item = prefersReduced ? fadeVariants : itemVariants;
  return (
    <footer className="relative z-10 border-t border-white/8  bg-neutral-50 text-zinc-900 w-full">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/" className="flex items-center gap-1 group">
            <Logo className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 text-black" />
            <CrucibleWordmark className="  text-zinc-950 group-hover:text-primary transition-colors leading-none" />
          </Link>
          <p className="mt-3 max-w-sm text-sm text-neutral-600">
            High-performance AI agent execution harness — self-hosted,
            observable, and policy-aware.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-10 text-sm">
          <div className="space-y-2">
            <p className="text-xs tracking-[0.16em] text-neutral-600 uppercase font-mono">
              Platform
            </p>
            <motion.div
              variants={item}
              className="flex flex-col justify-start items-start gap-1 px-2 md:px-0"
            >
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1 rounded-none text-zinc-900 text-xs font-medium uppercase tracking-wider active:scale-[0.96]",
                    "transition-all duration-300",
                    "group relative",
                    FOCUS,
                  )}
                >
                  <motion.span className="absolute top-0 right-0 w-px h-0 bg-linear-to-b from-transparent via-zinc-950/40 to-zinc-950 transition-all duration-300 group-hover:h-full" />

                  <motion.span className="absolute bottom-0 left-0 w-px h-0 bg-linear-to-t from-transparent via-zinc-950/40 to-zinc-950 transition-all duration-300 group-hover:h-full" />
                  {link.label}
                </a>
              ))}
            </motion.div>
          </div>
          <div className="space-y-2">
            <p className="text-xs tracking-[0.16em] text-neutral-600 uppercase font-mono">
              Operators
            </p>
            <motion.div
              variants={item}
              className="flex flex-col justify-start items-start gap-1 px-2 md:px-0"
            >
              {WORKSPACE_LINK.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1 rounded-none text-zinc-900 text-xs font-medium uppercase tracking-wider active:scale-[0.96]",
                    "transition-all duration-300",
                    "group relative",
                    FOCUS,
                  )}
                >
                  <motion.span className="absolute top-0 right-0 w-px h-0 bg-linear-to-b from-transparent via-zinc-950/40 to-zinc-950 transition-all duration-300 group-hover:h-full" />

                  <motion.span className="absolute bottom-0 left-0 w-px h-0 bg-linear-to-t from-transparent via-zinc-950/40 to-zinc-950 transition-all duration-300 group-hover:h-full" />
                  {link.label}
                </a>
              ))}
            </motion.div>
          </div>
        </div>
      </div>
      <div className="border-t border-white/8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 text-xs text-neutral-600">
          <span>Self-hostable agent infrastructure</span>
        </div>
      </div>
    </footer>
  );
};
