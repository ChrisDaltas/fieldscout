'use client'

import { cn } from '@/lib/utils'

import { MIcon } from './m-icon'

/**
 * FieldScout Mobile form parts — the handoff's create-flow language, shared
 * by the phone's wizards and form sheets:
 *  - the New ranking wizard (lr-myrank §2.2): 13/600 t3 group labels, 34px
 *    choice chips, 20px-dot radio cards, the 3px progress track and the
 *    48px footer button;
 *  - lr-frame §2.13.10–11: the switch, chips and radio card;
 *  - the My team page (edit-team handoff): the 48px b2 text field.
 * Where the handoff draws no control (a select, a stepper, a tick row), the
 * same tokens extend it. Every colour is an `m-*` token, so the parts follow
 * the phone's light and dark themes.
 */

// ---------------------------------------------------------------------------
// Labels, chips, radio cards
// ---------------------------------------------------------------------------

/** A labelled block (lr-myrank §2.2): 13/600 t3 label over its control. */
export function MField({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: React.ReactNode
}) {
  const cls = 'text-[13px] font-semibold text-m-t3'
  return (
    <div className="flex flex-col gap-2">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={cls}>
          {label}
        </label>
      ) : (
        <span className={cls}>{label}</span>
      )}
      {hint ? <span className="-mt-1 text-[12px] font-medium leading-[1.35] text-m-t3">{hint}</span> : null}
      {children}
    </div>
  )
}

/** Wizard choice chip (lr-frame §2.13.11 d): 34px, white on ink when chosen. */
export function MChoiceChip({
  label,
  note,
  on,
  onPick,
}: {
  label: string
  note?: string
  on: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={cn(
        'flex h-[34px] items-center gap-[5px] rounded-pill px-3.5 text-[13px] font-semibold',
        on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
      )}
    >
      {label}
      {/* Marks this week among the open ones (My rankings' count style). */}
      {note ? <span className="text-[11px] font-semibold opacity-60">· {note}</span> : null}
    </button>
  )
}

/** Radio card (lr-frame §2.13.11 o): b1, blue 2px ring when chosen. */
export function MRadioCard({
  label,
  sub,
  on,
  onPick,
  top,
}: {
  label: string
  sub: string
  on: boolean
  onPick: () => void
  top?: string | null
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn('flex flex-col gap-2 rounded-[14px] bg-m-b1 px-3.5 py-3 text-left', on && 'shadow-m-select')}
    >
      <span className="flex w-full items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="whitespace-nowrap text-[15px] font-semibold text-m-t1">{label}</span>
          <span className="text-[12px] font-medium text-m-t3">{sub}</span>
        </span>
        <MRadioDot on={on} />
      </span>
      {top ? <span className="w-full truncate whitespace-nowrap text-[11px] font-medium text-m-t3">{top}</span> : null}
    </button>
  )
}

/** 20px radio: a 6px blue annulus around the card colour when on, a 1.5px b4 ring when off. */
export function MRadioDot({ on }: { on: boolean }) {
  return on ? (
    <span aria-hidden className="flex size-5 flex-none items-center justify-center rounded-full bg-accent">
      <span className="size-2 rounded-full bg-m-b1" />
    </span>
  ) : (
    <span aria-hidden className="size-5 flex-none rounded-full border-[1.5px] border-m-b4m" />
  )
}

/**
 * A multi-select chip (h30, lr-frame §2.13.11 f's shape): white on ink when
 * on. `onCard` draws the off state on the page colour, so the chip still
 * reads inside a b1 card (b2 on b1 all but vanishes in light mode).
 */
export function MToggleChip({
  pressed,
  onPressedChange,
  disabled,
  title,
  onCard = false,
  children,
}: {
  pressed: boolean
  onPressedChange: (next: boolean) => void
  disabled?: boolean
  title?: string
  onCard?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'flex h-[30px] items-center rounded-pill px-3 text-[13px] font-semibold disabled:opacity-60',
        pressed ? 'bg-m-ink text-white' : onCard ? 'bg-m-b0 text-m-t1 active:bg-m-b2' : 'bg-m-b2 text-m-t1 active:bg-m-b2h',
      )}
    >
      {children}
    </button>
  )
}

/** Tool chip (lr-frame §2.13.11 j): h30 b2 pill, 12/600, optional plus. */
export function MToolChip({
  children,
  onClick,
  disabled,
  plus = false,
  ariaExpanded,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  plus?: boolean
  ariaExpanded?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={ariaExpanded}
      className="flex h-[30px] flex-none items-center gap-[5px] rounded-pill bg-m-b2 px-3 text-[12px] font-semibold text-m-t1 active:bg-m-b2h disabled:opacity-50"
    >
      {plus ? <MIcon name="plus" size={12} stroke={1.9} /> : null}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Switch and tick
// ---------------------------------------------------------------------------

/** The phone switch track (lr-frame §2.13.10): 38×22, 18px knob. */
export function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-[22px] w-[38px] flex-none rounded-pill p-0.5 transition-colors duration-200 ease-linear',
        on ? 'justify-end bg-confirm' : 'justify-start bg-m-b3s',
      )}
    >
      <span className="size-[18px] rounded-full bg-m-b0 shadow-m-knob" />
    </span>
  )
}

