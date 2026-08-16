"use client";

import React, { useRef, useEffect } from "react";

import { ChevronUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";

export interface PromptInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  maxLength?: number;
}

const roundnessClass = "rounded-lg";

const button_theme = "bg-zinc-900 hover:bg-zinc-800";

const container_theme = cn(
  "bg-zinc-950",
  "shadow-[0_0_80px_rgba(255,255,255,0.12)]",
  "focus-within:shadow-[0_0_90px_rgba(255,255,255,0.2)]",
);

const scrollbar = cn(
  "[scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.14)_transparent]",
  "[&::-webkit-scrollbar]:w-1.5",
  "[&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10",
  "hover:[&::-webkit-scrollbar-thumb]:bg-white/20",
);

export function PromptInput({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder = "Describe what you want to build...",
  disabled = false,
  className,
  maxLength,
}: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSubmit = !disabled && !isLoading && value.trim().length > 0;

  const showCounter =
    maxLength !== undefined && value.length >= Math.floor(maxLength * 0.8);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const resize = () => {
      if (isLoading) {
        el.style.height = "24px";
        return;
      }
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [value, isLoading]);

  // Enter submits; Shift+Enter inserts a newline. Enter is always swallowed so
  // it never leaves a stray newline behind when the prompt isn't submittable.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (canSubmit) onSubmit();
  };

  return (
    <div
      className={cn(
        "relative w-full p-2.5 sm:p-3 md:p-4 flex flex-col gap-2 sm:gap-3",
        roundnessClass,
        "transition-shadow duration-300 ease-out",
        container_theme,
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || isLoading}
        maxLength={maxLength}
        rows={1}
        className={cn(
          "w-full resize-none bg-transparent",
          "text-sm sm:text-base text-white leading-6 placeholder:text-white/20",
          "focus:outline-none",
          isLoading ? "overflow-hidden" : "overflow-y-auto",
          scrollbar,
          "transition-[height] duration-300 ease-out",
          (disabled || isLoading) && "cursor-not-allowed",
        )}
        style={{ minHeight: "24px", maxHeight: "160px" }}
      />

      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium tracking-[0.14em] uppercase text-white/20 select-none">
          Enter
        </span>

        <div className="flex items-center gap-3">
          {showCounter && !isLoading && (
            <span className="font-mono text-[10px] text-neutral-500/70 tabular-nums select-none">
              {value.length}/{maxLength}
            </span>
          )}

          <AnimatePresence mode="wait" initial={false}>
            {isLoading ? (
              <motion.div
                key="dots"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center justify-center gap-1.25 w-8 h-8 sm:w-9 sm:h-9"
              >
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="block w-1.25 h-1.25 rounded-full bg-neutral-500/70"
                    animate={{
                      opacity: [0.25, 1, 0.25],
                      scale: [0.85, 1, 0.85],
                    }}
                    transition={{
                      duration: 1.2,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: i * 0.18,
                    }}
                  />
                ))}
              </motion.div>
            ) : (
              <motion.button
                key="send"
                type="button"
                aria-label="Send message"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                whileTap={{ scale: 0.92 }}
                onClick={canSubmit ? onSubmit : undefined}
                disabled={!canSubmit}
                className={cn(
                  "flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9",
                  "transition-colors duration-200 focus:outline-none",
                  roundnessClass,
                  button_theme,
                  canSubmit
                    ? "text-neutral-400 hover:text-neutral-300"
                    : "text-neutral-700",
                  !canSubmit && "cursor-not-allowed",
                )}
              >
                <ChevronUp className={cn("w-4 h-4 sm:w-4.5 sm:h-4.5")} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
