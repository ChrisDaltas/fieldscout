'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { LogoTile } from '@/components/landing/fieldscout-logo'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Icon, type IconName } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

/**
 * Shared frame + form parts for the auth modals over the landing page
 * (sign in, create account, forgot / reset password), v13 look.
 *
 * Each modal is open exactly while the URL is its own route, so the same
 * component works both ways it's reached:
 *  - intercepted (app/@modal/(.)<route>) — opened from the homepage, which
 *    stays mounted underneath;
 *  - direct (app/<route>/page.tsx) — the landing page renders with it open.
 * Moving between modals (Sign in ↔ Create account ↔ Forgot password) uses
 * `AuthSwitchLink`, which replaces the history entry; closing replaces back
 * to `/`. So Back never walks through a stack of modals.
 */
export function AuthModal({
  route,
  title,
  description,
  children,
}: {
  route: string
  title: string
  description: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <Dialog
      open={pathname === route}
      onOpenChange={(open) => !open && router.replace('/', { scroll: false })}
    >
      <DialogContent look="fs" className="w-[calc(100%-32px)] max-w-[400px] gap-0 sm:p-9">
        <div className="flex flex-col">
          <LogoTile size={36} />
          <DialogTitle className="mt-5 text-[28px] font-bold leading-tight tracking-[-0.03em]">
            {title}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[15px] font-medium text-fs-text-3">
            {description}
          </DialogDescription>
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Link to another auth modal — replaces history so Back/close go home. */
export function AuthSwitchLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      replace
      scroll={false}
      className={cn('font-semibold text-fs-blue hover:text-fs-blue-hover', className)}
    >
      {children}
    </Link>
  )
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="mt-5 flex items-center gap-2 rounded-fs-md bg-negative-soft px-3.5 py-2.5 text-[13px] font-semibold text-fs-ink"
    >
      <Icon name="info-circle" size={14} className="shrink-0 text-negative-strong" />
      {message}
    </div>
  )
}

const inputClass =
  'mt-1.5 h-12 w-full rounded-fs-md bg-fs-page px-4 text-[15px] font-medium text-fs-ink outline-none transition-shadow placeholder:text-fs-text-4 focus:bg-white focus:ring-2 focus:ring-fs-blue'

/** Label + input. `aside` sits right of the label (e.g. "Forgot password?"). */
export function AuthField({
  id,
  label,
  aside,
  first = false,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string
  label: string
  aside?: React.ReactNode
  /** First field after the heading takes the larger top gap. */
  first?: boolean
}) {
  return (
    <>
      <div className={cn('flex items-center justify-between', first ? 'mt-6' : 'mt-4')}>
        <label htmlFor={id} className="text-[13px] font-semibold">
          {label}
        </label>
        {aside}
      </div>
      <input id={id} className={inputClass} {...input} />
    </>
  )
}

export function AuthSubmit({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-7 flex h-12 w-full items-center justify-center rounded-pill bg-fs-blue text-[16px] font-semibold text-white transition-colors hover:bg-fs-blue-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fs-blue disabled:opacity-60"
    >
      {busy ? busyLabel : label}
    </button>
  )
}

/** Small centred line under the submit button ("Already have an account? …"). */
export function AuthFooter({ children }: { children: React.ReactNode }) {
  return <p className="mt-5 text-center text-[14px] font-medium text-fs-text-3">{children}</p>
}

/** "We sent you a link" confirmation body, shared by sign-up and forgot password. */
export function AuthNotice({
  icon = 'email',
  children,
}: {
  icon?: IconName
  children: React.ReactNode
}) {
  return (
    <div className="mt-6 flex items-start gap-3 rounded-fs-md bg-fs-page p-4">
      <span className="flex size-9 flex-none items-center justify-center rounded-full bg-fs-blue-soft text-fs-blue">
        <Icon name={icon} size={15} />
      </span>
      <p className="text-[14px] font-medium leading-normal text-fs-text-2">{children}</p>
    </div>
  )
}
