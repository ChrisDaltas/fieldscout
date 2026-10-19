'use client'

import { createContext, useContext } from 'react'

import { M_NUMBER_FIELD, MNotice, MSelect, SwitchTrack } from '@/components/mobile/ui/m-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { LayoutMode } from '@/hooks/use-layout-mode'
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

/**
 * Which design language these controls draw in. Desktop everywhere by
 * default; the phone's create-league and practice-draft sheets (gap list §4
 * item 2) wrap their bodies in `<SettingsSkin layout="mobile">`, and every
 * control here — and the shared fields built on them (`draft-config-fields`,
 * `RosterSlotBuilder`, `ScoringTemplatePicker`, `AttachListInline`) — then
 * draws in the FieldScout Mobile language (`m-*` tokens, so the phone's dark
 * mode follows) with the SAME values, handlers and copy. One set of
 * controls, two skins — never a forked phone editor.
 */
const SettingsSkinContext = createContext<LayoutMode>('desktop')

export function SettingsSkin({ layout, children }: { layout: LayoutMode; children: React.ReactNode }) {
  return <SettingsSkinContext.Provider value={layout}>{children}</SettingsSkinContext.Provider>
}

/** The layout the surrounding surface draws in (`desktop` unless a phone
 *  sheet set `mobile`). */
export function useSettingsSkin(): LayoutMode {
  return useContext(SettingsSkinContext)
}

/** A phone settings row: 14/600 label over a 12/500 t3 hint, the control at
 *  the end, rows split by a b2 hairline (the handoff's League settings
 *  rows). A control too wide for the line wraps under its label. */
const M_ROW = 'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-m-b2 py-2.5 last:border-b-0'
const M_ROW_LABEL = 'text-[14px] font-semibold text-m-t1'
const M_ROW_HINT = 'text-[12px] font-medium leading-[1.35] text-m-t3'

/** A validation/advisory message box (error = alert, warning = status). */
export function InlineIssue({ tone, message }: { tone: 'error' | 'warning'; message: string }) {
  const skin = useSettingsSkin()
  if (skin === 'mobile') return <MNotice tone={tone}>{message}</MNotice>
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
  const skin = useSettingsSkin()
  if (skin === 'mobile') {
    // The label keeps at least 40% of the row, so a control wider than the
    // rest (the draft's month / day / time, a long choice) wraps under it
    // instead of squeezing the label into a column of single words.
    return (
      <div className={M_ROW}>
        <div className="flex min-w-[40%] flex-1 flex-col gap-0.5">
          <label htmlFor={htmlFor} className={M_ROW_LABEL}>
            {label}
          </label>
          {hint && <p className={M_ROW_HINT}>{hint}</p>}
        </div>
        <div className="flex min-w-0 max-w-full shrink-0">{children}</div>
      </div>
    )
  }
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
  const skin = useSettingsSkin()
  if (skin === 'mobile') {
    // The phone switch (lr-frame §2.13.10) on a real `role="switch"` button
    // the label points at, so tapping the words flips it too.
    return (
      <div className={cn(M_ROW, 'flex-nowrap')}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <label htmlFor={id} className={M_ROW_LABEL}>
            {label}
          </label>
          {hint && <p className={M_ROW_HINT}>{hint}</p>}
        </div>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onCheckedChange(!checked)}
          className="flex-none disabled:opacity-40"
        >
          <SwitchTrack on={checked} />
        </button>
      </div>
    )
  }
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
  onCard,
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
  /** Phone skin only: the field sits inside a b1 card (`MSelect`'s `onCard`). */
  onCard?: boolean
}) {
  const skin = useSettingsSkin()
  if (skin === 'mobile') {
    return (
      <MSelect
        id={id}
        ariaLabel={ariaLabel}
        value={value}
        options={options}
        onValueChange={onValueChange}
        disabled={disabled}
        placeholder={placeholder}
        onCard={onCard}
      />
    )
  }
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
 *  sits under it). On the phone it is the handoff's G-page section title
 *  (13/600 t3), so a group's sub-sections read like the pages' own. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  const skin = useSettingsSkin()
  if (skin === 'mobile') return <div className="pb-1 pt-4 text-[13px] font-semibold text-m-t3">{children}</div>
  return (
    <div className="pb-2 pt-5 text-[13px] font-bold tracking-[-0.01em] text-ink">{children}</div>
  )
}

/**
 * A settings number field: the v7 input on desktop (`className` sizes it,
 * `w-24` by default); on the phone a plain field in the phone's fill and
 * type with the number keypad (`M_NUMBER_FIELD`). One field for every
 * settings form (the draft knobs, waivers, trades), never a forked input.
 */
export function NumberField({ className = 'w-24', ...props }: React.ComponentProps<'input'>) {
  if (useSettingsSkin() === 'mobile') return <input {...props} inputMode={props.inputMode ?? 'numeric'} className={M_NUMBER_FIELD} />
  return <Input {...props} className={className} />
}

/**
 * A clock field (`type="time"`): the v7 input on desktop, the phone's
 * filled field on the phone (the system's own time wheel opens on tap).
 */
export function TimeField({ className = 'w-28', ...props }: React.ComponentProps<'input'>) {
  if (useSettingsSkin() === 'mobile') return <input {...props} type="time" className={cn(M_NUMBER_FIELD, 'w-[136px] text-left')} />
  return <Input {...props} type="time" className={className} />
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
