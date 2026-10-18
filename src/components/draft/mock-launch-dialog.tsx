'use client'

import { useMemo, useState } from 'react'

import {
  AuctionConfigFields,
  PickClockField,
  SnakeReversalField,
} from '@/components/leagues/draft-config-fields'
import { RosterSlotBuilder } from '@/components/leagues/roster-slot-builder'
import { ScoringTemplatePicker } from '@/components/leagues/scoring-template-picker'
import {
  effectiveTemplateSelection,
  resolveDefaultTemplateId,
} from '@/components/leagues/scoring-template-picker-ops'
import {
  ChoiceSelect,
  FieldRow,
  InlineIssue,
  numOptions,
  SettingsSkin,
  useSettingsSkin,
} from '@/components/leagues/settings-form-controls'
import {
  MChoiceChip,
  MField,
  MRadioCard,
  MStepProgress,
  MWizardFooter,
} from '@/components/mobile/ui/m-form'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
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
import type { LayoutMode } from '@/hooks/use-layout-mode'
import { useLaunchStandaloneMock } from '@/hooks/use-mock-drafts'
import { useScoringTemplates } from '@/hooks/use-scoring-templates'
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
  type CpuSpeed,
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
 *   4. Scoring  — one of the eight shipped templates, Scout Standard
 *                  preselected as the system default and freely changeable
 *                  (§8.8's preselection sentence; SC.3/SC.4 — the launcher
 *                  is UNFILTERED so it preselects the system default, and
 *                  D229(1)'s "pick one at launch" stays the launcher's
 *                  pick)
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
 *
 * `layout="mobile"` (the phone's Home Practice card, gap list §4 item 2) is
 * the SAME dialog — same draft, steps, controls and launch call — drawn as a
 * FieldScout Mobile bottom sheet: the shared controls take the phone
 * language through `SettingsSkin`, Back / Continue replace the stepper, and
 * the sheet follows the phone's light or dark theme.
 */

const STEPS = ['Format', 'Clocks', 'Roster', 'Scoring'] as const
const CPU_SPEEDS: ReadonlyArray<{ value: CpuSpeed; label: string }> = [
  { value: 'realistic', label: 'Realistic' },
  { value: 'fast', label: 'Fast' },
]
const CPU_SPEED_HINT = 'Affects bot think-time only — your own clock always runs real.'


export interface MockLaunchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The created (or replayed — `created:false` is the same success,
   *  D110(11)) draft row. The mount decides where to send the launcher. */
  onLaunched: (draft: Draft) => void
  /** `mobile` = the phone's bottom sheet (the mobile Home's Practice card). */
  layout?: LayoutMode
}

