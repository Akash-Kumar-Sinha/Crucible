"use client";

import React, { useRef, useEffect } from "react";
import { ChevronUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { RoleModelPicker } from "@/components/workspace/RoleModelPicker";
import { VoiceButton } from "@/components/workspace/VoiceButton";

export interface PromptInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  maxLength?: number;
  selectedRole?: string;
  selectedModel?: string;
  onRoleChange?: (roleId: string, defaultModel?: string) => void;
  onModelChange?: (modelId: string) => void;
  sessionId?: string;
  onTranscript?: (transcript: string) => void;
  onVoiceAutoSubmit?: (transcript: string) => void;
  voiceSlot?: React.ReactNode;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

const roundnessClass = "rounded-xl";

const button_theme = "bg-zinc-900 hover:bg-zinc-800";

const container_theme = cn(
  "bg-zinc-950/95",
  "border border-white/10",
  "shadow-[0_0_80px_rgba(255,255,255,0.06)]",
  "focus-within:border-white/20 focus-within:shadow-[0_0_90px_rgba(255,255,255,0.12)]",
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
  placeholder = "Describe what you want to build or speak a voice command...",
  disabled = false,
  className,
  maxLength,
  selectedRole,
  selectedModel,
  onRoleChange,
  onModelChange,
  sessionId,
  onTranscript,
  onVoiceAutoSubmit,
  voiceSlot,
  leftSlot,
  rightSlot,
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (canSubmit) onSubmit();
  };

  const hasRoleModelControls = Boolean(onRoleChange && onModelChange);
  const _hasVoiceControls = Boolean(voiceSlot || onTranscript);

  return (
    <div
      className={cn(
        "relative w-full p-3 sm:p-3.5 md:p-4 flex flex-col gap-2.5 sm:gap-3",
        roundnessClass,
        "transition-all duration-300 ease-out",
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

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5 flex-wrap">
        {/* Left Toolbar inside prompt box: Role & Model Pickers */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {leftSlot ? (
            leftSlot
          ) : hasRoleModelControls ? (
            <RoleModelPicker
              compact
              selectedRole={selectedRole}
              selectedModel={selectedModel}
              onRoleChange={onRoleChange!}
              onModelChange={onModelChange!}
              disabled={disabled || isLoading}
            />
          ) : (
            <span className="text-[10px] font-medium tracking-[0.14em] uppercase text-white/20 select-none">
              Enter
            </span>
          )}
        </div>

        {/* Right Toolbar inside prompt box: Mic Button, Character Counter & Send Action */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {showCounter && !isLoading && (
            <span className="font-mono text-[10px] text-neutral-500/70 tabular-nums select-none mr-1">
              {value.length}/{maxLength}
            </span>
          )}

          {/* Voice Microphone Button Inside Prompt Input */}
          {voiceSlot ? (
            voiceSlot
          ) : onTranscript ? (
            <VoiceButton
              sessionId={sessionId || "global"}
              onTranscript={onTranscript}
              onAutoSubmit={onVoiceAutoSubmit}
              disabled={disabled || isLoading}
            />
          ) : rightSlot ? (
            rightSlot
          ) : null}

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
                  "flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-white/10",
                  "transition-colors duration-200 focus:outline-none cursor-pointer",
                  button_theme,
                  canSubmit
                    ? "text-neutral-300 hover:text-white"
                    : "text-neutral-700",
                  !canSubmit && "cursor-not-allowed",
                )}
              >
                <ChevronUp className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
