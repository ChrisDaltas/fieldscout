import { cn } from '@/lib/utils'

import type { PillIcon, PillTone, SidePill } from './trades-mobile-ops'

/** Small shared parts of the mobile trade screens (handoff §2.4–2.6). */

const PILL_PATH: Record<PillIcon, string> = {
  clock: 'M8 4v4l2.5 1.5M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z',
  check: 'M3 8.5l3.2 3L13 4.5',
  x: 'M4 4l8 8M12 4l-8 8',
}

const PILL_TONE: Record<PillTone, string> = {
  pending: 'bg-m-go text-m-to',
  sent: 'bg-m-gg text-m-tg',
  accepted: 'bg-m-gg text-m-tg',
  declined: 'bg-m-gr text-m-tr',
  neutral: 'bg-m-b2 text-m-t3',
}

/** The status pill: 24px, 11/600, an 11px icon at stroke 2.2. */
export function StatusPill({ pill, className }: { pill: SidePill; className?: string }) {
  return (
    <span className={cn('flex h-6 flex-none items-center gap-[5px] rounded-pill px-2.5 text-[11px] font-semibold', PILL_TONE[pill.tone], className)} data-status-pill={pill.tone}>
      <svg viewBox="0 0 16 16" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={PILL_PATH[pill.icon]} />
      </svg>
      {pill.label}
    </span>
  )
}

/** The X close button: 36px circle, 16px X at stroke 2.2 (detail) or a b2
 *  fill with a 14px X (builder). */
export function CloseButton({ onClick, filled = false, disabled }: { onClick: () => void; filled?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Close"
      className={cn('flex size-9 flex-none items-center justify-center rounded-full text-m-t1 active:bg-m-b2 disabled:opacity-50', filled && 'bg-m-b2')}
    >
      <svg viewBox="0 0 16 16" width={filled ? 14 : 16} height={filled ? 14 : 16} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  )
}

/** A whole-row toggle (label + sub on the left, the switch on the right). */
export function ToggleRow({
  label,
  sub,
  on,
  onToggle,
  children,
}: {
  label: string
  sub?: string
  on: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className="flex w-full items-center gap-[10px] text-left">
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-[14px] font-semibold">{label}</span>
        {sub && <span className="text-[11px] font-medium text-m-t3">{sub}</span>}
      </span>
      {children}
    </button>
  )
}

/** A "$" disc for a FAAB asset (the app's; the handoff's draft-pick disc
 *  shape — 36 / 30px, b3 fill, t2 glyph). */
export function FaabDisc({ size }: { size: number }) {
  return (
    <span aria-hidden className="flex flex-none items-center justify-center rounded-full bg-m-b3s text-[13px] font-semibold text-m-t2" style={{ width: size, height: size }}>
      $
    </span>
  )
}
