'use client'

import { Input } from '@/components/ui/input'
import type { FieldIssue, LeagueSettings } from '@/lib/leagues/settings/league-settings'

import {
  DRAFT_FIELD_BOUNDS,
  pickTimerOptions,
} from './draft-config-fields-ops'
import {
  ChoiceSelect,
  clampInt,
  FieldRow,
  InlineIssue,
  ToggleRow,
} from './settings-form-controls'

export { DRAFT_FIELD_BOUNDS, PICK_TIMER_LABELS, pickTimerOptions } from './draft-config-fields-ops'

/**
 * The §7.3.8 draft-configuration FIELDS — ONE implementation, mounted by the
 * league settings panel (L.A2.4) and by the practice-draft launch dialog
 * (MP.4).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS (review finding R505).
 * ---------------------------------------------------------------------------
 * MP.4's first cut re-typed these rows into the launch dialog: `comm -12`
 * against `settings-panel.tsx`'s `DraftGroup` found **66 identical lines of
 * ~110** after normalizing element ids — the same six controls in the same
 * order, four byte-identical hint strings, a FOURTH copy of the clamp bounds,
 * and a pick-clock label map that had already diverged at birth ("No clock"
 * vs "No clock (untimed)"). CLAUDE.md is explicit — no near-duplicate
 * components, and a small visual difference never justifies a fork — and the
 * LV.7 lesson is that the fork is cheap to make and expensive forever after.
 * So the rows moved here and BOTH surfaces compose them.
 *
 * Presentational and framework-only: `value` in, a §7.3.8 patch out through
 * `onChange`. No league wiring, no data fetching, no persistence — the
 * settings algebra lives in `league-settings` / `derived-settings` and the
 * two consumers own their own save/launch paths. What did NOT move is what is
 * league-shaped: the `GroupCard` shell, `DraftOrderEditor` and the draft-order
 * mode (they need a `leagueId` and a franchise list), and the draft-type
 * control itself, because the two surfaces present it differently and it is
 * one `ChoiceSelect`/three cards rather than a shared row.
 *
 * `idPrefix` exists so two mounts on one page can never collide on an
 * element id, and so each surface keeps the ids its own tests already use.
 */

export type DraftConfig = LeagueSettings['draft']
export type DraftConfigPatch = Partial<DraftConfig>

export interface DraftFieldsProps {
  value: DraftConfig
  onChange: (patch: DraftConfigPatch) => void
  /** Namespaces every element id (`${idPrefix}-pick-timer`, …). */
  idPrefix: string
}

/** §7.3.8 pick clock. Offers the WHOLE catalog. */
export function PickClockField({ value, onChange, idPrefix }: DraftFieldsProps) {
  return (
    <FieldRow label="Pick clock" htmlFor={`${idPrefix}-pick-timer`}>
      <ChoiceSelect
        id={`${idPrefix}-pick-timer`}
        ariaLabel="Pick clock"
        value={String(value.pick_timer_seconds)}
        width="w-48"
        options={pickTimerOptions()}
        onValueChange={(v) =>
          onChange({ pick_timer_seconds: Number(v) as DraftConfig['pick_timer_seconds'] })
        }
      />
    </FieldRow>
  )
}

/** §7.3.8 third-round reversal — snake only, both surfaces gate the mount. */
export function SnakeReversalField({ value, onChange, idPrefix }: DraftFieldsProps) {
  return (
    <ToggleRow
      id={`${idPrefix}-snake-reversal`}
      label="Third-round reversal"
      hint="Sleeper-style — the 3rd round doesn't flip."
      checked={value.snake_reversal}
      onCheckedChange={(snake_reversal) => onChange({ snake_reversal })}
    />
  )
}

export interface AuctionConfigFieldsProps extends DraftFieldsProps {
  /**
   * Offer `manual` in the nomination-order select.
   *
   * 098/AP.5 (F80): `manual` is a real choice again — the §7.3.8 catalog now
   * has a `nomination_order` array, the settings panel mounts
   * `DraftOrderEditor` on it (the SAME editor snake uses — never a fork), and
   * `draft_start` hydrates and validates the permutation. The settings panel
   * passes `true`.
   *
   * A standalone practice draft has no league and no commissioner, and
   * migration 095 refuses anything but `same_as_draft_order`/`random` by
   * name — so the launch dialog passes nothing and the arm cannot appear
   * (D110(1): the UI must not offer what the engine forbids).
   */
  offerManual?: boolean
  /** Field-level §7.3.8 violations to render under the group — the
   *  contract's own messages (`validateLeagueSettings`), never re-worded. */
  issues?: FieldIssue[]
}

