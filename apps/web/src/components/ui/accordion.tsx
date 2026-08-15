"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
} from "react";

import { Source_Serif_4 } from "next/font/google";

import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";

const _sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: "variable",
});

const roundnessClass = "rounded-md";

interface AccordionContextValue {
  openValue: string | null;
  toggle: (value: string) => void;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

const useAccordion = () => {
  const ctx = useContext(AccordionContext);
  if (!ctx) {
    throw new Error("Accordion parts must be used within <Accordion>.");
  }
  return ctx;
};

interface AccordionItemContextValue {
  value: string;
  open: boolean;
  triggerId: string;
  contentId: string;
}

const AccordionItemContext = createContext<AccordionItemContextValue | null>(
  null,
);

const useAccordionItem = () => {
  const ctx = useContext(AccordionItemContext);
  if (!ctx) {
    throw new Error(
      "AccordionTrigger/Content must be used within <AccordionItem>.",
    );
  }
  return ctx;
};

interface AccordionProps {
  children: React.ReactNode;
  className?: string;
  defaultValue?: string | null;
  value?: string | null;
  onValueChange?: (value: string | null) => void;
  type?: "single" | "multiple";
  collapsible?: boolean;
}

const Accordion = ({
  children,
  className,
  defaultValue,
  value,
  onValueChange,
}: AccordionProps) => {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string | null>(defaultValue ?? null);
  const openValue = isControlled ? value : internal;

  const setOpen = useCallback(
    (next: string | null) => {
      if (!isControlled) setInternal(next);
      onValueChange?.(next);
    },
    [isControlled, setInternal, onValueChange],
  );

  const toggle = (v: string) => setOpen(openValue === v ? null : v);

  useEffect(() => {
    if (openValue === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openValue, setOpen]);

  return (
    <AccordionContext.Provider value={{ openValue, toggle }}>
      <div
        data-accordion-root
        className={cn("flex flex-col gap-2", roundnessClass, className)}
      >
        {children}
      </div>
    </AccordionContext.Provider>
  );
};

interface AccordionItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

const AccordionItem = ({ value, children, className }: AccordionItemProps) => {
  const { openValue } = useAccordion();
  const open = openValue === value;
  const uid = useId();

  return (
    <AccordionItemContext.Provider
      value={{
        value,
        open,
        triggerId: `accordion-trigger-${uid}`,
        contentId: `accordion-content-${uid}`,
      }}
    >
      <div
        data-state={open ? "open" : "closed"}
        className={cn(
          "overflow-hidden bg-black transition-shadow duration-200",
          open && "shadow-lg",
          roundnessClass,
          className,
        )}
      >
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
};

interface AccordionTriggerProps {
  children: React.ReactNode;
  className?: string;
  chevronClassName?: string;
  hideChevron?: boolean;
}

const AccordionTrigger = ({
  children,
  className,
  chevronClassName,
  hideChevron = false,
}: AccordionTriggerProps) => {
  const { toggle } = useAccordion();
  const { value, open, triggerId, contentId } = useAccordionItem();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const root = e.currentTarget.closest("[data-accordion-root]");
    if (!root) return;
    const nodes = Array.from(
      root.querySelectorAll<HTMLButtonElement>(
        '[data-accordion-trigger="true"]',
      ),
    );
    const idx = nodes.indexOf(e.currentTarget);
    if (idx === -1) return;
    const nextIdx =
      e.key === "ArrowDown"
        ? Math.min(nodes.length - 1, idx + 1)
        : Math.max(0, idx - 1);
    nodes[nextIdx]?.focus();
  };

  return (
    <button
      type="button"
      id={triggerId}
      data-accordion-trigger="true"
      aria-expanded={open}
      aria-controls={contentId}
      onClick={() => toggle(value)}
      onKeyDown={handleKeyDown}
      className={cn(
        "group flex w-full items-center justify-between gap-4 px-5 py-4",
        "text-left outline-none transition-colors duration-200",
        "hover:bg-zinc-950 focus-visible:ring-2 focus-visible:ring-white/20",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {!hideChevron && (
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-white/40 transition-transform duration-200",
            "group-hover:text-white/60",
            open && "rotate-180",
            chevronClassName,
          )}
          aria-hidden
        />
      )}
    </button>
  );
};

interface AccordionContentProps {
  children: React.ReactNode;
  className?: string;
}

const AccordionContent = ({ children, className }: AccordionContentProps) => {
  const { open, triggerId, contentId } = useAccordionItem();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.section
          key="content"
          id={contentId}
          role="region"
          aria-labelledby={triggerId}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 30,
            mass: 0.4,
          }}
          className="overflow-hidden"
        >
          <div
            className={cn(
              "px-5 py-4 text-left text-sm leading-relaxed text-white/70",
              className,
            )}
          >
            {children}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
};

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
