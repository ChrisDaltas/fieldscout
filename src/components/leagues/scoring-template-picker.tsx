'use client'

import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useScoringTemplates } from '@/hooks/use-scoring-templates'
import { cn } from '@/lib/utils'

import {
  buildTemplateCards,
  canCustomize,
  formatPoints,
  TEMPLATE_DISPLAY_ORDER,
  type ScoringCustomizeContext,
  type TemplateCard,
} from './scoring-template-picker-ops'

/**
 * Scoring-template-picker (M1 task L.A2.3; spec §7.3.3, §16.2, App B;
 * Customize entry SE.9 — spec §7.3.3.1 entry-point bullet, D170).
 *
 * The seven template cards (6 parity templates + Scout Scoring, SC.1; name +
 * §7.3.3 one-liner) + side-by-side compare of the key category values (PPR,
 * INT, kicking tiers, D/ST model), every displayed value DERIVED from the
 * fetched rows' `rules` via the pure ops layer — never a hand-maintained
 * display table. Rows are the REAL seeded templates (`is_template = TRUE`,
 * world-readable incl. anon) via `useScoringTemplates`.
 *
 * Controlled for SELECTION only: `value` is the chosen `scoring_system_id`,
 * clicking a card emits it through `onChange`. NO league writes here —
 * persisting the choice belongs to the consumers, and even the SE.9
 * Customize affordance only EMITS the clicked template id through the
 * `customize` context: the fork mutation itself lives at the settings mount.
 * The §7.3.3 SYSTEM-DEFAULT PRESELECTION (SC.3) is likewise the mounts'
 * business: the two league-less mounts derive `value` through
 * `effectiveTemplateSelection` (explicit pick ?? resolved Scout default);
 * this component never preselects on its own — it renders whatever `value`
 * says, and only marks the Scout card with its "FieldScout's default" badge.
 *
 * Consumed by THREE mounts — never fork this component (CLAUDE.md):
 *   1. the create wizard (`league-create-modal.tsx`) — no league exists yet
 *      (D170: a league is born on a template), so NO `customize` context;
 *   2. the settings panel (`settings-panel.tsx`) — the ONE league-context
 *      mount, and the only one that passes `customize`;
 *   3. the standalone mock launcher (`mock-launch-dialog.tsx`, MP.4) — no
 *      league AT ALL (`drafts.league_id` is nullable, migration 095), so NO
 *      `customize` context.
 * The colocated render test pins Customize present in exactly the settings
 * configuration and absent in the other two, plus a source sweep that the
 * two league-less mounts never pass the prop.
 *
 * Explicitly ABSENT by spec (§16.5.5) — do not add: FieldScout Alpha/Ultra
 * cards (return when advanced stats are funded — no teaser/locked cards) and
 * the "same game, scored three ways" widget. The picker renders exactly one
 * card per fetched row and invents no extra slots (pinned in the colocated
 * test). The custom scoring EDITOR stays its own §16.2 surface
 * (`scoring-editor.tsx`): this component only opens the door to it.
 *
 * v2.8.5 parity-exception visibility (Q9): the ESPN rows' `description`
 * carries the commissioner-readable exception line. Design call (PROGRESS
 * D66): every card renders its FULL description — untruncated, no
 * line-clamp — in an always-open block under the one-liner, and the compare
 * view repeats it in a "Notes" row, so the exception note cannot be hidden
 * on either surface.
 *
 * §16.5.4 data states: skeleton grid while loading, designed empty copy,
 * error-with-retry. Degraded/last-good doesn't apply (seed data, no live
 * numbers).
 */
export interface ScoringTemplatePickerProps {
  /** The league's chosen `scoring_system_id` (§12.1), or null before one
   *  is picked. */
  value: string | null
  /** Emits the clicked template's `scoring_systems.id`. */
  onChange: (scoringSystemId: string) => void
  /** Narrow the cards by reception scoring: 'ppr' keeps templates whose
   *  derived receptions coefficient is > 0 (full AND half PPR), 'no_ppr'
   *  keeps the zero-reception ones. Omit for all seven (the default). */
  styleFilter?: 'ppr' | 'no_ppr'
  /** SE.9/D170: league context for the Customize entry — passed by the
   *  settings mount ONLY. Omitted (the default) = no league = templates-only
   *  rendering; the picker itself decides visibility from the context's
   *  role + status (`canCustomize`), so a member or an out-of-window league
   *  never sees the affordance even at the settings mount. */
  customize?: ScoringCustomizeContext
  className?: string
}

