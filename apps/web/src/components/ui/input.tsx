import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          type === "file" &&
            "h-11 cursor-pointer overflow-hidden py-0 pl-0 pr-3 leading-[2.75rem] text-muted-foreground file:mr-4 file:h-full file:cursor-pointer file:border-0 file:bg-emerald-100 file:px-5 file:text-sm file:font-semibold file:text-emerald-950 file:transition-colors hover:file:bg-emerald-200",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
