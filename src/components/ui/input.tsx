import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * FieldScout input — v7 field: 29px, light grey fill that darkens a step on
 * hover and turns white with the v7 blue focus ring (`shadow-field`) on
 * focus. Labels above the field belong to callers.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-input w-full rounded-md bg-surface-control px-2.5 text-[11px] font-medium text-ink transition-[background-color,box-shadow] file:border-0 file:bg-transparent file:text-[11px] file:font-medium file:text-ink placeholder:text-n-6 hover:bg-n-4 focus:bg-white focus:shadow-field focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
