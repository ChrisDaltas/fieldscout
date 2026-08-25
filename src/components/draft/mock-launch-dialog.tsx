'use client'

import { useState } from 'react'

import {
  AuctionConfigFields,
  PickClockField,
  SnakeReversalField,
} from '@/components/leagues/draft-config-fields'
import { RosterSlotBuilder } from '@/components/leagues/roster-slot-builder'
import { ScoringTemplatePicker } from '@/components/leagues/scoring-template-picker'
import {
  ChoiceSelect,
  FieldRow,
  InlineIssue,
  numOptions,
} from '@/components/leagues/settings-form-controls'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { useLaunchStandaloneMock } from '@/hooks/use-mock-drafts'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import {
  V1_TEAM_COUNTS,
  type LeagueSettings,
} from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'
import type { Draft } from '@/types/database'

import {
  initialMockLaunchDraft,
  mockLaunchBlockedReason,
  mockLaunchIssues,
  patchMockDraftConfig,
  patchMockSettings,
  toMockLaunchInput,
  type MockLaunchDraft,
} from './mock-launch-ops'
import { mockSlotOptions, RANDOM_SLOT, slotFromPickerValue } from './mock-launcher-ops'

/**
 * The practice-draft launch dialog (MP task MP.4; spec v2.16 §8.8; D229).
 *
 * ONE launch dialog and ONE launch RPC (§7 / tasks-MP §5 MS.8's row): this
 * is the standalone arm of `create_mock_draft`, and MS.8's slot picker
 * composes INTO this form when it lands rather than forking it. Everything
 * it collects is a §7.3 setting the league surfaces already edit, through
 * the SAME controls (`settings-form-controls`, `RosterSlotBuilder`,
 * `ScoringTemplatePicker` — a second settings editor is the LV.7 failure
 * pattern), and every value it produces goes through `mock-launch-ops`,
 * which owns the seam (§4 rule 12).
 *
 *   1. Format   — draft type, team count, CPU speed
 *   2. Clocks   — the §7.3.8 knobs for the chosen draft type
 *   3. Roster   — the shipped roster-slot builder
 *   4. Scoring  — one of the six shipped templates (D229(1))
 *
 * The defaults on open are the schema's own (D229(3): pick clock 90,
 * nomination 30, bid 20, anti-snipe 10, `DEFAULT_ROSTER_SETTINGS`) and are
 * *"merely a suggestion"* (D229(4)) — every one of them is editable right
 * here, which is the point of the whole task.
 *
 * WHERE IT LANDS IS THE MOUNT'S BUSINESS. `onLaunched` hands the created
 * draft row back; MP.5 (`/app/mocks`) and MP.6 (`/app/mocks/[mockId]`) own
 * the destination, and hard-coding a route that does not exist yet would be
 * this task claiming a surface it does not own.
 *
 * States (§4 rule 14 — this is launch-facing): the template step carries the
 * picker's own loading / error-with-retry / empty states; the launch button
 * carries the pending state; refusals surface VERBATIM in an inline error
 * (they are the RPC's, written to be read by a launcher — the §22.5 caps,
 * the §8.6.8 solvency message, the range guard). No explanatory copy
 * (§4 rule 16): each label names its control.
 */

const STEPS = ['Format', 'Clocks', 'Roster', 'Scoring'] as const


export interface MockLaunchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The created (or replayed — `created:false` is the same success,
   *  D110(11)) draft row. The mount decides where to send the launcher. */
  onLaunched: (draft: Draft) => void
}

