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
import { cn } from "@/lib/utils"

type ToastVariant = NonNullable<ToastProps["variant"]>

// Leading icon per variant. Success green / caution amber are the kit's
// literal values (no readable-on-white strong positive/caution token exists
// in the theme yet); info rides the ultramarine accent.
const toastIcons: Record<ToastVariant, { name: IconName; className: string }> =
  {
    default: { name: "check-circle", className: "text-positive-strong" },
    success: { name: "check-circle", className: "text-positive-strong" },
    info: { name: "info-circle", className: "text-accent" },
    caution: { name: "info-circle", className: "text-caution-strong" },
    destructive: { name: "info-circle", className: "text-ink" },
  }

export function Toaster() {
  const { toasts } = useToast()

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
        const icon = toastIcons[variant ?? "default"]
        return (
          <Toast key={id} variant={variant} {...props}>
            <Icon
              name={icon.name}
              size={14}
              className={cn("shrink-0", icon.className)}
            />
            <div className="grid min-w-0 flex-1 gap-0.5">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
