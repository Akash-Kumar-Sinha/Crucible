import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo, CrucibleWordmark } from "@/components/Logo";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "About", href: "#about" },
];

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black";

export const Header = () => {
  const router = useRouter();
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6"
      >
        <Link href="/" className="flex items-center gap-1 group">
          <Logo className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 text-black" />
          <CrucibleWordmark className="  text-zinc-950 group-hover:text-primary transition-colors leading-none" />
        </Link>

        <nav className="hidden md:flex items-center justify-center">
          {NAV_LINKS.map((link) => (
            <motion.a
              key={link.href}
              href={link.href}
              initial="rest"
              whileHover="hover"
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1 rounded-none  text-zinc-950  text-[11px] font-medium uppercase tracking-wider active:scale-[0.96]",
                "transition-all duration-300",
                FOCUS,
              )}
            >
              <motion.span
                variants={{
                  rest: { scaleX: 0 },
                  hover: { scaleX: 1 },
                }}
                transition={{ duration: 0.3 }}
                className="absolute top-0 left-0 h-px w-full origin-left bg-linear-to-r from-transparent via-zinc-950 to-zinc-950"
              />
              <motion.span
                variants={{
                  rest: { scaleX: 0 },
                  hover: { scaleX: 1 },
                }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="absolute bottom-0 left-0 h-px w-full origin-right bg-linear-to-l from-transparent via-zinc-950 to-zinc-950"
              />
              {link.label}
            </motion.a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => router.push("/metrics")}
          >
            Metrics
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => router.push("/workspace")}
          >
            Open Workspace
          </Button>
        </div>
      </motion.div>
    </header>
  );
};
