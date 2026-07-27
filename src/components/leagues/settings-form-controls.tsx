'use client'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/**
 * Shared settings-form primitives for the create wizard (L.A2.1) AND the
 * settings panel (L.A2.4) — one set of controls, never forked (CLAUDE.md: no
 * near-duplicate components). Both surfaces drive the SAME `leagueSettingsSchema`
 * contract, so their field rows, toggles, selects, and inline issues render
 * identically. Presentational only; the settings algebra lives in the pure
 * `derived-settings` / `league-create-wizard-ops` modules.
 */

/** A validation/advisory message box (error = alert, warning = status). */
export function InlineIssue({ tone, message }: { tone: 'error' | 'warning'; message: string }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-sm border px-3 py-2 text-[12px] font-semibold text-ink',
        tone === 'error' ? 'border-negative bg-negative-soft' : 'border-caution bg-caution-soft',
      )}
    >
      {message}
    </p>
  )
}

/** A labelled row: label (+ optional hint) on the left, control on the right. */
export function FieldRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="text-[13px] font-bold">
          {label}
        </Label>
        {hint && <p className="text-[11px] font-semibold text-n-3">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** A labelled on/off row backed by the shared Switch. */
export function ToggleRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-bold">
          {label}
        </label>
        {hint && <p className="text-[11px] font-semibold text-n-3">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}

/** A compact Select over a list of {value,label} options. Values are strings
 *  on the wire (Radix Select), converted by the caller. */
export function ChoiceSelect({
  id,
  ariaLabel,
  value,
  options,
  onValueChange,
  width = 'w-40',
  disabled,
}: {
  id?: string
  ariaLabel?: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onValueChange: (value: string) => void
  width?: string
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn('h-btn-md text-[12px] font-bold', width)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A group divider label (overline style) above a settings sub-section. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="fs-overline border-t border-n-4 pt-2.5 text-[11px] text-n-3">{children}</div>
}

/** {value,label} option list from numbers, with an optional unit suffix. */
export const numOptions = (values: readonly number[], suffix = '') =>
  values.map((v) => ({ value: String(v), label: `${v}${suffix}` }))

/** Parse a number input, clamp to [min,max], falling back to `fallback` for
 *  empty/NaN so the control never emits an out-of-range or NaN value. */
export function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