export function MockLaunchDialog({ open, onOpenChange, onLaunched }: MockLaunchDialogProps) {
  const [draft, setDraft] = useState<MockLaunchDraft>(initialMockLaunchDraft)
  const [step, setStep] = useState(0)
  const [refusal, setRefusal] = useState<string | null>(null)
  const launch = useLaunchStandaloneMock()

  const input = toMockLaunchInput(draft)
  const blocked = mockLaunchBlockedReason(draft)
  const issues = mockLaunchIssues(draft)
  const pending = launch.isPending

  function handleOpenChange(next: boolean) {
    if (!next && pending) return
    onOpenChange(next)
    if (!next) {
      // A closed dialog is a discarded draft (the create-modal rule).
      setDraft(initialMockLaunchDraft())
      setStep(0)
      setRefusal(null)
    }
  }

  function handleLaunch() {
    if (input === null || pending) return
    setRefusal(null)
    launch
      .launchStandaloneAsync(input)
      .then(({ draft: created }) => {
        // A launched draft is a finished draft: reset before handing it
        // back, so a dialog reopened from the same mount opens on step 1
        // with the catalog defaults rather than the last run's settings.
        // `onLaunched` may unmount this (MP.5/MP.7 navigate), so the reset
        // happens FIRST — the dismissal path resets in `handleOpenChange`
        // and the two must not disagree.
        setDraft(initialMockLaunchDraft())
        setStep(0)
        onLaunched(created)
      })
      .catch((error: unknown) => {
        // The RPC's friendly refusals are product copy and are shown
        // VERBATIM (§16.5.2) — inline rather than in a toast, because the
        // thing to change is on screen behind it.
        setRefusal(
          error instanceof LeagueActionError
            ? error.message
            : 'Something went wrong. Please try again.',
        )
      })
  }

  const d = draft.settings.draft
  const auction = d.draft_type === 'auction'
  const onDraftConfig = (patch: Partial<LeagueSettings['draft']>) =>
    setDraft((p) => patchMockDraftConfig(p, patch))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            <Icon name="rocket" size={15} className="mr-1.5 inline align-[-2px]" />
            Practice draft
          </DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length} — {STEPS[step]}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-1">
          {step === 0 && (
            <div className="flex flex-col gap-3.5">
              <div className="space-y-1.5">
                <Label className="text-[13px] font-bold">Draft type</Label>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <TypeCard
                    label="Snake"
                    hint="The order reverses every round."
                    selected={d.draft_type === 'snake'}
                    onSelect={() => setDraft((p) => patchMockDraftConfig(p, { draft_type: 'snake' }))}
                  />
                  <TypeCard
                    label="Auction"
                    hint="Every seat bids from a budget."
                    selected={auction}
                    onSelect={() => setDraft((p) => patchMockDraftConfig(p, { draft_type: 'auction' }))}
                  />
                  <TypeCard
                    label="Linear"
                    hint="The same order every round."
                    selected={d.draft_type === 'linear'}
                    onSelect={() => setDraft((p) => patchMockDraftConfig(p, { draft_type: 'linear' }))}
                  />
                </div>
              </div>

              <FieldRow label="Number of teams" htmlFor="mock-team-count">
                <ChoiceSelect
                  id="mock-team-count"
                  ariaLabel="Number of teams"
                  value={String(draft.settings.team_count)}
                  options={numOptions([...V1_TEAM_COUNTS])}
                  width="w-28"
                  onValueChange={(v) =>
                    setDraft((p) =>
                      patchMockSettings(p, {
                        team_count: Number(v) as LeagueSettings['team_count'],
                      }),
                    )
                  }
                />
              </FieldRow>

              {/* MS.8 (D223/E77): the ONE launch question the ruling added —
                  your draft slot. A standalone practice has no stored order,
                  so the picker is always live; Random (the default) sends no
                  key and the server's seeded shuffle runs unchanged. */}
              <FieldRow label="Draft slot" htmlFor="mock-slot">
                <ChoiceSelect
                  id="mock-slot"
                  ariaLabel="Draft slot"
                  value={draft.slot === null ? RANDOM_SLOT : String(draft.slot)}
                  options={mockSlotOptions(draft.settings.team_count)}
                  width="w-28"
                  onValueChange={(v) =>
                    setDraft((p) => ({ ...p, slot: slotFromPickerValue(v) ?? null }))
                  }
                />
              </FieldRow>

              <div className="space-y-1.5">
                <Label className="text-[13px] font-bold">CPU speed</Label>
                <Segment aria-label="CPU speed" className="w-fit">
                  <SegmentItem
                    active={draft.cpuSpeed === 'realistic'}
                    onClick={() => setDraft((p) => ({ ...p, cpuSpeed: 'realistic' }))}
                  >
                    Realistic
                  </SegmentItem>
                  <SegmentItem
                    active={draft.cpuSpeed === 'fast'}
                    onClick={() => setDraft((p) => ({ ...p, cpuSpeed: 'fast' }))}
                  >
                    Fast
                  </SegmentItem>
                </Segment>
                <p className="text-[11px] font-semibold text-n-3">
                  Affects bot think-time only — your own clock always runs real.
                </p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-3">
              {/* R505: these are the SHARED §7.3.8 fields — the same
                  components the league settings panel mounts, not a copy of
                  them. The pick clock offers the WHOLE `PICK_TIMER_SECONDS`
                  catalog (R506: D229(4) says let the launcher make the clocks
                  what they want, and a trim would be a product decision
                  living in a code comment). */}
              {!auction && <PickClockField value={d} onChange={onDraftConfig} idPrefix="mock" />}
              {d.draft_type === 'snake' && (
                <SnakeReversalField value={d} onChange={onDraftConfig} idPrefix="mock" />
              )}
              {auction && (
                <AuctionConfigFields
                  value={d}
                  onChange={onDraftConfig}
                  idPrefix="mock"
                  // `offerManual` is deliberately absent: a standalone
                  // practice draft has no league and no commissioner, and
                  // 095 refuses anything but same_as_draft_order/random by
                  // name (D110(1) — even now that the league panel offers
                  // `manual` for real, 098/AP.5).
                  issues={issues.filter((i) => i.field.startsWith('draft'))}
                />
              )}
            </div>
          )}

          {step === 2 && (
            <RosterSlotBuilder
              value={draft.settings.roster_settings}
              teamCount={draft.settings.team_count}
              onChange={(roster_settings) =>
                setDraft((p) => patchMockSettings(p, { roster_settings }))
              }
            />
          )}

          {step === 3 && (
            <ScoringTemplatePicker
              value={draft.scoringSystemId}
              onChange={(scoringSystemId) => setDraft((p) => ({ ...p, scoringSystemId }))}
            />
          )}
        </div>

        {/* R509: a SETTINGS violation renders on the step that owns the
            field — the auction rows through `AuctionConfigFields`' own
            `issues`, the roster rows through `RosterSlotBuilder`'s inline
            `validateLeagueSettings` render. A step-4 catch-all naming a
            control the user cannot see is not a message. What is left here
            is the SERVER's refusal, which belongs to the submit and to no
            step. */}
        {refusal && <InlineIssue tone="error" message={refusal} />}

        {step === STEPS.length - 1 && !pending && !refusal && blocked && (
          // R509: above the footer rule, not below it — a line under the
          // action row reads as a footnote to the stepper rather than a
          // reason the button is disabled. When `issues` is non-empty this
          // repeats the offending step's own inline message, which is the
          // point: it names why the button will not fire.
          <p className="text-[11px] font-semibold text-n-3" role="status">
            {blocked}
          </p>
        )}

        <div className="flex items-center gap-2.5 border-t border-n-4 pt-3">
          <Stepper step={step} onStep={setStep} />
          <div className="ml-auto">
            {step < STEPS.length - 1 ? (
              <Button type="button" variant="blue" size="sm" shadow onClick={() => setStep(step + 1)}>
                Next
                <Icon name="arrow-next" size={13} />
              </Button>
            ) : (
              <Button
                type="button"
                variant="blue"
                size="sm"
                shadow
                disabled={input === null || pending}
                onClick={handleLaunch}
              >
                {pending ? (
                  <>
                    <Icon name="repeat" size={13} className="animate-spin" />
                    Setting up…
                  </>
                ) : (
                  <>
                    <Icon name="rocket" size={13} />
                    Start practice draft
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The draft-type card — the create modal's `OptionCard` shape (same
 *  treatment, same tokens); selection is a resting condition so it is
 *  carried by fill + border, never a shadow (CLAUDE.md's elevation rule). */
function TypeCard({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string
  hint: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-sm border px-3 py-2.5 text-left transition-colors',
        selected ? 'border-ink bg-accent-soft' : 'border-n-4 bg-page hover:border-ink',
      )}
    >
      <span className="flex w-full items-center justify-between text-[13px] font-extrabold">
        {label}
        {selected && <Icon name="check-circle" size={14} />}
      </span>
      <span className="text-[11px] font-semibold text-n-3">{hint}</span>
    </button>
  )
}

function Stepper({ step, onStep }: { step: number; onStep: (i: number) => void }) {
  return (
    <nav aria-label="Practice draft steps">
      <ol className="flex items-center gap-1.5">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              aria-current={i === step ? 'step' : undefined}
              onClick={() => onStep(i)}
              className={cn(
                'flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[12px] font-bold transition-colors',
                i === step
                  ? 'border-ink bg-ink text-white'
                  : 'border-n-4 bg-page text-n-3 hover:border-ink hover:text-ink',
              )}
            >
              <span className="fs-num">{i + 1}</span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
