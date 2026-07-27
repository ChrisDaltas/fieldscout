'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
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
import { useAuth } from '@/hooks/use-auth'
import { toast } from '@/hooks/use-toast'
import { useCreateLeague, type CreateLeagueResult } from '@/hooks/use-leagues'
import {
  PICK_TIMER_SECONDS,
  validateLeagueSettings,
  type FieldIssue,
  type LeagueSettings,
  type RosterSettings,
} from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'

import {
  initialWizardDraft,
  reconcileDerived,
  SEASON_RANGE,
  toCreateInput,
  type WizardDraft,
} from './league-create-wizard-ops'
import { RosterSlotBuilder } from './roster-slot-builder'
import { ScoringTemplatePicker } from './scoring-template-picker'

/**
 * League create wizard (M1 task L.A2.1; spec §16.2 league-create-wizard,
 * §7.3 settings catalog, §16.5.1 setup, §16.5.4 states). Replaces the
 * Pro-gated mock scaffold — creation is FREE (Q6 ruling, v2.8; the scaffold's
 * Pro upsell is gone) and the whole surface is gated only by
 * `featureFlags.leagues` (the /app/leagues layout, inherited).
 *
 * Six §16.2 steps — format → roster → scoring → waivers/trades → draft →
 * invite — over one `LeagueSettings` draft pre-filled from the creation
 * defaults so the happy path is <2 minutes (§7.3): the commissioner changes
 * only what they care about and every other field keeps its §7.3 default.
 * The exhaustive grouped-forms surface is the settings panel (L.A2.4); this
 * wizard surfaces the primary decision per step and leans on defaults for the
 * long tail (both write the SAME `leagueSettingsSchema` contract).
 *
 * Composition, never forks (CLAUDE.md): the roster step embeds
 * `RosterSlotBuilder` (L.A2.2) and the scoring step embeds
 * `ScoringTemplatePicker` (L.A2.3) — no mock-data imports on this path.
 * Server-authoritative submit: `useCreateLeague` → POST /api/leagues →
 * `create_league` RPC (the only league writer, Q8), then navigate to the real
 * league. The settings algebra (defaults, the F27 derived `playoff_start_week`,
 * the create payload) lives in the pure `league-create-wizard-ops` module.
 *
 * States (§16.5.4): per-field validation errors from the contract's
 * `validateLeagueSettings` (its messages ARE the UX — surfaced verbatim);
 * submit-pending on the create button; the scoring picker carries its own
 * skeleton/empty/error data states (L.A2.3).
 */

type WizardStepId = 'format' | 'roster' | 'scoring' | 'waivers' | 'draft' | 'invite'

const STEPS: ReadonlyArray<{ id: WizardStepId; label: string; blurb: string }> = [
  { id: 'format', label: 'Format', blurb: 'Teams, schedule, and playoffs' },
  { id: 'roster', label: 'Roster', blurb: 'Starting slots, bench, and IR' },
  { id: 'scoring', label: 'Scoring', blurb: 'Pick a platform template' },
  { id: 'waivers', label: 'Waivers & trades', blurb: 'Free agency and trade rules' },
  { id: 'draft', label: 'Draft', blurb: 'Draft type and clock' },
  { id: 'invite', label: 'Invite', blurb: 'Review and create your league' },
]

/**
 * Which `validateLeagueSettings` error fields each step owns — drives both the
 * inline messages shown on a step and the "you can't advance yet" gate. Roster
 * errors are rendered INSIDE `RosterSlotBuilder`; this list only gates Next
 * for the roster step (no duplicate rendering).
 */
const STEP_ERROR_FIELDS: Record<WizardStepId, (field: string) => boolean> = {
  format: (f) => f === 'team_count' || f === 'playoff_teams' || f === 'playoff_start_week',
  roster: (f) => f.startsWith('roster_settings'),
  scoring: () => false,
  waivers: (f) => f === 'trade_veto_votes' || f === 'trade_deadline_week',
  draft: (f) => f.startsWith('draft.'),
  invite: () => false,
}