/** The six §7.3.8 auction knobs. Mounted only when `draft_type === 'auction'`. */
export function AuctionConfigFields({
  value,
  onChange,
  idPrefix,
  offerManual = false,
  issues = [],
}: AuctionConfigFieldsProps) {
  const b = DRAFT_FIELD_BOUNDS
  return (
    <>
      <FieldRow
        label="Auction budget"
        htmlFor={`${idPrefix}-auction-budget`}
        hint="One-time draft budget."
      >
        <Input
          id={`${idPrefix}-auction-budget`}
          type="number"
          min={b.auction_budget.min}
          max={b.auction_budget.max}
          value={value.auction_budget}
          onChange={(e) =>
            onChange({
              auction_budget: clampInt(
                e.target.value,
                b.auction_budget.min,
                b.auction_budget.max,
                value.auction_budget,
              ),
            })
          }
          className="h-btn-md w-24 text-[12px]"
        />
      </FieldRow>

      {/* 092/AP.1 — the "Minimum bid" number input is GONE (§7.3.8 v2.13).
          It was a 0–5 field that set the nomination floor and the per-slot
          reserve and did NOT set the bid increment, which has always been a
          fixed $1; a commissioner who typed 5 got $1 raises. What replaces it
          is the toggle that names one real behaviour, and the copy says both
          halves of what it does so nobody is surprised by the reserve going
          away. */}
      <ToggleRow
        id={`${idPrefix}-auction-zero-dollar`}
        label="Allow $0 nominations"
        hint="A nomination can open at any amount the team can afford, and no budget is held back per empty roster spot. Raises are always $1 more, either way."
        checked={value.auction_zero_dollar_nominations}
        onCheckedChange={(auction_zero_dollar_nominations) =>
          onChange({ auction_zero_dollar_nominations })
        }
      />

      {/* M3 task L.C3.2 item 2 — the three §7.3.8 auction knobs that were
          persisted and validated (`draftConfigSchema`) but had no input: a
          setting nobody can reach is a setting the league does not have.
          Ranges are the catalog's (DRAFT_FIELD_BOUNDS, pinned against the
          schema), enforced again on save and again in-body by 095's
          `draft_settings_range_guard`; the room's own Clock & timers section
          edits the two clocks mid-draft (087's `draft_set_clock` auction
          arm). */}
      <FieldRow
        label="Nomination clock"
        htmlFor={`${idPrefix}-auction-nom`}
        hint="Seconds to nominate."
      >
        <Input
          id={`${idPrefix}-auction-nom`}
          type="number"
          min={b.auction_nomination_seconds.min}
          max={b.auction_nomination_seconds.max}
          value={value.auction_nomination_seconds}
          onChange={(e) =>
            onChange({
              auction_nomination_seconds: clampInt(
                e.target.value,
                b.auction_nomination_seconds.min,
                b.auction_nomination_seconds.max,
                value.auction_nomination_seconds,
              ),
            })
          }
          className="h-btn-md w-24 text-[12px]"
        />
      </FieldRow>

      <FieldRow
        label="Bid clock"
        htmlFor={`${idPrefix}-auction-bid`}
        hint="Seconds each bid resets the clock to."
      >
        <Input
          id={`${idPrefix}-auction-bid`}
          type="number"
          min={b.auction_bid_seconds.min}
          max={b.auction_bid_seconds.max}
          value={value.auction_bid_seconds}
          onChange={(e) =>
            onChange({
              auction_bid_seconds: clampInt(
                e.target.value,
                b.auction_bid_seconds.min,
                b.auction_bid_seconds.max,
                value.auction_bid_seconds,
              ),
            })
          }
          className="h-btn-md w-24 text-[12px]"
        />
      </FieldRow>

      <FieldRow
        label="Anti-snipe"
        htmlFor={`${idPrefix}-auction-anti-snipe`}
        hint="A bid inside this many seconds resets the clock to it. 0 turns anti-snipe off."
      >
        <Input
          id={`${idPrefix}-auction-anti-snipe`}
          type="number"
          min={b.auction_anti_snipe_seconds.min}
          max={b.auction_anti_snipe_seconds.max}
          value={value.auction_anti_snipe_seconds}
          onChange={(e) =>
            onChange({
              auction_anti_snipe_seconds: clampInt(
                e.target.value,
                b.auction_anti_snipe_seconds.min,
                b.auction_anti_snipe_seconds.max,
                value.auction_anti_snipe_seconds,
              ),
            })
          }
          className="h-btn-md w-24 text-[12px]"
        />
      </FieldRow>

      <FieldRow
        label="Nomination order"
        htmlFor={`${idPrefix}-nomination-order-mode`}
        hint="Who nominates next, circularly (§8.3)."
      >
        <ChoiceSelect
          id={`${idPrefix}-nomination-order-mode`}
          ariaLabel="Nomination order"
          value={value.nomination_order_mode}
          width="w-56"
          options={[
            { value: 'same_as_draft_order', label: 'Same as draft order' },
            { value: 'random', label: 'Random' },
            ...(offerManual ? [{ value: 'manual', label: 'Commissioner sets' }] : []),
          ]}
          onValueChange={(v) =>
            onChange({ nomination_order_mode: v as DraftConfig['nomination_order_mode'] })
          }
        />
      </FieldRow>

      {issues.map((e) => (
        <InlineIssue key={e.message} tone="error" message={e.message} />
      ))}
    </>
  )
}