/** A 22px round tick: blue with a check when on, a b4 ring when off. */
export function MCheck({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('flex size-[22px] flex-none items-center justify-center rounded-full', on ? 'bg-accent' : 'bg-m-b0 ring-[1.5px] ring-inset ring-m-b4m')}
    >
      {on && <MIcon name="check" size={11} stroke={3} className="text-white" />}
    </span>
  )
}

/** A checkbox row: label and note on the left, the tick on the right. */
export function MCheckRow({
  on,
  onChange,
  label,
  note,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
  note: string
}) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={() => onChange(!on)} className="flex items-start gap-3 py-1 text-left">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px] font-semibold text-m-t1">{label}</span>
        <span className="text-[12px] font-medium leading-[1.35] text-m-t3">{note}</span>
      </span>
      <MCheck on={on} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * The phone text field (the My team page's: 48px, b2, 16/600). 16px keeps
 * iOS from zooming the page when the field takes focus.
 */
export const M_TEXT_FIELD =
  'h-12 w-full rounded-[12px] border-0 bg-m-b2 px-3.5 font-sans text-[16px] font-semibold text-m-t1 outline-none placeholder:font-medium placeholder:text-m-t3 disabled:opacity-60'

/** The same field inside a b1 card: on the page colour, so its edge shows. */
export const M_TEXT_FIELD_ON_CARD =
  'h-12 w-full rounded-[12px] border-0 bg-m-b0 px-3.5 font-sans text-[16px] font-semibold text-m-t1 outline-none placeholder:font-medium placeholder:text-m-t3 disabled:opacity-60'

/** A short number field in a settings row (same fill and type, 36px tall). */
export const M_NUMBER_FIELD =
  'h-9 w-[84px] rounded-[10px] border-0 bg-m-b2 px-3 text-right font-sans text-[16px] font-semibold tabular-nums text-m-t1 outline-none placeholder:text-m-t3 disabled:opacity-60'

/**
 * A choice from a list, as the phone's own picker: a native `<select>` drawn
 * as a b2 field with the value and a chevron. The system wheel / list opens
 * on tap, so no popover is drawn over the sheet. 16px for the same iOS-zoom
 * reason as the text field. `onCard` puts the field on the page colour
 * inside a b1 card (the chip's reason). `full` draws it as a form's own
 * field — the full width at the text field's 48px — instead of a settings
 * row's compact picker.
 */
export function MSelect({
  id,
  ariaLabel,
  value,
  options,
  onValueChange,
  disabled,
  placeholder,
  onCard = false,
  full = false,
}: {
  id?: string
  ariaLabel?: string
  value: string
  /** `disabled` greys one choice out (prevent, don't refuse — a choice
   *  the verb would refuse is shown but can't be picked). */
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
  onValueChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  onCard?: boolean
  full?: boolean
}) {
  return (
    <span className={cn('relative flex min-w-0 max-w-full', full && 'w-full')}>
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          'min-w-0 max-w-full appearance-none truncate border-0 pr-8 font-sans text-[16px] font-semibold text-m-t1 outline-none disabled:opacity-50',
          full ? 'h-12 w-full rounded-[12px] pl-3.5' : 'h-9 rounded-[10px] pl-3',
          onCard ? 'bg-m-b0' : 'bg-m-b2',
        )}
        data-m-select
      >
        {value === '' && placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <MIcon
        name="chevronDown"
        size={12}
        stroke={2.2}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-m-t3"
      />
    </span>
  )
}

/**
 * − value + (extends the design: round 28px buttons on the page colour, so
 * the stepper reads on a b1 card). `tile` spreads the buttons across a slot
 * tile with a bigger count; `pill` packs them on a page-colour track;
 * `field` packs them on a b2 track, for a row on the page itself (where the
 * page-colour track would vanish — the number field's fill).
 *
 * `step` (default 1) and `format` (default the plain number) let it carry a
 * decimal value — a scoring setting's "+0.04"; `min` / `max` default to no
 * bound, and `disabled` turns both buttons off.
 */
