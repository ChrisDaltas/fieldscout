'use client'

import { useMemo, useState } from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Badge, FilterChip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  deriveRosterSize,
  IR_DESIGNATIONS,
  LEAGUE_SETTINGS_DEFAULTS,
  ROSTER_POSITIONS,
  validateLeagueSettings,
  type FieldIssue,
  type LeagueSettings,
  type RosterPosition,
  type RosterSettings,
  type StartingSlot,
} from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'

import {
  addCustomFlex,
  addDlSpot,
  addIrSpot,
  addSingleSlot,
  isFlexSlot,
  removeIrSpot,
  removeSlot,
  setBench,
  setHotSwap,
  setSlotCount,
  SINGLE_POSITION_PRESETS,
  suggestFlexLabel,
  updateIrSpot,
} from './roster-slot-builder-ops'

/**
 * Roster-slot-builder (M1 task L.A2.2; spec §7.3.2, §16.2, §16.4).
 *
 * Controlled, presentational component over the canonical §7.3.2
 * `roster_settings` JSONB: `value` in, ops out through `onChange`. Consumed
 * by BOTH the create-wizard roster step (L.A2.1) and the settings panel
 * (L.A2.4) — never fork it (CLAUDE.md). No data fetching and no league
 * wiring here; loading/error/empty data states (§16.5.4) belong to those
 * consumers — this component's designed "empty" is an all-zero lineup, which
 * renders the contract's §7.3.8 slot-sum violation inline.
 *
 * - Per-position starter counts 0–10; bench 0–20; IR spots 0–6.
 * - "Add Custom Flex": position multi-select (≥ 2 — the Add button stays
 *   disabled with a hint below the floor, since a 1-position "flex" is not
 *   representable as a flex), commissioner-named label, unique key
 *   generation (ops layer, D65).
 * - IR spots each configured Unrestricted/Restricted + eligible
 *   designations + min stint; one-tap **DL** preset (OUT/IR/Doubtful,
 *   4 weeks — §16.4's product promise, applied from the contract's
 *   `DL_PRESET`).
 * - **Hot Swap** toggle (`swap_spots` 0/1) — all UI copy says Hot Swap
 *   (§16.4); rendered below the flex/superflex group and above K, D/ST and
 *   IR (§7.3.2 display order).
 * - Live derived `roster_size` + §7.3.8 violations rendered inline with the
 *   contract's own per-field messages (`validateLeagueSettings` — never
 *   reimplemented here). States that the canonical schema cannot even
 *   represent (empty eligible set, zero designations) are prevented at the
 *   control instead: the last designation chip can't be untoggled.
 */
export interface RosterSlotBuilderProps {
  /** The canonical §7.3.2 roster_settings JSONB. */
  value: RosterSettings
  /** Receives a fresh schema-parsed RosterSettings after every edit. */
  onChange: (next: RosterSettings) => void
  /**
   * League size, when the consumer knows it (the wizard does) — feeds the
   * §7.3.8 draftable-pool advisory. Defaults to the §7.3.1 default (12).
   */
  teamCount?: LeagueSettings['team_count']
  /** Draftable player-pool size for the §7.3.2 pool advisory (warns only). */
  draftablePoolSize?: number
  className?: string
}

const OFFENSE_SINGLES: readonly RosterPosition[] = ['QB', 'RB', 'WR', 'TE']
const TAIL_SINGLES: readonly RosterPosition[] = ['K', 'DST']
const IDP_SINGLES: readonly RosterPosition[] = ['DL', 'LB', 'DB']

