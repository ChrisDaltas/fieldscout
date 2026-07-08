import { cn } from "@/lib/utils"

/**
 * Field Scout skeleton — flat static grey block (n-4), near-square corners.
 * No pulse, no shimmer: loading states sit still in the brutal system.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-sm bg-n-4", className)} {...props} />
}

export { Skeleton }
