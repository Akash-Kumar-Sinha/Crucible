import type { Variants } from "motion/react";

export const EASE = [0.22, 1, 0.36, 1] as const;

export const VIEWPORT = { once: true, amount: 0.25 } as const;

export const columnVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5 } },
};

export const headlineVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

export const wordVariants: Variants = {
  hidden: { y: "110%" },
  visible: { y: 0, transition: { duration: 0.85, ease: EASE } },
};
