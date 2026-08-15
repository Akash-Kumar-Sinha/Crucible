"use client";

import * as React from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { Shield, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface Crucible3DLogoProps {
  className?: string;
  size?: number;
}

export function Crucible3DLogo({ className, size = 420 }: Crucible3DLogoProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Raw mouse coordinates normalized from -1 to 1
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Smooth spring physics for natural fluid momentum
  const springConfig = { damping: 25, stiffness: 200, mass: 0.5 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  // 3D rotation angles
  const rotateX = useTransform(smoothY, [-0.5, 0.5], [16, -16]);
  const rotateY = useTransform(smoothX, [-0.5, 0.5], [-20, 20]);

  // Specular flare coordinates
  const flareX = useTransform(smoothX, [-0.5, 0.5], ["20%", "80%"]);
  const flareY = useTransform(smoothY, [-0.5, 0.5], ["20%", "80%"]);

  // Floating parallax offsets for different depth layers
  const depthZBack = useTransform(smoothY, [-0.5, 0.5], [-30, -10]);
  const depthZVessel = useTransform(smoothY, [-0.5, 0.5], [20, 40]);
  const depthZFlame = useTransform(smoothY, [-0.5, 0.5], [50, 75]);
  const depthZHud = useTransform(smoothY, [-0.5, 0.5], [80, 110]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    mouseX.set(x);
    mouseY.set(y);
  };

  const handlePointerLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={cn(
        "relative flex items-center justify-center select-none cursor-grab active:cursor-grabbing",
        className,
      )}
      style={{
        perspective: 1200,
        width: "100%",
        maxWidth: size,
        height: size,
      }}
    >
      {/* 3D Root Stage */}
      <motion.div
        style={{
          rotateX,
          rotateY,
          transformStyle: "preserve-3d",
        }}
        animate={{
          y: [-6, 6, -6],
        }}
        transition={{
          repeat: Infinity,
          duration: 6,
          ease: "easeInOut",
        }}
        className="relative flex h-full w-full items-center justify-center"
      >
        {/* Layer 0: Volumetric Ambient Glow Backplate (translateZ: -50px) */}
        <motion.div
          style={{
            transform: "translateZ(-50px)",
            transformStyle: "preserve-3d",
          }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div className="h-64 w-64 rounded-full bg-gradient-to-tr from-primary/20 via-blue-600/10 to-transparent blur-3xl" />
          <div className="absolute h-48 w-48 rounded-full bg-white/5 blur-2xl" />
        </motion.div>

        {/* Layer 1: Concentric Orbital Geometry Rings (translateZ: -20px) */}
        <motion.div
          style={{
            transform: "translateZ(-20px) rotateX(60deg)",
            transformStyle: "preserve-3d",
          }}
          className="absolute flex items-center justify-center pointer-events-none"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 25, ease: "linear" }}
            className="h-72 w-72 rounded-full border border-dashed border-white/15"
          />
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ repeat: Infinity, duration: 40, ease: "linear" }}
            className="absolute h-96 w-96 rounded-full border border-white/8"
          />
        </motion.div>

        {/* Layer 2: 3D Depth Shadow of Logo (translateZ: -10px) */}
        <motion.div
          style={{
            transform: "translateZ(-10px) scale(0.96)",
            transformStyle: "preserve-3d",
          }}
          className="absolute flex items-center justify-center opacity-30 blur-md pointer-events-none text-black"
        >
          <svg
            viewBox="0 0 496 496"
            className="w-56 h-56 sm:w-64 sm:h-64 text-black fill-current"
          >
            <path
              d="
                M150.000000,210.000000
                C150.000000,210.000000 138.000000,300.000000 168.000000,340.000000
                C198.000000,380.000000 298.000000,380.000000 328.000000,340.000000
                C358.000000,300.000000 346.000000,210.000000 346.000000,210.000000
              "
              stroke="black"
              strokeWidth="24"
              fill="none"
            />
            <path
              d="
                M120.000000,210.000000
                C120.000000,210.000000 376.000000,210.000000 376.000000,210.000000
              "
              stroke="black"
              strokeWidth="24"
            />
          </svg>
        </motion.div>

        {/* Layer 3: Crucible Vessel Body & Structural Rim (translateZ: +30px) */}
        <motion.div
          style={{
            transform: "translateZ(30px)",
            transformStyle: "preserve-3d",
          }}
          className="relative flex items-center justify-center drop-shadow-[0_15px_30px_rgba(0,0,0,0.8)]"
        >
          <svg
            viewBox="0 0 496 496"
            className="w-56 h-56 sm:w-64 sm:h-64 text-zinc-100"
          >
            <defs>
              <linearGradient
                id="vesselGrad"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="50%" stopColor="#a1a1aa" />
                <stop offset="100%" stopColor="#3f3f46" />
              </linearGradient>
              <linearGradient id="rimGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#71717a" />
                <stop offset="50%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#71717a" />
              </linearGradient>
            </defs>

            {/* Vessel Base */}
            <path
              fill="none"
              stroke="url(#vesselGrad)"
              strokeWidth="22"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="
                M150.000000,210.000000
                C150.000000,210.000000 138.000000,300.000000 168.000000,340.000000
                C198.000000,380.000000 298.000000,380.000000 328.000000,340.000000
                C358.000000,300.000000 346.000000,210.000000 346.000000,210.000000
              "
            />

            {/* Vessel Top Rim */}
            <path
              fill="none"
              stroke="url(#rimGrad)"
              strokeWidth="22"
              strokeLinecap="round"
              d="
                M120.000000,210.000000
                C120.000000,210.000000 376.000000,210.000000 376.000000,210.000000
              "
            />
          </svg>
        </motion.div>

        {/* Layer 4: Extruded Forge Flame with Dynamic Ember Glow (translateZ: +65px) */}
        <motion.div
          style={{
            transform: "translateZ(65px)",
            transformStyle: "preserve-3d",
          }}
          className="absolute flex items-center justify-center"
        >
          <svg
            viewBox="0 0 496 496"
            className="w-56 h-56 sm:w-64 sm:h-64 drop-shadow-[0_0_25px_rgba(59,130,246,0.5)]"
          >
            <defs>
              <linearGradient id="flameGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="35%" stopColor="#60a5fa" />
                <stop offset="80%" stopColor="#2563eb" />
                <stop offset="100%" stopColor="#1e3a8a" />
              </linearGradient>
            </defs>

            {/* Molten Flame Core */}
            <path
              fill="url(#flameGrad)"
              stroke="#93c5fd"
              strokeWidth="6"
              d="
                M248.783234,120.259918
                C254.180603,130.066422 259.452850,139.520477 264.580627,149.052277
                C270.381897,159.400574 271.393097,169.977722 262.509735,180.850708
                C257.586426,168.208862 253.195435,157.038849 246.197205,148.595657
                C245.500000,157.000000 258.000000,168.000000 250.000000,182.000000
                C242.000000,196.000000 220.000000,196.000000 212.000000,182.000000
                C204.000000,168.000000 216.000000,157.000000 215.303528,148.595657
                C208.305298,157.038849 203.914307,168.208862 198.991000,180.850708
                C190.107635,169.977722 191.118835,159.400574 196.920105,149.052277
                C202.047882,139.520477 207.320130,130.066422 212.717499,120.259918
                C217.500000,111.500000 224.000000,104.000000 231.500000,104.000000
                C239.000000,104.000000 244.000000,111.500000 248.783234,120.259918
                z
              "
            />
          </svg>
        </motion.div>

        {/* Layer 5: Floating HUD Telemetry Badges (translateZ: +95px) */}
        <motion.div
          style={{
            transform: "translateZ(95px)",
            transformStyle: "preserve-3d",
          }}
          className="absolute inset-0 flex items-center justify-between p-4 pointer-events-none"
        >
          {/* Top-Left Telemetry Tag */}
          <motion.div
            animate={{ y: [-4, 4, -4] }}
            transition={{ repeat: Infinity, duration: 4.2, ease: "easeInOut" }}
            className="flex items-center gap-1.5 rounded-full border border-primary/20 bg-zinc-950/80 px-3 py-1 text-[10px] text-zinc-300 backdrop-blur-md shadow-xl"
          >
            <Shield size={11} className="text-primary" />
            <span>SANDBOX CGROUPS V2</span>
          </motion.div>

          {/* Bottom-Right Telemetry Tag */}
          <motion.div
            animate={{ y: [4, -4, 4] }}
            transition={{ repeat: Infinity, duration: 3.8, ease: "easeInOut" }}
            className="absolute bottom-6 right-2 flex items-center gap-1.5 rounded-full border border-primary/20 bg-zinc-950/80 px-3 py-1 text-[10px] text-zinc-300 backdrop-blur-md shadow-xl"
          >
            <Zap size={11} className="text-primary" />
            <span>0.4ms RUST IPC</span>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
