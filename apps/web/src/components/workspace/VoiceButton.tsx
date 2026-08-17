"use client";

import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mic, Loader2, AlertCircle } from "lucide-react";
import { useLiveKitVoice } from "./useLiveKitVoice";
import { cn } from "@/lib/utils";

export interface VoiceButtonProps {
  sessionId: string;
  onTranscript?: (transcript: string) => void;
  onAutoSubmit?: (transcript: string) => void;
  autoSubmit?: boolean;
  className?: string;
  disabled?: boolean;
}

export function VoiceButton({
  sessionId,
  onTranscript,
  onAutoSubmit,
  autoSubmit = false,
  className,
  disabled = false,
}: VoiceButtonProps) {
  const {
    status: _status,
    isRecording,
    isTranscribing,
    audioLevel,
    error,
    toggleRecording,
    stopRecording,
  } = useLiveKitVoice({
    sessionId,
    onTranscript,
    onAutoSubmit,
    autoSubmit,
  });

  return (
    <div className={cn("relative inline-flex items-center gap-2", className)}>
      {/* Visual Feedback Pill for Recording / Transcribing */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, x: 8 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: 8 }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/90 border border-red-500/30 shadow-lg text-xs font-mono backdrop-blur-md"
          >
            {/* Pulsing Recording Dot */}
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>

            <span className="text-zinc-200 font-medium">Recording</span>

            {/* Dynamic Waveform Visualizer */}
            <div className="flex items-center gap-0.5 h-4 ml-1">
              {[0.4, 0.8, 1.0, 0.6, 0.9].map((scaleFactor, idx) => {
                const height = Math.max(
                  3,
                  Math.min(16, Math.round((audioLevel * 16 + 3) * scaleFactor)),
                );
                return (
                  <motion.span
                    key={idx}
                    className="w-1 bg-red-400 rounded-full"
                    animate={{ height }}
                    transition={{ type: "spring", stiffness: 500, damping: 20 }}
                  />
                );
              })}
            </div>

            <button
              type="button"
              onClick={stopRecording}
              className="ml-1 text-[11px] text-zinc-400 hover:text-white underline cursor-pointer"
            >
              Done
            </button>
          </motion.div>
        )}

        {isTranscribing && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, x: 8 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: 8 }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/90 border border-sky-500/30 shadow-lg text-xs font-mono backdrop-blur-md"
          >
            <Loader2 size={13} className="animate-spin text-sky-400" />
            <span className="text-zinc-200">Transcribing speech...</span>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-500/30 text-rose-300 text-[11px] font-mono"
            title={error}
          >
            <AlertCircle size={12} className="text-rose-400" />
            <span className="max-w-[140px] truncate">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Microphone Button */}
      <motion.button
        type="button"
        aria-label={
          isRecording
            ? "Stop voice recording"
            : isTranscribing
              ? "Transcribing voice command"
              : "Start voice recording"
        }
        onClick={toggleRecording}
        disabled={disabled || isTranscribing}
        whileTap={{ scale: 0.92 }}
        className={cn(
          "relative flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-lg transition-all focus:outline-none cursor-pointer",
          isRecording
            ? "bg-red-500/20 text-red-400 border border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)]"
            : isTranscribing
              ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
              : "bg-zinc-900 hover:bg-zinc-800 text-neutral-400 hover:text-neutral-200 border border-white/10",
          disabled && "opacity-50 cursor-not-allowed",
        )}
        title={
          isRecording
            ? "Click to finish voice recording"
            : isTranscribing
              ? "Transcribing voice input..."
              : "Click to speak voice command (LiveKit STT)"
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          {isRecording ? (
            <motion.div
              key="rec"
              initial={{ scale: 0.8 }}
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            >
              <Mic size={16} className="text-red-400" />
            </motion.div>
          ) : isTranscribing ? (
            <motion.div
              key="transcribe"
              initial={{ rotate: 0 }}
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
            >
              <Loader2 size={16} className="text-sky-400" />
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
            >
              <Mic size={16} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