export function MockLaunchDialog({ open, onOpenChange, onLaunched, layout = 'desktop' }: MockLaunchDialogProps) {
  const mobile = layout === 'mobile'
  const [draft, setDraft] = useState<MockLaunchDraft>(initialMockLaunchDraft)
  const [step, setStep] = useState(0)
  const [refusal, setRefusal] = useState<string | null>(null)
  const launch = useLaunchStandaloneMock()

  // SC.3/SC.4 — §8.8's preselection sentence: the launcher preselects
  // Scout Standard, the SYSTEM default (the launcher is unfiltered, so it
  // never wears a family view's Scout — v2.16.11's family law), still
  // freely changeable. A pure DERIVATION (explicit pick ?? the
  // natural-key-resolved Scout Standard id — the shared
  // `effectiveTemplateSelection` rule), so an explicit pick always wins and
  // a missing Scout row degrades loudly to the explicit-pick flow
  // (`resolveDefaultTemplateId` warns; the launch gate keeps refusing with
  // the designed "Pick a scoring template to start." line). The query is
  // gated on `open` — this dialog sits mounted-closed on Home.
  const templatesQuery = useScoringTemplates({ enabled: open })
  const defaultTemplateId = useMemo(
    () => resolveDefaultTemplateId(templatesQuery.data),
    [templatesQuery.data],
  )
  const effectiveScoringId = effectiveTemplateSelection(
    draft.scoringSystemId,
    defaultTemplateId,
  )

  const input = toMockLaunchInput(draft, defaultTemplateId)
  const blocked = mockLaunchBlockedReason(draft, defaultTemplateId)
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
  const setTeamCount = (v: string) =>
    setDraft((p) =>
      patchMockSettings(p, {
        team_count: Number(v) as LeagueSettings['team_count'],
      }),
    )
  const setCpuSpeed = (cpuSpeed: CpuSpeed) => setDraft((p) => ({ ...p, cpuSpeed }))

  const typeCards = (
    <>
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
    </>
  )

  // MS.8 (D223/E77): the ONE launch question the ruling added — your draft
  // slot. A standalone practice has no stored order, so the picker is always
  // live; Random (the default) sends no key and the server's seeded shuffle
  // runs unchanged.
  const slotSelect = (
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
  )

  // The step body — ONE body for both layouts; the desktop dialog and the
  // phone sheet differ only in their chrome (header, stepper, footer), and
  // the Format step in the phone's chips and segmented control.
  const stepBody = (
    <>
      {step === 0 && mobile && (
        <div className="flex flex-col gap-5">
          <MField label="Draft type">
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Draft type">
              {typeCards}
            </div>
          </MField>
          <MField label="Number of teams">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Number of teams">
              {V1_TEAM_COUNTS.map((n) => (
                <MChoiceChip
                  key={n}
                  label={String(n)}
                  on={draft.settings.team_count === n}
                  onPick={() => setTeamCount(String(n))}
                />
              ))}
            </div>
          </MField>
          <MField label="Draft slot" htmlFor="mock-slot">
            <div className="flex">{slotSelect}</div>
          </MField>
          <MField label="CPU speed" hint={CPU_SPEED_HINT}>
            <MSegmented
              label="CPU speed"
              options={CPU_SPEEDS}
              value={draft.cpuSpeed}
              onChange={setCpuSpeed}
              className="h-[34px]"
            />
          </MField>
        </div>
      )}
      {step === 0 && !mobile && (
        <div className="flex flex-col gap-3.5">
          <div className="space-y-1.5">
            <Label className="text-[13px] font-bold">Draft type</Label>
            <div className="grid gap-2.5 sm:grid-cols-3">{typeCards}</div>
          </div>

          <FieldRow label="Number of teams" htmlFor="mock-team-count">
            <ChoiceSelect
              id="mock-team-count"
              ariaLabel="Number of teams"
              value={String(draft.settings.team_count)}
              options={numOptions([...V1_TEAM_COUNTS])}
              width="w-28"
              onValueChange={setTeamCount}
            />
          </FieldRow>

          <FieldRow label="Draft slot" htmlFor="mock-slot">
            {slotSelect}
          </FieldRow>

          <div className="space-y-1.5">
            <Label className="text-[13px] font-bold">CPU speed</Label>
            <Segment aria-label="CPU speed" className="w-fit">
              <SegmentItem
                active={draft.cpuSpeed === 'realistic'}
                onClick={() => setCpuSpeed('realistic')}
              >
                Realistic
              </SegmentItem>
              <SegmentItem
                active={draft.cpuSpeed === 'fast'}
                onClick={() => setCpuSpeed('fast')}
              >
                Fast
              </SegmentItem>
            </Segment>
            <p className="text-[10px] font-medium text-n-6">
              {CPU_SPEED_HINT}
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
          // SC.3: the EFFECTIVE selection (explicit pick ?? the Scout
          // preselection) — what renders selected is exactly what the
          // launch will submit.
          value={effectiveScoringId}
          onChange={(scoringSystemId) => setDraft((p) => ({ ...p, scoringSystemId }))}
        />
      )}
    </>
  )

  if (mobile) {
    // The phone (gap list §4 item 2): the same steps in a FieldScout Mobile
    // bottom sheet — the New ranking wizard's progress track and footer
    // (lr-myrank §2.2), Back / Continue in place of the desktop stepper.
    // The server's refusal and the reason Start is off sit above the
    // buttons, as R509 places them on desktop.
    const last = step === STEPS.length - 1
    return (
      <SettingsSkin layout="mobile">
        <MobileSheet
          open={open}
          onOpenChange={handleOpenChange}
          title="Mock draft"
          subtitle={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`}
          showClose
          size="tall"
          scrollKey={step}
          footer={
            <MWizardFooter
              onBack={step > 0 && !pending ? () => setStep(step - 1) : undefined}
              label={!last ? 'Continue' : pending ? 'Setting up…' : 'Start mock draft'}
              onClick={!last ? () => setStep(step + 1) : handleLaunch}
              disabled={last && (input === null || pending)}
            >
              {refusal && <InlineIssue tone="error" message={refusal} />}
              {last && !pending && !refusal && blocked && (
                <p className="text-center text-[12px] font-medium text-m-t3" role="status">
                  {blocked}
                </p>
              )}
            </MWizardFooter>
          }
        >
          <div className="sticky top-0 z-[2] bg-m-b0">
            <MStepProgress step={step} total={STEPS.length} />
          </div>
          <div className="flex flex-col gap-5 px-5 pb-4 pt-4">{stepBody}</div>
        </MobileSheet>
      </SettingsSkin>
    )
  }

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

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-1">{stepBody}</div>

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
          <p className="text-[11px] font-medium text-n-3" role="status">
            {blocked}
          </p>
        )}

        <div className="flex items-center gap-2.5 border-t border-n-4 pt-3">
          <Stepper step={step} onStep={setStep} />
          <div className="ml-auto">
            {step < STEPS.length - 1 ? (
              <Button type="button" variant="blue" size="md" onClick={() => setStep(step + 1)}>
                Next
                <Icon name="arrow-next" size={13} />
              </Button>
            ) : (
              <Button
                type="button"
                variant="blue"
                size="md"
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
  if (useSettingsSkin() === 'mobile') return <MRadioCard label={label} sub={hint} on={selected} onPick={onSelect} />
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-xl px-3.5 py-3 text-left transition-colors',
        selected
          ? 'bg-accent-soft text-accent-deep shadow-ring-accent'
          : 'bg-surface-sunken hover:bg-surface-hover',
      )}
    >
      <span className="flex w-full items-center justify-between text-[13px] font-bold tracking-[-0.01em]">
        {label}
        {selected && <Icon name="check-circle" size={14} />}
      </span>
      <span className="text-[10px] font-medium text-n-3">{hint}</span>
    </button>
  )
}

function Stepper({ step, onStep }: { step: number; onStep: (i: number) => void }) {
  return (
    <nav aria-label="Practice draft steps">
      <ol className="flex items-center gap-1">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              aria-current={i === step ? 'step' : undefined}
              onClick={() => onStep(i)}
              className={cn(
                'flex h-btn-sm items-center gap-1.5 rounded-pill px-2.5 text-[11px] font-semibold transition-colors',
                i === step
                  ? 'bg-ink text-white'
                  : 'bg-surface-control text-n-3 hover:bg-surface-pressed hover:text-ink',
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