export function LeagueCreateWizard() {
  const router = useRouter()
  const { profile } = useAuth()
  const [draft, setDraft] = useState<WizardDraft>(initialWizardDraft)
  const [stepIndex, setStepIndex] = useState(0)
  const [showStepErrors, setShowStepErrors] = useState(false)
  const [created, setCreated] = useState<CreateLeagueResult | null>(null)

  const { createLeagueAsync, isPending } = useCreateLeague()

  const stepId = STEPS[stepIndex].id
  const validation = useMemo(() => validateLeagueSettings(draft.settings), [draft.settings])

  // -- draft mutation helpers (all go through reconcileDerived so F27's
  //    playoff_start_week invariant holds on every emission) -----------------
  const updateSettings = (patch: Partial<LeagueSettings>) =>
    setDraft((prev) => ({
      ...prev,
      settings: reconcileDerived(prev.settings, { ...prev.settings, ...patch }),
    }))

  const setRoster = (roster_settings: RosterSettings) => updateSettings({ roster_settings })

  const setDraftConfig = (patch: Partial<LeagueSettings['draft']>) =>
    updateSettings({ draft: { ...draft.settings.draft, ...patch } })

  // -- per-step gating -------------------------------------------------------
  const errorsForStep = (id: WizardStepId): FieldIssue[] =>
    validation.errors.filter((e) => STEP_ERROR_FIELDS[id](e.field))

  const nameMissing = draft.name.trim().length === 0
  const scoringMissing = draft.scoringSystemId === null

  function stepBlocked(id: WizardStepId): boolean {
    if (id === 'format' && nameMissing) return true
    if (id === 'scoring' && scoringMissing) return true
    return errorsForStep(id).length > 0
  }

  const canSubmit = toCreateInput(draft) !== null && validation.valid

  function goToStep(index: number) {
    setShowStepErrors(false)
    setStepIndex(index)
  }

  function handleNext() {
    if (stepBlocked(stepId)) {
      setShowStepErrors(true)
      return
    }
    goToStep(Math.min(stepIndex + 1, STEPS.length - 1))
  }

  function handleBack() {
    goToStep(Math.max(stepIndex - 1, 0))
  }

  async function handleSubmit() {
    const input = toCreateInput(draft)
    if (input === null || !validation.valid) {
      setShowStepErrors(true)
      return
    }
    try {
      const result = await createLeagueAsync(input)
      setCreated(result)
    } catch (cause) {
      toast({
        title: "Couldn't create the league",
        description: cause instanceof Error ? cause.message : 'Please try again.',
      })
    }
  }

  // Success: the league exists — surface the shareable link (the Q5 v1
  // minimum bar: always visible + copyable) and navigate to the real league.
  if (created) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Create a league" />
        <SuccessPanel
          leagueName={draft.name.trim()}
          result={created}
          onGo={() => router.push(`/app/leagues/${created.league_id}`)}
        />
      </div>
    )
  }

  const isLastStep = stepIndex === STEPS.length - 1

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Create a league" />

      <StepStrip
        steps={STEPS}
        stepIndex={stepIndex}
        onStepClick={(i) => i < stepIndex && goToStep(i)}
      />

      <div className="mt-4 flex flex-col gap-4">
        {stepId === 'format' && (
          <FormatStep
            draft={draft}
            errors={errorsForStep('format')}
            nameError={showStepErrors && nameMissing}
            onName={(name) => setDraft((p) => ({ ...p, name }))}
            onSeason={(season) => setDraft((p) => ({ ...p, season }))}
            onSettings={updateSettings}
          />
        )}

        {stepId === 'roster' && (
          <RosterSlotBuilder
            value={draft.settings.roster_settings}
            onChange={setRoster}
            teamCount={draft.settings.team_count}
          />
        )}

        {stepId === 'scoring' && (
          <div className="flex flex-col gap-3">
            <ScoringTemplatePicker
              value={draft.scoringSystemId}
              onChange={(scoringSystemId) =>
                setDraft((p) => ({ ...p, scoringSystemId }))
              }
            />
            {showStepErrors && scoringMissing && (
              <InlineIssue
                tone="error"
                message="Pick a scoring template to continue — every league needs one."
              />
            )}
          </div>
        )}

        {stepId === 'waivers' && (
          <WaiversStep
            draft={draft}
            errors={errorsForStep('waivers')}
            onSettings={updateSettings}
          />
        )}

        {stepId === 'draft' && (
          <DraftStep
            draft={draft}
            errors={errorsForStep('draft')}
            onDraft={setDraftConfig}
          />
        )}

        {stepId === 'invite' && (
          <InviteStep
            draft={draft}
            profileName={profile?.display_name ?? profile?.username ?? null}
            canSubmit={canSubmit}
            showErrors={showStepErrors}
            onTeamName={(teamName) => setDraft((p) => ({ ...p, teamName }))}
          />
        )}
      </div>

      {/* Footer nav */}
      <div className="mt-5 flex items-center gap-2.5 border-t border-n-4 pt-4">
        {stepIndex > 0 ? (
          <Button type="button" variant="stroke" size="sm" onClick={handleBack} disabled={isPending}>
            <Icon name="arrow-prev" size={13} />
            Back
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push('/app/leagues')}
          >
            Cancel
          </Button>
        )}

        <span className="fs-num ml-auto text-[11px] font-bold text-n-3">
          Step {stepIndex + 1} of {STEPS.length}
        </span>

        {isLastStep ? (
          <Button
            type="button"
            variant="blue"
            size="sm"
            shadow
            disabled={isPending || !canSubmit}
            onClick={handleSubmit}
          >
            {isPending ? (
              <>
                <Icon name="repeat" size={13} className="animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Icon name="plus" size={13} />
                Create league
              </>
            )}
          </Button>
        ) : (
          <Button type="button" variant="blue" size="sm" shadow onClick={handleNext}>
            Next
            <Icon name="arrow-next" size={13} />
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step strip (progress header)
// ---------------------------------------------------------------------------

function StepStrip({
  steps,
  stepIndex,
  onStepClick,
}: {
  steps: ReadonlyArray<{ id: WizardStepId; label: string; blurb: string }>
  stepIndex: number
  onStepClick: (index: number) => void
}) {
  return (
    <nav aria-label="Create-league steps" className="flex flex-col gap-2">
      <ol className="flex flex-wrap items-center gap-1.5">
        {steps.map((s, i) => {
          const state = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'upcoming'
          return (
            <li key={s.id} className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={state === 'upcoming'}
                aria-current={state === 'current' ? 'step' : undefined}
                onClick={() => onStepClick(i)}
                className={cn(
                  'flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[12px] font-bold transition-colors',
                  state === 'current' && 'border-ink bg-ink text-white',
                  state === 'done' && 'border-ink bg-page text-ink hover:bg-accent-soft',
                  state === 'upcoming' && 'cursor-default border-n-4 bg-page text-n-3',
                )}
              >
                <span
                  className={cn(
                    'fs-num flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-extrabold',
                    state === 'current' && 'bg-white text-ink',
                    state === 'done' && 'bg-ink text-white',
                    state === 'upcoming' && 'bg-n-4 text-n-3',
                  )}
                >
                  {state === 'done' ? <Icon name="check" size={10} /> : i + 1}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < steps.length - 1 && (
                <span aria-hidden className="text-n-3">
                  <Icon name="arrow-next" size={11} />
                </span>
              )}
            </li>
          )
        })}
      </ol>
      <p className="text-[12px] font-semibold text-n-3">{steps[stepIndex].blurb}</p>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Shared control primitives (internal — no parallel component tree)
// ---------------------------------------------------------------------------

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

function FieldRow({
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

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onCheckedChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-bold">
          {label}
        </label>
        {hint && <p className="text-[11px] font-semibold text-n-3">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

/** A compact Select over a list of {value,label} options. Values are strings
 *  on the wire (Radix Select), converted by the caller. */
function ChoiceSelect({
  id,
  ariaLabel,
  value,
  options,
  onValueChange,
  width = 'w-40',
}: {
  id?: string
  ariaLabel?: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onValueChange: (value: string) => void
  width?: string
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="fs-overline border-t border-n-4 pt-2.5 text-[11px] text-n-3">{children}</div>
}

const numOptions = (values: readonly number[], suffix = '') =>
  values.map((v) => ({ value: String(v), label: `${v}${suffix}` }))

// ---------------------------------------------------------------------------
// Step: Format & structure (§7.3.1)
// ---------------------------------------------------------------------------

function FormatStep({
  draft,
  errors,
  nameError,
  onName,
  onSeason,
  onSettings,
}: {
  draft: WizardDraft
  errors: FieldIssue[]
  nameError: boolean
  onName: (name: string) => void
  onSeason: (season: number) => void
  onSettings: (patch: Partial<LeagueSettings>) => void
}) {
  const s = draft.settings
  const errorsFor = (field: string) => errors.filter((e) => e.field === field)
  // §7.3.1 R: playoff_teams ≤ team_count — offer only reachable options so the
  // most common misconfiguration can't be entered at all.
  const playoffTeamOptions = [0, 2, 4, 6, 8, 10, 12].filter((n) => n <= s.team_count)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Format &amp; structure</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5">
        <div className="space-y-1.5">
          <Label htmlFor="league-name" className="text-[13px] font-bold">
            League name
          </Label>
          <Input
            id="league-name"
            value={draft.name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Sunday Legends"
            maxLength={100}
            aria-invalid={nameError}
            required
          />
          {nameError && (
            <p role="alert" className="text-[12px] font-semibold text-negative-strong">
              Give your league a name to continue.
            </p>
          )}
        </div>

        <FieldRow label="Season" htmlFor="league-season">
          <ChoiceSelect
            id="league-season"
            ariaLabel="Season"
            value={String(draft.season)}
            options={numOptions(SEASON_RANGE)}
            onValueChange={(v) => onSeason(Number(v))}
            width="w-28"
          />
        </FieldRow>

        <FieldRow label="Teams" htmlFor="league-teams" hint="Even counts 8–16 (v1).">
          <ChoiceSelect
            id="league-teams"
            ariaLabel="Number of teams"
            value={String(s.team_count)}
            options={numOptions([8, 10, 12, 14, 16])}
            onValueChange={(v) =>
              onSettings({ team_count: Number(v) as LeagueSettings['team_count'] })
            }
            width="w-28"
          />
        </FieldRow>

        <FieldRow label="Divisions" htmlFor="league-divisions">
          <ChoiceSelect
            id="league-divisions"
            ariaLabel="Divisions"
            value={String(s.divisions)}
            options={numOptions([1, 2])}
            onValueChange={(v) => onSettings({ divisions: Number(v) })}
            width="w-28"
          />
        </FieldRow>

        <SectionLabel>Season &amp; playoffs</SectionLabel>

        <FieldRow label="Regular season weeks" htmlFor="league-rsw">
          <ChoiceSelect
            id="league-rsw"
            ariaLabel="Regular season weeks"
            value={String(s.regular_season_weeks)}
            options={numOptions([12, 13, 14, 15])}
            onValueChange={(v) => onSettings({ regular_season_weeks: Number(v) })}
            width="w-28"
          />
        </FieldRow>

        {/* F27 (Q10/v2.8.6): playoff_start_week is READ-ONLY derived =
            regular_season_weeks + 1. Shown, never an input; live-recomputed. */}
        <FieldRow
          label="Playoffs start"
          hint="The week after the regular season ends (derived)."
        >
          <Badge variant="stroke">
            Week&nbsp;<span className="fs-num">{s.playoff_start_week}</span>
          </Badge>
        </FieldRow>

        <FieldRow label="Playoff teams" htmlFor="league-playoff-teams" hint="0 = points-only champion.">
          <ChoiceSelect
            id="league-playoff-teams"
            ariaLabel="Playoff teams"
            value={String(s.playoff_teams)}
            options={numOptions(playoffTeamOptions)}
            onValueChange={(v) =>
              onSettings({ playoff_teams: Number(v) as LeagueSettings['playoff_teams'] })
            }
            width="w-28"
          />
        </FieldRow>

        <FieldRow label="Weeks per playoff round" htmlFor="league-ppr">
          <ChoiceSelect
            id="league-ppr"
            ariaLabel="Weeks per playoff round"
            value={String(s.playoff_weeks_per_round)}
            options={[
              { value: '1', label: '1 week' },
              { value: '2', label: '2 weeks' },
            ]}
            onValueChange={(v) =>
              onSettings({
                playoff_weeks_per_round: Number(v) as LeagueSettings['playoff_weeks_per_round'],
              })
            }
          />
        </FieldRow>

        {errorsFor('playoff_start_week').map((e) => (
          <InlineIssue key={e.message} tone="error" message={e.message} />
        ))}
        {errorsFor('playoff_teams').map((e) => (
          <InlineIssue key={e.message} tone="error" message={e.message} />
        ))}
        {errorsFor('team_count').map((e) => (
          <InlineIssue key={e.message} tone="error" message={e.message} />
        ))}

        <SectionLabel>Scoring format</SectionLabel>

        <FieldRow label="Schedule" htmlFor="league-schedule" hint="Total-points has no matchups.">
          <ChoiceSelect
            id="league-schedule"
            ariaLabel="Schedule mode"
            value={s.schedule_mode}
            options={[
              { value: 'h2h', label: 'Head-to-head' },
              { value: 'total_points', label: 'Total points' },
            ]}
            onValueChange={(v) =>
              onSettings({ schedule_mode: v as LeagueSettings['schedule_mode'] })
            }
          />
        </FieldRow>

        <ToggleRow
          id="toggle-median"
          label="Median game"
          hint="Extra weekly game vs the league median."
          checked={s.median_game}
          onCheckedChange={(median_game) => onSettings({ median_game })}
        />
        <ToggleRow
          id="toggle-second-opponent"
          label="Second opponent"
          hint="A second H2H matchup each week."
          checked={s.second_opponent}
          onCheckedChange={(second_opponent) => onSettings({ second_opponent })}
        />
        <ToggleRow
          id="toggle-reseed"
          label="Reseed playoffs"
          hint="Re-rank by seed each round."
          checked={s.playoff_reseed}
          onCheckedChange={(playoff_reseed) => onSettings({ playoff_reseed })}
        />
        <ToggleRow
          id="toggle-consolation"
          label="Consolation bracket"
          hint="Toilet bowl for non-playoff teams."
          checked={s.consolation_bracket}
          onCheckedChange={(consolation_bracket) => onSettings({ consolation_bracket })}
        />
        <ToggleRow
          id="toggle-third-place"
          label="Third-place game"
          checked={s.third_place_game}
          onCheckedChange={(third_place_game) => onSettings({ third_place_game })}
        />
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step: Waivers & trades (§7.3.4 / §7.3.5)
// ---------------------------------------------------------------------------

function WaiversStep({
  draft,
  errors,
  onSettings,
}: {
  draft: WizardDraft
  errors: FieldIssue[]
  onSettings: (patch: Partial<LeagueSettings>) => void
}) {
  const s = draft.settings
  const errorsFor = (field: string) => errors.filter((e) => e.field === field)
  const deadlineOptions = [
    { value: 'none', label: 'No deadline' },
    ...Array.from({ length: s.regular_season_weeks }, (_, i) => ({
      value: String(i + 1),
      label: `Week ${i + 1}`,
    })),
  ]

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Waivers &amp; free agency</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3.5">
          <FieldRow label="Waiver type" htmlFor="waiver-type">
            <ChoiceSelect
              id="waiver-type"
              ariaLabel="Waiver type"
              value={s.waiver_type}
              options={[
                { value: 'faab', label: 'FAAB (blind bid)' },
                { value: 'rolling_priority', label: 'Rolling priority' },
                { value: 'reverse_standings', label: 'Reverse standings' },
                { value: 'none_fcfs', label: 'None (first come)' },
              ]}
              width="w-48"
              onValueChange={(v) =>
                onSettings({ waiver_type: v as LeagueSettings['waiver_type'] })
              }
            />
          </FieldRow>

          {s.waiver_type === 'faab' && (
            <FieldRow label="FAAB budget" htmlFor="faab-budget" hint="Season-long blind-bid pool.">
              <Input
                id="faab-budget"
                type="number"
                min={0}
                max={1000}
                value={s.faab_budget}
                onChange={(e) =>
                  onSettings({ faab_budget: clampInt(e.target.value, 0, 1000, s.faab_budget) })
                }
                className="h-btn-md w-24 text-[12px]"
              />
            </FieldRow>
          )}

          <FieldRow label="Process day" htmlFor="waiver-day">
            <ChoiceSelect
              id="waiver-day"
              ariaLabel="Waiver process day"
              value={s.waiver_process_day}
              options={[
                { value: 'tue', label: 'Tuesday' },
                { value: 'wed', label: 'Wednesday' },
                { value: 'thu', label: 'Thursday' },
              ]}
              onValueChange={(v) =>
                onSettings({ waiver_process_day: v as LeagueSettings['waiver_process_day'] })
              }
            />
          </FieldRow>

          <FieldRow label="Free agency" htmlFor="free-agency">
            <ChoiceSelect
              id="free-agency"
              ariaLabel="Free agency"
              value={s.free_agency}
              options={[
                { value: 'immediate_after_waivers', label: 'After waivers' },
                { value: 'continuous', label: 'Continuous' },
              ]}
              onValueChange={(v) =>
                onSettings({ free_agency: v as LeagueSettings['free_agency'] })
              }
            />
          </FieldRow>

          <ToggleRow
            id="toggle-player-lock"
            label="Lock players at kickoff"
            hint="Unowned players lock for adds when their game starts."
            checked={s.player_game_lock}
            onCheckedChange={(player_game_lock) => onSettings({ player_game_lock })}
          />
          <ToggleRow
            id="toggle-bench-lock"
            label="Bench lock"
            hint="A claim whose drop already played fails at processing."
            checked={s.bench_lock}
            onCheckedChange={(bench_lock) => onSettings({ bench_lock })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trades</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3.5">
          <FieldRow label="Trade review" htmlFor="trade-review">
            <ChoiceSelect
              id="trade-review"
              ariaLabel="Trade review"
              value={s.trade_review}
              options={[
                { value: 'none', label: 'None (instant)' },
                { value: 'commissioner', label: 'Commissioner' },
                { value: 'league_vote', label: 'League vote' },
              ]}
              onValueChange={(v) =>
                onSettings({ trade_review: v as LeagueSettings['trade_review'] })
              }
            />
          </FieldRow>

          {s.trade_review === 'league_vote' && (
            <FieldRow label="Veto votes" htmlFor="veto-votes" hint={`1–${s.team_count} to veto a trade.`}>
              <Input
                id="veto-votes"
                type="number"
                min={1}
                max={s.team_count}
                value={s.trade_veto_votes}
                onChange={(e) =>
                  onSettings({
                    trade_veto_votes: clampInt(e.target.value, 1, 16, s.trade_veto_votes),
                  })
                }
                className="h-btn-md w-24 text-[12px]"
              />
            </FieldRow>
          )}

          <FieldRow label="Trade deadline" htmlFor="trade-deadline">
            <ChoiceSelect
              id="trade-deadline"
              ariaLabel="Trade deadline"
              value={s.trade_deadline_week === null ? 'none' : String(s.trade_deadline_week)}
              options={deadlineOptions}
              onValueChange={(v) =>
                onSettings({ trade_deadline_week: v === 'none' ? null : Number(v) })
              }
            />
          </FieldRow>

          <ToggleRow
            id="toggle-faab-trades"
            label="Allow FAAB in trades"
            checked={s.allow_faab_in_trades}
            onCheckedChange={(allow_faab_in_trades) => onSettings({ allow_faab_in_trades })}
          />

          {errorsFor('trade_veto_votes').map((e) => (
            <InlineIssue key={e.message} tone="error" message={e.message} />
          ))}
          {errorsFor('trade_deadline_week').map((e) => (
            <InlineIssue key={e.message} tone="error" message={e.message} />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step: Draft configuration (§7.3.8)
// ---------------------------------------------------------------------------

const PICK_TIMER_LABELS: Record<number, string> = {
  0: 'No clock (untimed)',
  30: '30 seconds',
  45: '45 seconds',
  60: '1 minute',
  90: '90 seconds',
  120: '2 minutes',
  180: '3 minutes',
  300: '5 minutes',
  600: '10 minutes',
  3600: '1 hour',
  14400: '4 hours',
  28800: '8 hours',
  86400: '24 hours',
}

function DraftStep({
  draft,
  errors,
  onDraft,
}: {
  draft: WizardDraft
  errors: FieldIssue[]
  onDraft: (patch: Partial<LeagueSettings['draft']>) => void
}) {
  const d = draft.settings.draft
  const errorsFor = (field: string) => errors.filter((e) => e.field === field)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Draft</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5">
        <FieldRow label="Draft type" htmlFor="draft-type">
          <ChoiceSelect
            id="draft-type"
            ariaLabel="Draft type"
            value={d.draft_type}
            options={[
              { value: 'snake', label: 'Snake' },
              { value: 'auction', label: 'Auction' },
              { value: 'linear', label: 'Linear' },
            ]}
            onValueChange={(v) =>
              onDraft({ draft_type: v as LeagueSettings['draft']['draft_type'] })
            }
          />
        </FieldRow>

        {d.draft_type === 'snake' && (
          <ToggleRow
            id="toggle-snake-reversal"
            label="Third-round reversal"
            hint="Sleeper-style — the 3rd round doesn't flip."
            checked={d.snake_reversal}
            onCheckedChange={(snake_reversal) => onDraft({ snake_reversal })}
          />
        )}

        <FieldRow label="Pick clock" htmlFor="pick-timer">
          <ChoiceSelect
            id="pick-timer"
            ariaLabel="Pick clock"
            value={String(d.pick_timer_seconds)}
            options={PICK_TIMER_SECONDS.map((v) => ({
              value: String(v),
              label: PICK_TIMER_LABELS[v] ?? `${v}s`,
            }))}
            width="w-48"
            onValueChange={(v) =>
              onDraft({
                pick_timer_seconds: Number(v) as LeagueSettings['draft']['pick_timer_seconds'],
              })
            }
          />
        </FieldRow>

        {d.draft_type === 'auction' && (
          <FieldRow label="Auction budget" htmlFor="auction-budget" hint="One-time draft budget.">
            <Input
              id="auction-budget"
              type="number"
              min={50}
              max={1000}
              value={d.auction_budget}
              onChange={(e) =>
                onDraft({ auction_budget: clampInt(e.target.value, 50, 1000, d.auction_budget) })
              }
              className="h-btn-md w-24 text-[12px]"
            />
          </FieldRow>
        )}

        <FieldRow label="Draft order" htmlFor="draft-order-mode" hint="Set the order before the room opens.">
          <ChoiceSelect
            id="draft-order-mode"
            ariaLabel="Draft order mode"
            value={d.draft_order_mode}
            options={[
              { value: 'random', label: 'Random' },
              { value: 'manual', label: 'Commissioner sets' },
              { value: 'custom', label: 'Saved order' },
            ]}
            width="w-44"
            onValueChange={(v) =>
              onDraft({ draft_order_mode: v as LeagueSettings['draft']['draft_order_mode'] })
            }
          />
        </FieldRow>

        {errorsFor('draft.auction_budget').map((e) => (
          <InlineIssue key={e.message} tone="error" message={e.message} />
        ))}

        <p className="text-[11px] font-semibold text-n-3">
          You&apos;ll schedule the draft date and reveal the order from the league home once
          managers have joined.
        </p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step: Invite / review + create
// ---------------------------------------------------------------------------

function InviteStep({
  draft,
  profileName,
  canSubmit,
  showErrors,
  onTeamName,
}: {
  draft: WizardDraft
  profileName: string | null
  canSubmit: boolean
  showErrors: boolean
  onTeamName: (name: string) => void
}) {
  const s = draft.settings
  const rosterStarters = s.roster_settings.starting_slots.reduce((n, slot) => n + slot.count, 0)
  const teamPlaceholder = profileName ? `${profileName}'s Team` : 'Your team'

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Your team</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <Label htmlFor="team-name" className="text-[13px] font-bold">
            Team name
          </Label>
          <Input
            id="team-name"
            value={draft.teamName}
            onChange={(e) => onTeamName(e.target.value)}
            placeholder={teamPlaceholder}
            maxLength={60}
          />
          <p className="text-[11px] font-semibold text-n-3">
            You&apos;re the commissioner — this is your own team in the league. Leave it blank to
            use “{teamPlaceholder}”.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review</CardTitle>
          <Badge variant="stroke">{draft.season} season</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <SummaryRow label="League" value={draft.name.trim() || '— name it on the Format step —'} />
          <SummaryRow label="Teams" value={`${s.team_count} · ${s.divisions} division${s.divisions > 1 ? 's' : ''}`} />
          <SummaryRow
            label="Season"
            value={`${s.regular_season_weeks} weeks · ${s.playoff_teams === 0 ? 'points-only champion' : `${s.playoff_teams} in playoffs from Week ${s.playoff_start_week}`}`}
          />
          <SummaryRow label="Roster" value={`${rosterStarters} starters · ${s.roster_settings.bench} bench · ${s.roster_settings.ir_slots.length} IR`} />
          <SummaryRow label="Scoring" value={draft.scoringSystemId ? 'Template selected' : 'Not chosen'} />
          <SummaryRow
            label="Draft"
            value={`${capitalize(s.draft.draft_type)}${s.draft.pick_timer_seconds === 0 ? ' · untimed' : ''}`}
          />
        </CardContent>
      </Card>

      {showErrors && !canSubmit && (
        <InlineIssue
          tone="error"
          message="A couple of things still need attention — step back and check for the highlighted fields (a league name and a scoring template are required)."
        />
      )}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5 border-b border-n-4 py-1.5 text-[12px] font-bold last:border-0">
      <span className="whitespace-nowrap text-n-3">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Success panel (post-create): the copyable share link + go-to-league
// ---------------------------------------------------------------------------

function SuccessPanel({
  leagueName,
  result,
  onGo,
}: {
  leagueName: string
  result: CreateLeagueResult
  onGo: () => void
}) {
  const shareLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/join/${result.invite_code}`
      : `/join/${result.invite_code}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink)
      toast({ title: 'Invite link copied', description: 'Share it with your league mates.' })
    } catch {
      toast({ title: 'Copy the link manually', description: shareLink })
    }
  }

  return (
    <Card className="mt-4">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2.5">
          <span className="text-brand-strong">
            <Icon name="check-circle" size={22} />
          </span>
          <div>
            <p className="text-[15px] font-extrabold">{leagueName} is live</p>
            <p className="text-[12px] font-semibold text-n-3">
              Invite your managers, then schedule the draft.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-link" className="text-[13px] font-bold">
            League invite link
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="invite-link"
              readOnly
              value={shareLink}
              onFocus={(e) => e.currentTarget.select()}
              className="text-[12px]"
            />
            <Button type="button" variant="stroke" size="sm" onClick={copy}>
              <Icon name="document" size={13} />
              Copy
            </Button>
          </div>
          <p className="text-[11px] font-semibold text-n-3">
            Anyone with this link can claim an open seat — paste it into any chat or email.
          </p>
        </div>

        <div>
          <Button type="button" variant="blue" size="sm" shadow onClick={onGo}>
            Go to your league
            <Icon name="arrow-next" size={13} />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Parse a number input, clamp to [min,max], falling back to `fallback` for
 *  empty/NaN so the control never emits an out-of-range or NaN value. */
function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
