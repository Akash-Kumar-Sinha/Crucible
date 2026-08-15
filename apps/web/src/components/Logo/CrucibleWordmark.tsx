import { cn } from "@/lib/utils";
import { Sacramento } from "next/font/google";

interface CrucibleWordmarkProps {
  className?: string;
}

const sacramento = Sacramento({ weight: "400", subsets: ["latin"] });
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
