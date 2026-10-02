"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

/**
 * Field Scout dialog — white panel, 1px ink border, near-square corners,
 * resting hard shadow. Overlay is flat black at 85% with NO backdrop blur.
 * Motion is a plain 200ms fade: the slide-*-1/2 utilities only pin the
 * centering transform during the animation frames — no zoom, no drift.
 */
const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/85 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Hide the built-in corner close button (when the caller renders its own). */
    hideClose?: boolean
    /** `fs` = the v13 look (landing + auth): rounded panel, soft shadow,
     *  dimmed blurred backdrop. Default is the current app look. */
    look?: "default" | "fs"
  }
>(({ className, children, hideClose = false, look = "default", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={look === "fs" ? "bg-black/40 backdrop-blur-sm" : undefined} />
    {/* Elevation exception: a modal genuinely floats above the page, so it
        keeps its resting shadow. See CLAUDE.md → "Elevation". */}
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 bg-white duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-1/2 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2",
        look === "fs"
          ? "rounded-fs-xl p-8 font-inter text-fs-ink shadow-fs-pop"
          : "rounded-sm border border-ink p-card-pad text-ink shadow-hard-8",
        className
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          className={cn(
            "absolute inline-flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none",
            look === "fs"
              ? "right-4 top-4 size-8 rounded-full bg-fs-page text-fs-text-3 hover:bg-fs-fill hover:text-fs-ink focus-visible:outline-fs-blue"
              : "right-3 top-3 rounded-sm p-[5px] text-ink hover:bg-n-4 hover:text-accent focus-visible:outline-accent"
          )}
        >
          <Icon name="close" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-h5 text-ink", className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm font-medium text-n-3", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
