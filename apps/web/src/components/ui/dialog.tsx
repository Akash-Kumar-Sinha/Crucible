"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";

// Open springs; close uses a short tween so dismissal never feels laggy.
const OPEN_SPRING = {
  type: "spring",
  stiffness: 300,
  damping: 28,
  mass: 0.1,
} as const;

const CLOSE_TWEEN = { duration: 0.12, ease: [0.4, 0, 1, 1] } as const;

interface DialogContextValue {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogCtx() {
  const ctx = useContext(DialogContext);
  if (!ctx)
    throw new Error("Dialog sub-components must be wrapped in <Dialog>.");
  return ctx;
}

const roundnessClass = "rounded-lg";
const pillRoundnessClass = "rounded-full";

interface DialogProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}

function Dialog({
  children,
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
}: DialogProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen! : internalOpen;

  const onOpen = useCallback(() => {
    if (!isControlled) setInternalOpen(true);
    onOpenChange?.(true);
  }, [isControlled, onOpenChange]);

  const onClose = useCallback(() => {
    if (!isControlled) setInternalOpen(false);
    onOpenChange?.(false);
  }, [isControlled, onOpenChange]);

  return (
    <DialogContext.Provider value={{ open, onOpen, onClose }}>
      {children}
    </DialogContext.Provider>
  );
}

function DialogTrigger({ children }: { children: React.ReactNode }) {
  const { onOpen } = useDialogCtx();

  if (React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<React.HTMLAttributes<HTMLElement>>,
      {
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          (
            children as React.ReactElement<React.HTMLAttributes<HTMLElement>>
          ).props.onClick?.(e);
          onOpen();
        },
      },
    );
  }
  return (
    <span onClick={onOpen} className="cursor-pointer">
      {children}
    </span>
  );
}

interface DialogCloseProps {
  children?: React.ReactNode;
  className?: string;
}

function DialogClose({ children, className }: DialogCloseProps) {
  const { onClose } = useDialogCtx();

  if (children && React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<React.HTMLAttributes<HTMLElement>>,
      {
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          (
            children as React.ReactElement<React.HTMLAttributes<HTMLElement>>
          ).props.onClick?.(e);
          onClose();
        },
      },
    );
  }

  return (
    <button
      onClick={onClose}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium",
        pillRoundnessClass,
        "text-white/60 hover:text-white transition-colors duration-200",
        "bg-black hover:bg-zinc-950",
        className,
      )}
    >
      {children ?? "Cancel"}
    </button>
  );
}

interface DialogContentProps {
  children: React.ReactNode;
  className?: string;
  showCloseButton?: boolean;
}

function DialogContent({
  children,
  className,
  showCloseButton = true,
}: DialogContentProps) {
  const { open, onClose } = useDialogCtx();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", handle);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="dialog-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "linear" }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              key="dialog-panel"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: CLOSE_TWEEN }}
              transition={OPEN_SPRING}
              className={cn(
                "pointer-events-auto relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden",
                roundnessClass,
                "bg-black shadow-lg",
                className,
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {showCloseButton && (
                <button
                  onClick={onClose}
                  aria-label="Close dialog"
                  className={cn(
                    "absolute top-4 right-4 z-10 p-1.5 text-white/40 transition-colors duration-200 hover:bg-zinc-950 hover:text-white",
                    pillRoundnessClass,
                  )}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <div className="overflow-y-auto">{children}</div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

function DialogHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5 px-6 pt-6 pb-4", className)}>
      {children}
    </div>
  );
}

function DialogTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "text-base font-semibold text-white tracking-tight pr-8",
        className,
      )}
    >
      {children}
    </h2>
  );
}

function DialogDescription({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-sm text-white/60 leading-relaxed", className)}>
      {children}
    </p>
  );
}

function DialogFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-3 px-6 pb-6 pt-4",
        "border-t border-white/8",
        className,
      )}
    >
      {children}
    </div>
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
};
