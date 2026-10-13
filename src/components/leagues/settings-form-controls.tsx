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

/**
 * v7 settings rows: inside a settings group card (a `.settings-rows`
 * container — see settings-panel's GroupCard) every row is separated by a
 * 1px hairline and sits ~43px tall, like v7's commissioner sections. Outside
 * one (the create wizard, the mock-launch dialog) the same rows render bare,
 * so those surfaces keep their own rhythm.
 */
const IN_GROUP_ROW =
  '[.settings-rows_&]:min-h-[43px] [.settings-rows_&]:border-t [.settings-rows_&]:border-n-4 [.settings-rows_&]:py-2'

/** A validation/advisory message box (error = alert, warning = status). */
export function InlineIssue({ tone, message }: { tone: 'error' | 'warning'; message: string }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-lg px-3 py-2 text-[11px] font-semibold text-ink [.settings-rows_&]:my-2',
        tone === 'error' ? 'bg-negative-soft' : 'bg-caution-soft',
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
    <div className={cn('flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2', IN_GROUP_ROW)}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Label htmlFor={htmlFor} className="text-[11px] font-semibold leading-tight">
          {label}
        </Label>
        {hint && <p className="text-[10px] font-medium text-n-6">{hint}</p>}
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
    <div className={cn('flex items-center justify-between gap-3.5', IN_GROUP_ROW)}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={id} className="text-[11px] font-semibold leading-tight text-ink">
          {label}
        </label>
        {hint && <p className="text-[10px] font-medium text-n-6">{hint}</p>}
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
  placeholder,
}: {
  id?: string
  ariaLabel?: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onValueChange: (value: string) => void
  width?: string
  disabled?: boolean
  /** Trigger text while nothing is selected (pass value="" for that state). */
  placeholder?: string
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={width}>
        <SelectValue placeholder={placeholder} />
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

/** A sub-section title inside a settings group (the next row's hairline
 *  sits under it). */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-2 pt-5 text-[13px] font-bold tracking-[-0.01em] text-ink">{children}</div>
  )
}

/** {value,label} option list from numbers, with an optional unit suffix. */
export const numOptions = (values: readonly number[], suffix = '') =>
  values.map((v) => ({ value: String(v), label: `${v}${suffix}` }))

/** Parse a number input, clamp to [min,max], falling back to `fallback` for
 *  empty/NaN so the control never emits an out-of-range or NaN value.
 *
 *  The body moved to `@/utils/clamp-int` (R435) so pure `.ts` ops modules can
 *  share it instead of forking a second copy; re-exported here unchanged, so
 *  every existing import of it reads exactly as before. */
export { clampInt } from '@/utils/clamp-int'