export function ScoringTemplatePicker({
  value,
  onChange,
  styleFilter,
  customize,
  className,
}: ScoringTemplatePickerProps) {
  const { data, isPending, isError, refetch, isRefetching } =
    useScoringTemplates()
  const [compareOpen, setCompareOpen] = useState(false)

  if (isPending) {
    return (
      <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', className)}>
        {/* F193: one placeholder per KNOWN template, derived from the §7.3.3
            order list so an eighth template never re-strands this count at
            a stale literal (it was a hard 6 after SC.1 made the grid 7). */}
        {Array.from({ length: TEMPLATE_DISPLAY_ORDER.length }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-sm" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <Card className={cn('border-negative bg-negative-soft', className)}>
        <CardContent className="flex flex-col items-start gap-2 p-4">
          <p className="text-[13px] font-bold" role="alert">
            Couldn&apos;t load the scoring templates.
          </p>
          <p className="text-[12px] font-semibold text-n-3">
            Check your connection and try again — nothing was changed.
          </p>
          <Button
            type="button"
            variant="stroke"
            size="sm"
            disabled={isRefetching}
            onClick={() => refetch()}
          >
            <Icon name="reset" /> Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  const cards = buildTemplateCards(data).filter((card) =>
    styleFilter === undefined
      ? true
      : styleFilter === 'ppr'
        ? card.summary.ppr > 0
        : card.summary.ppr === 0,
  )

  if (cards.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <p className="text-[13px] font-bold">No scoring templates yet.</p>
          <p className="text-[12px] font-semibold text-n-3">
            {/* F193: count derived from the §7.3.3 order list, never a
                literal that goes stale when a template joins. */}
            The {TEMPLATE_DISPLAY_ORDER.length} league scoring templates ship
            with the database seed — if you&apos;re seeing this, the
            environment hasn&apos;t run its migrations. There&apos;s nothing
            to pick until they land.
          </p>
        </CardContent>
      </Card>
    )
  }

  // SE.9/D170: the Customize entry renders only with a league context whose
  // viewer is a commissioner and whose league is still in the §7.3 window.
  const customizeVisible = canCustomize(customize)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-n-3">
          Pick one of the {cards.length} scoring templates — each matches that
          platform&apos;s published defaults, so a migrating league&apos;s
          scores feel identical.
        </p>
        <Button
          type="button"
          variant="stroke"
          size="sm"
          aria-expanded={compareOpen}
          onClick={() => setCompareOpen((v) => !v)}
        >
          <Icon name="table" />
          {compareOpen ? 'Hide compare' : 'Compare side-by-side'}
        </Button>
      </div>

      {customizeVisible && customize?.disabledReason && (
        <p className="text-[12px] font-semibold text-n-3">
          {customize.disabledReason}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <TemplateCardButton
            key={card.id}
            card={card}
            selected={card.id === value}
            onSelect={() => onChange(card.id)}
            customize={customizeVisible && customize ? customize : undefined}
          />
        ))}
      </div>

      {compareOpen && <CompareTable cards={cards} selectedId={value} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces (internal — not exported, no parallel component tree)
// ---------------------------------------------------------------------------

function TemplateCardButton({
  card,
  selected,
  onSelect,
  customize,
}: {
  card: TemplateCard
  selected: boolean
  onSelect: () => void
  /** Present only when the Customize entry is VISIBLE (the picker gates
   *  through `canCustomize` before passing it down). */
  customize?: ScoringCustomizeContext
}) {
  const { summary } = card
  const customizePending = customize?.pendingTemplateId === card.id
  const customizeDisabled =
    customize !== undefined &&
    (customize.pendingTemplateId != null || customize.disabledReason != null)
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'cursor-pointer text-left transition-shadow hover:shadow-hard-4',
        // Selection is carried by the accent border, not by elevation — a
        // resting shadow here would make the chosen card float permanently.
        selected && 'border-accent',
      )}
    >
      <CardContent className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[14px] font-extrabold">{card.name}</div>
            <div className="text-[12px] font-semibold text-n-3">
              {card.oneLiner}
            </div>
          </div>
          {selected ? (
            <Badge variant="accent">
              <Icon name="check" /> Selected
            </Badge>
          ) : card.defaultMarker ? (
            // SC.3 (§7.3.3 system-default bullet): the recommended default
            // reads as one — accent-soft tint + accent border, a resting
            // condition carried by fill/border, never elevation (CLAUDE.md).
            <Badge variant="stroke-purple">{card.defaultMarker}</Badge>
          ) : (
            card.platformDefaultMarker && <Badge variant="lime">{card.platformDefaultMarker}</Badge>
          )}
        </div>
        {selected && card.defaultMarker && (
          <Badge variant="stroke-purple" className="self-start">
            {card.defaultMarker}
          </Badge>
        )}
        {selected && card.platformDefaultMarker && (
          <Badge variant="lime" className="self-start">
            {card.platformDefaultMarker}
          </Badge>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="stroke">
            <span className="fs-num">{formatPoints(summary.ppr)}</span>&nbsp;PPR
          </Badge>
          <Badge variant="stroke">
            INT&nbsp;<span className="fs-num">{formatPoints(summary.int)}</span>
          </Badge>
          <Badge variant="stroke">
            D/ST {summary.dstModel === 'split' ? 'points + yards' : 'points allowed'}
          </Badge>
        </div>
        {/* Full description, untruncated — the ESPN rows' Q9 parity-
            exception line must stay readable (v2.8.5). */}
        {card.description && (
          <p className="text-[11px] font-medium leading-relaxed text-n-3">
            {card.description}
          </p>
        )}
        {/* SE.9 — the §7.3.3.1 "Customize" entry (D170: league context
            only). A real button nested in the role="button" card, so both
            handlers stop propagation — otherwise activating Customize would
            also re-select the card (the list-row-parts.tsx house pattern
            for controls inside clickable rows). */}
        {customize && (
          <div className="mt-auto pt-1">
            <Button
              type="button"
              variant="stroke"
              size="sm"
              aria-label={`Customize ${card.name}`}
              disabled={customizeDisabled}
              title={customize.disabledReason ?? undefined}
              onClick={(e) => {
                e.stopPropagation()
                customize.onCustomize(card.id)
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {customizePending ? (
                <>
                  <Icon name="repeat" size={13} className="animate-spin" />
                  Customizing…
                </>
              ) : (
                <>
                  <Icon name="edit" size={13} />
                  Customize
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** One compare row: label + a derived value per template. */
interface CompareRow {
  label: string
  value: (card: TemplateCard) => string
}

const COMPARE_ROWS: readonly CompareRow[] = [
  { label: 'Points per reception', value: (c) => formatPoints(c.summary.ppr) },
  { label: 'Interception thrown', value: (c) => formatPoints(c.summary.int) },
  { label: 'FG made 0–39', value: (c) => formatPoints(c.summary.kicking.fg0_39) },
  { label: 'FG made 40–49', value: (c) => formatPoints(c.summary.kicking.fg40_49) },
  { label: 'FG made 50+', value: (c) => formatPoints(c.summary.kicking.fg50Plus) },
  { label: 'PAT made', value: (c) => formatPoints(c.summary.kicking.patMade) },
  { label: 'FG missed', value: (c) => formatPoints(c.summary.kicking.fgMissed) },
  { label: 'PAT missed', value: (c) => formatPoints(c.summary.kicking.patMissed) },
  {
    label: 'D/ST model',
    value: (c) =>
      c.summary.dstModel === 'split'
        ? 'Split — points allowed + yards allowed'
        : 'Single — points allowed',
  },
]

function CompareTable({
  cards,
  selectedId,
}: {
  cards: TemplateCard[]
  selectedId: string | null
}) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-ink">
              <th className="min-w-36 px-3 py-2.5 text-left align-bottom">
                <span className="fs-overline text-[11px] text-n-3">Category</span>
              </th>
              {cards.map((card) => (
                <th
                  key={card.id}
                  className={cn(
                    'min-w-32 px-3 py-2.5 text-left align-bottom font-extrabold',
                    card.id === selectedId && 'bg-accent-soft',
                  )}
                >
                  {card.name}
                  {card.defaultMarker && (
                    <span className="block text-[10px] font-semibold text-n-3">
                      {card.defaultMarker}
                    </span>
                  )}
                  {card.platformDefaultMarker && (
                    <span className="block text-[10px] font-semibold text-n-3">
                      {card.platformDefaultMarker}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((row) => (
              <tr key={row.label} className="border-b border-n-4">
                <td className="px-3 py-2 font-bold">{row.label}</td>
                {cards.map((card) => (
                  <td
                    key={card.id}
                    className={cn(
                      'fs-num px-3 py-2 font-semibold',
                      card.id === selectedId && 'bg-accent-soft',
                    )}
                  >
                    {row.value(card)}
                  </td>
                ))}
              </tr>
            ))}
            {/* Notes row — full descriptions, incl. the ESPN parity-
                exception line (Q9/v2.8.5): the compare view never hides
                them. */}
            <tr>
              <td className="px-3 py-2 align-top font-bold">Notes</td>
              {cards.map((card) => (
                <td
                  key={card.id}
                  className={cn(
                    'min-w-56 max-w-72 px-3 py-2 align-top text-[11px] font-medium leading-relaxed text-n-3',
                    card.id === selectedId && 'bg-accent-soft',
                  )}
                >
                  {card.description || '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )
}
