import { cn } from "@/lib/utils";

interface CrucibleLogoProps {
  className?: string;
}

export const CrucibleLogo = ({ className }: CrucibleLogoProps) => {
  return (
    <svg
      version="1.1"
      id="Layer_1"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 496 496"
      enableBackground="new 0 0 496 496"
      className={cn("w-6 h-6 sm:w-7 sm:h-7 shrink-0", className)}
    >
      <path fill="currentColor" d="M150,225 L346,225 L318,359 L178,359 Z" />
      <path fill="currentColor" d="M248,137 L286,215 Q248,219 210,215 Z" />
    </svg>
  );
};

export const Logo = CrucibleLogo;
