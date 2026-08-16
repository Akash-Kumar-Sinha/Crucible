"use client";

import React, { useEffect, useRef, useState } from "react";

import { Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";

const roundnessClass = "rounded-lg";
const rowRoundnessClass = "rounded-lg";
const kbdRoundnessClass = "rounded-lg";

export interface Command {
  id: string;
  label: string;
  description?: string;
  group?: string;
  icon?: React.ReactNode;
  onSelect: () => void;
}

export type CommandItem = Command;

function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return { open, setOpen };
}

function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = "Search commands...",
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.description?.toLowerCase().includes(query.toLowerCase()),
      )
    : commands;

  const groups = filtered.reduce<Record<string, Command[]>>((acc, cmd) => {
    const g = cmd.group ?? "Commands";
    if (!acc[g]) acc[g] = [];
    acc[g].push(cmd);
    return acc;
  }, {});

  // The delay lets the open animation start before focus scrolls the page.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setQuery("");
      setSelected(0);
      inputRef.current?.focus();
    }, 30);
    return () => clearTimeout(timer);
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      filtered[selected]?.onSelect();
      onClose();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/80"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-1/2 top-[18%] -translate-x-1/2 z-50 w-full max-w-lg px-4"
          >
            <div
              className={cn(
                "overflow-hidden bg-black shadow-lg",
                roundnessClass,
              )}
            >
              <div className="flex items-center gap-3 px-3 py-3 sm:px-4 sm:py-3.5 border-b border-white/8">
                <Search className="w-4 h-4 text-white/40 shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelected(0);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  className="flex-1 min-w-0 bg-transparent text-white text-sm outline-none placeholder:text-white/20"
                />
                <kbd
                  className={cn(
                    "hidden sm:block text-white/20 text-[10px] px-1.5 py-0.5 border border-white/8",
                    kbdRoundnessClass,
                  )}
                >
                  Esc
                </kbd>
              </div>

              <div className="max-h-72 overflow-y-auto py-2 custom-scroll">
                {filtered.length === 0 ? (
                  <div className="py-8 text-center text-sm text-white/20">
                    No results for &ldquo;{query}&rdquo;
                  </div>
                ) : (
                  Object.entries(groups).map(([groupName, groupItems]) => (
                    <div key={groupName} className="px-2">
                      <div className="px-2 py-1.5 text-[10px] text-white/20 uppercase tracking-[0.15em] font-medium">
                        {groupName}
                      </div>
                      {groupItems.map((cmd) => {
                        const globalIndex = filtered.indexOf(cmd);
                        const isSelected = selected === globalIndex;
                        return (
                          <button
                            key={cmd.id}
                            onMouseEnter={() => setSelected(globalIndex)}
                            onClick={() => {
                              cmd.onSelect();
                              onClose();
                            }}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors duration-200",
                              rowRoundnessClass,
                              isSelected
                                ? "bg-white/8 text-white"
                                : "text-white/40 hover:text-white hover:bg-zinc-950",
                            )}
                          >
                            {cmd.icon && (
                              <span className="text-white/40 shrink-0">
                                {cmd.icon}
                              </span>
                            )}
                            <span className="flex-1 min-w-0 truncate">
                              {cmd.label}
                            </span>
                            {cmd.description && (
                              <span className="hidden sm:block text-xs text-white/20 shrink-0">
                                {cmd.description}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export { CommandPalette, useCommandPalette };
