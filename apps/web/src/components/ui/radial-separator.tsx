import { cn } from "@/lib/utils";
type Direction = "horizontal" | "vertical";
export const RadialSeparator = ({
  className,
  direction = "horizontal",
}: {
  className?: string;
  direction?: Direction;
}) => {
  const isVertical = direction === "vertical";
  return (
    <div
      className={cn(
        "absolute bg-linear-to-r from-transparent via-blue-500 to-transparent",
        isVertical
          ? "inset-y-0 w-px h-3/4 my-auto bg-linear-to-b"
          : "inset-x-0 h-px w-3/4 mx-auto bg-linear-to-r",
        className,
      )}
    />
  );
};
