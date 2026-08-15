import { cn } from "@/lib/utils";

interface CrucibleWordmarkProps {
  className?: string;
}

export const CrucibleWordmark = ({ className }: CrucibleWordmarkProps) => {
  return (
    <span
      className={cn(
        "sacramento.className  font-[Sacramento] text-2xl sm:text-3xl md:text-4xl text-white leading-none select-none tracking-normal",
        className,
      )}
    >
      Crucible
    </span>
  );
};
