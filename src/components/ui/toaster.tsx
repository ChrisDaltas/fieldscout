"use client"

import { useToast } from "@/hooks/use-toast"
import { Icon, type IconName } from "@/components/ui/icon"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  type ToastProps,
} from "@/components/ui/toast"
import { useLayoutModeValue } from "@/hooks/use-layout-mode"
import { cn } from "@/lib/utils"

type ToastVariant = NonNullable<ToastProps["variant"]>

// Leading icon per confirmation variant (desktop only — the phone's
// confirmation toast has no icon). Success green / caution amber are the
// kit's literal values; info rides the accent. An error has its own glyph
// below, on both layouts.
const toastIcons: Record<Exclude<ToastVariant, "destructive">, { name: IconName; className: string }> =
  {
    default: { name: "check-circle", className: "text-positive-strong" },
    success: { name: "check-circle", className: "text-positive-strong" },
    info: { name: "info-circle", className: "text-accent" },
    caution: { name: "info-circle", className: "text-caution-strong" },
  }

/**
 * The error toast's mark: a small bright-red alert glyph leading the title,
 * desktop and phone (Chris, 2026-10-18 — the bright red is for text and small
 * icons, so it rides here and never on the toast's fill). The "!" is cut out
 * of the glyph; the white disc behind it keeps it crisp on the phone's
 * dark-mode toast grey, where the toast surface would show through dimly.
 * Its box is the title's line height, so it sits on the title's first line
 * however many lines the body runs to.
 */
export function ToastAlertIcon() {
  return (
    <span aria-hidden className="relative flex h-[14px] w-[14px] shrink-0 items-center justify-center mob:h-[18px] mob:w-4">
      <span className="absolute size-2 rounded-full bg-white" />
      <Icon name="info-circle" size={14} className="relative text-negative-strong mob:size-4" />
    </span>
  )
}

export function Toaster() {
  const { toasts } = useToast()
  // The mobile design's toast is a one-line confirmation shown for about 2s
  // (handoff: 1.8–2.2s). An error, a second line or an action needs time to
  // read on a phone with no close button, so those keep the 4.5s default.
  const mobile = useLayoutModeValue() === "mobile"

  return (
    // Bottom-center stack; 4.5s auto-dismiss default, swipe down to clear.
    <ToastProvider duration={4500} swipeDirection="down">
      {toasts.map(function ({
        id,
        title,
        description,
        action,
        variant,
        ...props
      }) {
        const text = (
          <div className="grid min-w-0 flex-1 gap-0.5">
            {title && <ToastTitle>{title}</ToastTitle>}
            {description && (
              <ToastDescription>{description}</ToastDescription>
            )}
          </div>
        )
        return (
          <Toast
            key={id}
            variant={variant}
            {...props}
            duration={props.duration ?? (mobile && !description && !action && variant !== "destructive" ? 2000 : undefined)}
          >
            {variant === "destructive" ? (
              <div className="flex min-w-0 flex-1 items-start gap-2" data-toast-error>
                <ToastAlertIcon />
                {text}
              </div>
            ) : (
              <>
                <Icon
                  name={toastIcons[variant ?? "default"].name}
                  size={14}
                  className={cn("shrink-0 mob:hidden", toastIcons[variant ?? "default"].className)}
                />
                {text}
              </>
            )}
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
