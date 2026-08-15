"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { motion, useSpring } from "motion/react";
import { cn } from "@/lib/utils";

const GENTLE = {
  stiffness: 150,
  damping: 22,
  mass: 0.1,
} as const;

const ROUNDNESS = "rounded-lg";

export interface ProximityGlowProps {
  children?: ReactNode;
  radius?: number;
  intensity?: number;
  className?: string;
  title?: string;
  subtitle?: ReactNode;
  titleClassName?: string;
}

const ProximityGlowCard = ({
  children,
  radius = 200,
  intensity = 1,
  className,
  title,
  subtitle,
  titleClassName,
}: ProximityGlowProps) => {
  const ref = useRef<HTMLDivElement>(null);

  const proximitySpring = useSpring(0, GENTLE);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();

      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const distance = Math.hypot(e.clientX - centerX, e.clientY - centerY);

      const proximity = Math.max(0, 1 - distance / radius);

      proximitySpring.set(proximity * intensity);
    },
    [radius, intensity, proximitySpring],
  );

  const handlePointerLeave = useCallback(() => {
    proximitySpring.set(0);
  }, [proximitySpring]);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) {
      return;
    }

    window.addEventListener("pointermove", handlePointerMove);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [handlePointerMove]);

  return (
    <div
      ref={ref}
      onPointerLeave={handlePointerLeave}
      className={cn(
        "group relative h-full overflow-hidden bg-zinc-950",
        ROUNDNESS,
        className,
      )}
    >
      {/* Proximity glow */}
      <motion.div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 z-0",
          "bg-white/[0.07]",
          ROUNDNESS,
        )}
        style={{
          opacity: proximitySpring,
        }}
      />

      {/* Card surface */}
      <div
        className={cn(
          "relative z-10 flex h-full w-full flex-col",
          "justify-between overflow-hidden",
          "bg-zinc-900 p-6 sm:p-8 md:p-10",
          ROUNDNESS,
        )}
      >
        {/* Status indicator */}
        <div className="flex items-start justify-end">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              "bg-white/15",
              "transition-all duration-500",
              "group-hover:bg-white",
              "group-hover:shadow-[0_0_8px_rgba(255,255,255,0.7)]",
            )}
          />
        </div>

        {/* Custom content */}
        {children && (
          <div
            className={cn(
              "pointer-events-none absolute inset-0",
              "overflow-hidden",
              ROUNDNESS,
            )}
          >
            {children}
          </div>
        )}

        {/* Optional title */}
        {(title || subtitle) && (
          <div className="relative z-30 mt-auto space-y-3">
            {title && (
              <h3
                className={cn(
                  "font-medium tracking-tight text-white",
                  titleClassName,
                )}
              >
                {title}
              </h3>
            )}

            {subtitle && (
              <div className="max-w-xl text-sm leading-relaxed text-white/45">
                {subtitle}
              </div>
            )}

            <div
              className={cn(
                "h-px w-8 bg-white/10",
                "transition-all duration-700 ease-out",
                "group-hover:w-full",
                "group-hover:bg-white/20",
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export { ProximityGlowCard };