export function MStepper({
  value,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  format = String,
  onStep,
  ariaLabel,
  appearance = 'pill',
  disabled = false,
  valueClassName,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  format?: (value: number) => string
  onStep: (next: number) => void
  ariaLabel: string
  appearance?: 'pill' | 'tile' | 'field'
  disabled?: boolean
  /** The count's colour / width, when the caller's value needs one. */
  valueClassName?: string
}) {
  const tile = appearance === 'tile'
  const field = appearance === 'field'
  const button = cn(
    'flex size-7 flex-none items-center justify-center rounded-full text-m-t1 disabled:opacity-35',
    tile ? 'bg-m-b0 active:bg-m-b2' : field ? 'active:bg-m-b2h' : 'active:bg-m-b2',
  )
  return (
    <span
      className={cn(
        'flex items-center',
        tile ? 'justify-between gap-1' : cn('gap-0.5 rounded-pill p-[3px]', field ? 'bg-m-b2' : 'bg-m-b0'),
      )}
    >
      <button
        type="button"
        className={button}
        aria-label={`Fewer: ${ariaLabel}`}
        disabled={disabled || value <= min}
        onClick={() => onStep(value - step)}
      >
        <MIcon name="drop" size={12} stroke={2.2} />
      </button>
      <span
        className={cn(
          'text-center font-semibold tabular-nums',
          tile ? 'min-w-5 text-[16px]' : 'min-w-[30px] text-[14px]',
          valueClassName ?? 'text-m-t1',
        )}
      >
        {format(value)}
      </span>
      <button
        type="button"
        className={button}
        aria-label={`More: ${ariaLabel}`}
        disabled={disabled || value >= max}
        onClick={() => onStep(value + step)}
      >
        <MIcon name="plus" size={12} stroke={2.2} />
      </button>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * A system message on the phone: a rounded rectangle on a soft tint, never a
 * pill and never a bright-red fill (CLAUDE.md, 2026-10-18). `error` is the
 * phone's error pair (m-gr / m-tr), `warning` the orange tint. `action` puts
 * one word-button at its end (a failed read's "Try again").
 */
export function MNotice({
  tone,
  children,
  action,
}: {
  tone: 'error' | 'warning'
  children: React.ReactNode
  action?: { label: string; onClick: () => void }
}) {
  const role = tone === 'error' ? 'alert' : 'status'
  const tint = tone === 'error' ? 'bg-m-gr text-m-tr' : 'bg-m-go text-m-to'
  if (!action) {
    return <p role={role} className={cn('rounded-message px-3 py-2.5 text-[13px] font-medium leading-[1.4]', tint)}>{children}</p>
  }
  return (
    <div role={role} className={cn('flex items-center gap-2 rounded-message py-1.5 pl-3 pr-1.5', tint)}>
      <span className="min-w-0 flex-1 text-[13px] font-medium leading-[1.4] [text-wrap:pretty]">{children}</span>
      <button
        type="button"
        onClick={action.onClick}
        className="flex h-[30px] flex-none items-center whitespace-nowrap rounded-message px-2.5 text-[13px] font-semibold underline underline-offset-2 active:opacity-70"
      >
        {action.label}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wizard chrome
// ---------------------------------------------------------------------------

/** Fill width for "step N of M" — whole Tailwind fractions, no inline style. */
const PROGRESS_FILL: Record<string, string> = {
  '1/2': 'w-1/2',
  '1/3': 'w-1/3',
  '2/3': 'w-2/3',
  '1/4': 'w-1/4',
  '2/4': 'w-2/4',
  '3/4': 'w-3/4',
}

/** The wizard's progress track (lr-myrank §2.2): 3px b2, a blue fill per step. */
export function MStepProgress({ step, total }: { step: number; total: number }) {
  const done = step + 1
  const fill = done >= total ? 'w-full' : (PROGRESS_FILL[`${done}/${total}`] ?? 'w-full')
  return (
    <div
      className="h-[3px] flex-none bg-m-b2"
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      <div className={cn('h-[3px] bg-accent transition-[width] duration-200 ease-linear', fill)} />
    </div>
  )
}

const FOOTER_BUTTON = 'flex h-12 items-center justify-center rounded-[14px] text-[15px] font-semibold'

/**
 * The wizard footer (lr-myrank §2.2: a 48px, radius-14, 15/600 button over a
 * b2 rule), with an optional Back beside it (lr-frame §2.13.11 v's quiet
 * button). A disabled primary turns quiet grey — it never fires.
 */
export function MWizardFooter({
  onBack,
  backLabel = 'Back',
  label,
  onClick,
  disabled = false,
  type = 'button',
  form,
  children,
}: {
  onBack?: () => void
  backLabel?: string
  label: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  form?: string
  /** Shown above the buttons (why the action is disabled, a refusal). */
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-m-b2 px-5 pt-2.5">
      {children}
      <div className="flex gap-2">
        {onBack ? (
          <button type="button" onClick={onBack} className={cn(FOOTER_BUTTON, 'flex-1 bg-m-b2 text-m-t1 active:bg-m-b2h')}>
            {backLabel}
          </button>
        ) : null}
        <button
          type={type}
          form={form}
          onClick={onClick}
          disabled={disabled}
          className={cn(
            FOOTER_BUTTON,
            onBack ? 'flex-[2]' : 'w-full',
            disabled ? 'bg-m-b3s text-m-t3' : 'bg-accent text-white active:bg-accent-strong',
          )}
          data-wizard-primary
        >
          {label}
        </button>
      </div>
    </div>
  )
}