export function RosterSlotBuilder({
  value,
  onChange,
  teamCount,
  draftablePoolSize,
  className,
}: RosterSlotBuilderProps) {
  const { errors, warnings } = useMemo(() => {
    const settings: LeagueSettings = {
      ...structuredClone(LEAGUE_SETTINGS_DEFAULTS),
      ...(teamCount !== undefined ? { team_count: teamCount } : {}),
      roster_settings: value,
    }
    const result = validateLeagueSettings(settings, { draftablePoolSize })
    const roster = (issue: FieldIssue) => issue.field.startsWith('roster_settings')
    return { errors: result.errors.filter(roster), warnings: result.warnings.filter(roster) }
  }, [value, teamCount, draftablePoolSize])

  const starterCount = value.starting_slots.reduce((sum, s) => sum + s.count, 0)
  const rosterSize = deriveRosterSize(value)
  const flexSlots = value.starting_slots.filter(isFlexSlot)

  const errorsFor = (field: string) => errors.filter((e) => e.field === field)

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Live derived roster size (§7.3.2: shown live in the wizard) */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="black">
          <span className="fs-num">{rosterSize}</span>&nbsp;roster spots
        </Badge>
        <span className="fs-num text-[12px] font-semibold text-n-3">
          {starterCount} starters · {value.bench} bench · {value.ir_slots.length} IR
        </span>
      </div>
      {warnings.map((w) => (
        <InlineIssue key={w.field + w.message} tone="warning" message={w.message} />
      ))}

      {/* ---- Starting lineup (display order per §7.3.2) ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Starting lineup</CardTitle>
          <Badge variant="black">
            <span className="fs-num">{starterCount}</span>&nbsp;starters
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          <SingleRows positions={OFFENSE_SINGLES} value={value} onChange={onChange} />

          <SectionLabel>Flex</SectionLabel>
          {flexSlots.length === 0 && (
            <p className="text-[12px] font-semibold text-n-3">
              No flex slots — add one below.
            </p>
          )}
          {flexSlots.map((slot) => (
            <FlexRow key={slot.key} slot={slot} value={value} onChange={onChange} />
          ))}
          <AddCustomFlex value={value} onChange={onChange} />

          {/* Hot Swap sits below the flex/superflex group, above K/D-ST/IR (§7.3.2) */}
          <HotSwapRow value={value} onChange={onChange} />

          <SingleRows positions={TAIL_SINGLES} value={value} onChange={onChange} />

          <SectionLabel>IDP</SectionLabel>
          <SingleRows positions={IDP_SINGLES} value={value} onChange={onChange} />

          {errorsFor('roster_settings.starting_slots').map((e) => (
            <InlineIssue key={e.message} tone="error" message={e.message} />
          ))}
        </CardContent>
      </Card>

      {/* ---- Bench + IR (IR renders after K/D-ST per the display order) ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Bench &amp; injured reserve</CardTitle>
          <Badge variant="stroke">
            <span className="fs-num">{value.bench + value.ir_slots.length}</span>&nbsp;reserve
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <span className="flex-1 text-[13px] font-bold">Bench (BN)</span>
            <Stepper
              value={value.bench}
              min={0}
              max={20}
              ariaLabel="Bench spots"
              onStep={(n) => onChange(setBench(value, n))}
            />
          </div>
          {errorsFor('roster_settings.bench').map((e) => (
            <InlineIssue key={e.message} tone="error" message={e.message} />
          ))}

          <SectionLabel>Injured reserve · {value.ir_slots.length}/6 spots</SectionLabel>
          {value.ir_slots.length === 0 && (
            <p className="text-[12px] font-semibold text-n-3">
              No IR spots — injured players would hold a bench spot all season.
            </p>
          )}
          {value.ir_slots.map((_, i) => (
            <IrSpotRow key={value.ir_slots[i].key} index={i} value={value} onChange={onChange} />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="stroke"
              size="sm"
              disabled={value.ir_slots.length >= 6}
              onClick={() => onChange(addIrSpot(value))}
            >
              <Icon name="plus" /> Add IR spot
            </Button>
            <Button
              type="button"
              variant="lime"
              size="sm"
              disabled={value.ir_slots.length >= 6}
              onClick={() => onChange(addDlSpot(value))}
            >
              <Icon name="plus" /> Add DL spot
            </Button>
            <span className="text-[11px] font-semibold text-n-3">
              DL: whoever goes on it stays 4 weeks — OUT · IR · Doubtful
            </span>
          </div>
          {errorsFor('roster_settings.ir_slots').map((e) => (
            <InlineIssue key={e.message} tone="error" message={e.message} />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces (internal — not exported, no parallel component tree)
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="fs-overline border-t border-n-4 pt-2.5 text-[11px] text-n-3">{children}</div>
  )
}

function InlineIssue({ tone, message }: { tone: 'error' | 'warning'; message: string }) {
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

function Stepper({
  value,
  min,
  max,
  onStep,
  ariaLabel,
}: {
  value: number
  min: number
  max: number
  onStep: (next: number) => void
  ariaLabel: string
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="stroke"
        size="icon-sm"
        aria-label={`Fewer: ${ariaLabel}`}
        disabled={value <= min}
        onClick={() => onStep(value - 1)}
      >
        <span aria-hidden className="text-[15px] font-extrabold leading-none">–</span>
      </Button>
      <span className="fs-num min-w-7 text-center text-[14px] font-extrabold">{value}</span>
      <Button
        type="button"
        variant="stroke"
        size="icon-sm"
        aria-label={`More: ${ariaLabel}`}
        disabled={value >= max}
        onClick={() => onStep(value + 1)}
      >
        <span aria-hidden className="text-[15px] font-extrabold leading-none">+</span>
      </Button>
    </div>
  )
}

/**
 * One row per single-position slot in `value` for the given positions, plus
 * a ghost row (count 0, not yet in the JSONB) for absent presets — stepping
 * a ghost up inserts the preset slot at its canonical position, so the
 * emitted JSONB never carries rows the commissioner didn't touch.
 */
function SingleRows({
  positions,
  value,
  onChange,
}: {
  positions: readonly RosterPosition[]
  value: RosterSettings
  onChange: (next: RosterSettings) => void
}) {
  return (
    <>
      {positions.map((position) => {
        const slots = value.starting_slots.filter(
          (s) => !isFlexSlot(s) && s.eligible[0] === position,
        )
        if (slots.length === 0) {
          const preset = SINGLE_POSITION_PRESETS[position]
          return (
            <SlotRow key={`ghost-${position}`} ghost position={position} label={preset.label}>
              <Stepper
                value={0}
                min={0}
                max={10}
                ariaLabel={`${preset.label} starters`}
                onStep={(n) => onChange(addSingleSlot(value, position, n))}
              />
            </SlotRow>
          )
        }
        return slots.map((slot) => (
          <SlotRow key={slot.key} ghost={slot.count === 0} position={position} label={slot.label}>
            <Stepper
              value={slot.count}
              min={0}
              max={10}
              ariaLabel={`${slot.label} starters`}
              onStep={(n) => onChange(setSlotCount(value, slot.key, n))}
            />
          </SlotRow>
        ))
      })}
    </>
  )
}

function SlotRow({
  position,
  label,
  ghost,
  children,
}: {
  position: RosterPosition
  label: string
  ghost?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex items-center gap-3', ghost && 'opacity-60')}>
      <PositionBadge position={position} className="min-w-[34px]" />
      <span className="flex-1 text-[13px] font-bold">{label}</span>
      {children}
    </div>
  )
}

function FlexRow({
  slot,
  value,
  onChange,
}: {
  slot: StartingSlot
  value: RosterSettings
  onChange: (next: RosterSettings) => void
}) {
  return (
    <div className={cn('flex items-center gap-3', slot.count === 0 && 'opacity-60')}>
      <PositionBadge position="FLEX" className="min-w-[34px]" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <span className="truncate text-[13px] font-bold">{slot.label}</span>
        <span className="text-[11px] font-semibold text-n-3">
          {slot.eligible.join(' · ')}
        </span>
      </div>
      <Stepper
        value={slot.count}
        min={0}
        max={10}
        ariaLabel={`${slot.label} slots`}
        onStep={(n) => onChange(setSlotCount(value, slot.key, n))}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${slot.label} flex slot`}
        onClick={() => onChange(removeSlot(value, slot.key))}
      >
        <Icon name="close" />
      </Button>
    </div>
  )
}

function AddCustomFlex({
  value,
  onChange,
}: {
  value: RosterSettings
  onChange: (next: RosterSettings) => void
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<RosterPosition[]>([])
  const [label, setLabel] = useState('')
  const suggestion = selected.length >= 2 ? suggestFlexLabel(selected) : ''
  const tooFew = selected.length < 2

  const reset = () => {
    setOpen(false)
    setSelected([])
    setLabel('')
  }

  if (!open) {
    return (
      <div>
        <Button type="button" variant="stroke" size="sm" onClick={() => setOpen(true)}>
          <Icon name="plus" /> Add Custom Flex
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-sm border border-ink bg-page p-3">
      <div className="text-[13px] font-bold">New flex slot</div>
      <div className="flex flex-wrap gap-1.5">
        {ROSTER_POSITIONS.map((p) => (
          <FilterChip
            key={p}
            pressed={selected.includes(p)}
            onPressedChange={(on) =>
              setSelected((cur) => (on ? [...cur, p] : cur.filter((x) => x !== p)))
            }
          >
            {p}
          </FilterChip>
        ))}
      </div>
      {tooFew && (
        <p className="text-[12px] font-semibold text-negative-strong">
          Pick at least 2 positions — a flex slot accepts multiple positions (§7.3.2). One
          position is just that position&apos;s own slot.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={suggestion || 'Label (e.g. W/R/T)'}
          aria-label="Flex slot label"
          className="h-btn-md w-44 text-[12px]"
          maxLength={60}
        />
        <Button
          type="button"
          variant="blue"
          size="sm"
          disabled={tooFew}
          onClick={() => {
            onChange(addCustomFlex(value, { eligible: selected, label }))
            reset()
          }}
        >
          Add flex
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function HotSwapRow({
  value,
  onChange,
}: {
  value: RosterSettings
  onChange: (next: RosterSettings) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-ink px-3 py-2.5">
      <div>
        <div className="flex items-center gap-2">
          <label htmlFor="hot-swap-toggle" className="text-[13px] font-extrabold">
            Hot Swap
          </label>
          {value.swap_spots === 1 && <Badge variant="lime">on</Badge>}
        </div>
        <p className="text-[11px] font-semibold text-n-3">
          One armed bench player auto-starts if the starter they protect is ruled out — before
          or during the game. One Hot Swap per team.
        </p>
      </div>
      <Switch
        id="hot-swap-toggle"
        checked={value.swap_spots === 1}
        onCheckedChange={(on) => onChange(setHotSwap(value, on))}
      />
    </div>
  )
}

function IrSpotRow({
  index,
  value,
  onChange,
}: {
  index: number
  value: RosterSettings
  onChange: (next: RosterSettings) => void
}) {
  const spot = value.ir_slots[index]
  const restricted = spot.type === 'restricted'
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-n-4 p-3">
      <div className="flex items-center gap-2">
        <Badge variant={restricted ? 'stroke-pink' : 'stroke'}>
          {spot.label ?? `IR ${index + 1}`}
        </Badge>
        <span className="flex-1 text-[11px] font-semibold text-n-3">
          {restricted
            ? `Restricted — eligible players stay at least ${spot.min_weeks} week${spot.min_weeks === 1 ? '' : 's'}`
            : 'Unrestricted — eligible players move in and out freely before lock'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove IR spot ${spot.label ?? index + 1}`}
          onClick={() => onChange(removeIrSpot(value, spot.key))}
        >
          <Icon name="close" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={spot.type}
          onValueChange={(type) =>
            onChange(updateIrSpot(value, spot.key, { type: type as 'unrestricted' | 'restricted' }))
          }
        >
          <SelectTrigger className="h-btn-md w-40 text-[12px] font-bold" aria-label="IR spot type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unrestricted">Unrestricted</SelectItem>
            <SelectItem value="restricted">Restricted</SelectItem>
          </SelectContent>
        </Select>
        {restricted && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-n-3">Min weeks</span>
            <Stepper
              value={spot.min_weeks}
              min={1}
              max={17}
              ariaLabel={`Minimum stint for ${spot.label ?? `IR ${index + 1}`}`}
              onStep={(n) => onChange(updateIrSpot(value, spot.key, { min_weeks: n }))}
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold text-n-3">Eligible designations</span>
        {IR_DESIGNATIONS.map((d) => {
          const on = spot.eligible_designations.includes(d)
          const lastOne = on && spot.eligible_designations.length === 1
          return (
            <FilterChip
              key={d}
              pressed={on}
              disabled={lastOne}
              title={lastOne ? 'An IR spot needs at least one eligible designation (§7.3.2).' : undefined}
              onPressedChange={(next) =>
                onChange(
                  updateIrSpot(value, spot.key, {
                    eligible_designations: next
                      ? [...spot.eligible_designations, d]
                      : spot.eligible_designations.filter((x) => x !== d),
                  }),
                )
              }
            >
              {d}
            </FilterChip>
          )
        })}
      </div>
    </div>
  )
}
