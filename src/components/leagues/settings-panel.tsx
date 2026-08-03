'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/hooks/use-toast'
import {
  LeaguePatchError,
  useLeague,
  useLeagueProfile,
  useUpdateLeagueSettings,
  type LeagueDetail,
  type UpdateLeagueSettingsBody,
} from '@/hooks/use-league'
import {
  PLAYOFF_TEAMS_OPTIONS,
  reconcileDerived,
} from '@/lib/leagues/settings/derived-settings'
import {
  validateLeagueSettings,
  type FieldIssue,
  type LeagueSettings,
  type RosterSettings,
  type Tiebreaker,
} from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'

import { Crest } from './league-cells'
import { RosterSlotBuilder } from './roster-slot-builder'
import { ScoringTemplatePicker } from './scoring-template-picker'
import {
  ChoiceSelect,
  clampInt,
  FieldRow,
  InlineIssue,
  numOptions,
  SectionLabel,
  ToggleRow,
} from './settings-form-controls'

/**
 * League settings panel (M1 task L.A2.4; spec §16.2 settings-panel, §7.3
 * settings catalog, §7.1 edit-lock by status, §17 permissions, §16.5.4 states).
 *
 * The exhaustive grouped-forms surface over the FULL §7.3 catalog — the
 * counterpart to the create wizard (L.A2.1), which surfaces only the primary
 * decision per step. Both write the SAME `leagueSettingsSchema` contract via
 * the same L.A1.13 PATCH path (`update_league_settings`), and both reconcile
 * their working draft through the shared `derived-settings` module, so F27's
 * read-only `playoff_start_week` and R108's dependent re-clamps behave
 * identically here.
 *
 * Composition, never forks (CLAUDE.md): the roster group embeds the REAL
 * `RosterSlotBuilder` (L.A2.2); the scoring group embeds the REAL
 * `ScoringTemplatePicker` (L.A2.3). No mock data.
 *
 * Access (§17): editing is commissioner / co-commissioner only — a manager
 * sees the same grouped forms READ-ONLY. §7.1 edit-lock: all settings edit in
 * `setup`/`scheduled`; once past `scheduled` the structural surface locks and
 * the panel shows the lock state (M1 renders the 409 the L.A1.13 route already
 * returns; the mid-season override path is M6).
 *
 * Save is one atomic PATCH of the FULL reconciled settings (+ the scoring
 * template only when it changed). A whole-object save is deliberate: R108's
 * re-clamps span groups (shrinking `team_count` in Format clamps
 * `trade_deadline_week` in Trades), so persisting the reconciled WHOLE keeps
 * the result internally consistent — a full object merges to itself (D71), so
 * this is exactly the sanctioned round-trip the L.A1.13 suite drives.
 *
 * States (§16.5.4): skeleton on load, error-with-retry, per-field validation
 * (the contract's messages verbatim), save-pending, and the read-only / lock
 * banners above.
 */
export function SettingsPanel({ leagueId }: { leagueId: string }) {
  const { data, isPending, isError, refetch } = useLeague(leagueId)

  if (isPending) return <SettingsPanelSkeleton />

  if (isError || !data) {
    return (
      <PanelShell>
        <Card className="border-negative bg-negative-soft">
          <CardContent className="flex flex-col items-start gap-2 p-4">
            <p className="text-[13px] font-bold" role="alert">
              Couldn&apos;t load this league&apos;s settings.
            </p>
            <p className="text-[12px] font-semibold text-n-3">
              Check your connection and try again — nothing was changed.
            </p>
            <Button type="button" variant="stroke" size="sm" onClick={() => refetch()}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </CardContent>
        </Card>
      </PanelShell>
    )
  }

  const isCommish = data.my_role === 'commissioner' || data.my_role === 'co_commissioner'
  const status = data.league.status
  // §7.1: everything edits in setup/scheduled; past that the structural surface
  // is override-only (M6) — M1 renders the lock, not the override.
  const pastScheduled = status !== 'setup' && status !== 'scheduled'
  const canEdit = isCommish && !pastScheduled

  // Re-seed the form from the persisted baseline whenever it changes — a
  // successful save invalidates the detail query, the refetched settings
  // become the new key, and the form remounts clean (the round-trip reset).
  const baselineKey = JSON.stringify({
    s: data.settings,
    sid: data.league.scoring_system_id,
    st: status,
  })

  return (
    <PanelShell>
      {!isCommish && (
        <InlineIssue
          tone="warning"
          message="You're viewing these settings — only the commissioner can change them."
        />
      )}
      {isCommish && pastScheduled && (
        <InlineIssue
          tone="warning"
          message="Settings are locked once the draft starts. Changing them mid-season is a commissioner override — that arrives with the in-season tools."
        />
      )}
      {/* League name + crest — cosmetic, commissioner-editable in EVERY
          status (unlike the §7.1 structural lock below). */}
      <LeagueProfileCard
        key={data.league.name}
        leagueId={leagueId}
        detail={data}
        canEdit={isCommish}
      />
      <SettingsForm
        key={baselineKey}
        leagueId={leagueId}
        detail={data}
        canEdit={canEdit}
      />
    </PanelShell>
  )
}

// ---------------------------------------------------------------------------
// League profile — rename + avatar (migration 064; top of the page)
// ---------------------------------------------------------------------------

function LeagueProfileCard({
  leagueId,
  detail,
  canEdit,
}: {
  leagueId: string
  detail: LeagueDetail
  canEdit: boolean
}) {
  const { league } = detail
  const { rename, uploadAvatar, removeAvatar } = useLeagueProfile(leagueId)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState(league.name)

  const trimmed = name.trim()
  const nameDirty = trimmed !== league.name
  const nameValid = trimmed.length >= 1 && trimmed.length <= 100

  async function handleRename() {
    if (!nameDirty || !nameValid || rename.isPending) return
    try {
      await rename.mutateAsync(trimmed)
      toast({ title: 'League renamed', description: `Now playing as “${trimmed}”.` })
    } catch (cause) {
      toast({
        title: "Couldn't rename the league",
        description: cause instanceof Error ? cause.message : 'Please try again.',
      })
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      await uploadAvatar.mutateAsync(file)
      toast({ title: 'League avatar updated' })
    } catch (cause) {
      toast({
        title: "Couldn't upload the image",
        description: cause instanceof Error ? cause.message : 'Please try again.',
      })
    }
  }

  async function handleRemove() {
    if (removeAvatar.isPending) return
    try {
      await removeAvatar.mutateAsync()
      toast({ title: 'Avatar removed — showing initials' })
    } catch (cause) {
      toast({
        title: "Couldn't remove the avatar",
        description: cause instanceof Error ? cause.message : 'Please try again.',
      })
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3.5">
        <div className="flex items-center gap-4">
          <Crest
            name={league.name}
            src={league.avatar_url}
            className="h-16 w-16"
            fallbackClassName="text-[16px]"
          />
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="stroke"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploadAvatar.isPending}
              >
                <Icon name="repeat" size={13} />
                {uploadAvatar.isPending ? 'Uploading…' : 'Change image'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRemove}
                disabled={removeAvatar.isPending || !league.avatar_url}
              >
                {removeAvatar.isPending ? 'Removing…' : 'Remove'}
              </Button>
            </div>
          ) : (
            <p className="text-[12px] font-semibold text-n-3">
              Only the commissioner can change the league name and avatar.
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={handleFile}
          />
        </div>

        {canEdit && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="league-name" className="text-[12px] font-bold">
              League name
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="league-name"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRename()
                }}
                className="h-btn-md max-w-sm text-[12px]"
              />
              <Button
                type="button"
                variant="blue"
                size="sm"
                shadow
                disabled={!nameDirty || !nameValid || rename.isPending}
                onClick={handleRename}
              >
                {rename.isPending ? 'Saving…' : 'Save name'}
              </Button>
            </div>
            {!nameValid && (
              <InlineIssue tone="error" message="League name must be between 1 and 100 characters." />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PanelShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title="League settings" />
      <div>
        <Button variant="stroke" size="sm" onClick={() => router.back()}>
          <Icon name="arrow-prev" size={13} />
          Back
        </Button>
      </div>
      {children}
    </div>
  )
}

function SettingsPanelSkeleton() {
  return (
    <PanelShell>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-48 rounded-sm" />
      ))}
    </PanelShell>
  )
}

// ---------------------------------------------------------------------------
// The editable form (seeded from the persisted baseline, remounted on save)
// ---------------------------------------------------------------------------

function SettingsForm({
  leagueId,
  detail,
  canEdit,
}: {
  leagueId: string
  detail: LeagueDetail
  canEdit: boolean
}) {
  const initialSettings = detail.settings
  const initialScoringId = detail.league.scoring_system_id

  const [working, setWorking] = useState<LeagueSettings>(() => structuredClone(initialSettings))
  const [scoringId, setScoringId] = useState<string | null>(initialScoringId)
  const [serverError, setServerError] = useState<LeaguePatchError | null>(null)

  const { mutateAsync, isPending } = useUpdateLeagueSettings(leagueId)

  const validation = useMemo(() => validateLeagueSettings(working), [working])
  const dirty =
    JSON.stringify(working) !== JSON.stringify(initialSettings) || scoringId !== initialScoringId

  // Every settings edit reconciles through the shared module (F27 read-only
  // playoff_start_week + R108 dependent re-clamps).
  const updateSettings = (patch: Partial<LeagueSettings>) =>
    setWorking((prev) => reconcileDerived(prev, { ...prev, ...patch }))
  const setRoster = (roster_settings: RosterSettings) => updateSettings({ roster_settings })
  const setDraftConfig = (patch: Partial<LeagueSettings['draft']>) =>
    setWorking((prev) => reconcileDerived(prev, { ...prev, draft: { ...prev.draft, ...patch } }))

  const errorsFor = (field: string) => validation.errors.filter((e) => e.field === field)

  const canSubmit = canEdit && dirty && validation.valid && !isPending

  async function handleSave() {
    if (!canSubmit) return
    setServerError(null)
    const body: UpdateLeagueSettingsBody = { settings: working }
    if (scoringId !== null && scoringId !== initialScoringId) {
      body.scoring_system_id = scoringId
    }
    try {
      await mutateAsync(body)
      toast({ title: 'Settings saved', description: 'Your league settings are up to date.' })
      // The detail query invalidates → SettingsPanel remounts this form on the
      // fresh baseline, so `working` and `dirty` reset to the persisted state.
    } catch (cause) {
      if (cause instanceof LeaguePatchError) {
        setServerError(cause)
        if (cause.status === 403 || cause.status === 409) {
          toast({ title: "Couldn't save", description: cause.message })
        }
      } else {
        toast({
          title: "Couldn't save the settings",
          description: cause instanceof Error ? cause.message : 'Please try again.',
        })
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Save lives at the TOP of the page (sticky) — one atomic PATCH still
          covers everything below it, Draft setup included. */}
      {canEdit && (
        <div className="sticky top-3 z-10 flex items-center gap-2.5 rounded-sm border border-ink bg-page px-3 py-2.5 shadow-hard-4">
          <span className="text-[12px] font-bold text-n-3">
            {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
          </span>
          {!validation.valid && dirty && (
            <Badge variant="stroke" className="text-negative-strong">
              {validation.errors.length} to fix
            </Badge>
          )}
          <Button
            type="button"
            variant="blue"
            size="sm"
            shadow
            className="ml-auto"
            disabled={!canSubmit}
            onClick={handleSave}
          >
            {isPending ? (
              <>
                <Icon name="repeat" size={13} className="animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Icon name="check" size={13} />
                Save changes
              </>
            )}
          </Button>
        </div>
      )}

      {serverError && (serverError.status === 403 || serverError.status === 409) && (
        <InlineIssue tone="error" message={serverError.message} />
      )}

      {/* `disabled` on the fieldset makes every native control (inputs, the
          Radix Select/Switch triggers — all buttons) read-only in one place;
          the div-based scoring cards get an extra pointer-events guard. */}
      <fieldset
        disabled={!canEdit}
        className={cn('m-0 flex min-w-0 flex-col gap-4 border-0 p-0', !canEdit && 'opacity-95')}
      >
        <PageSectionHeading>Draft setup</PageSectionHeading>

        <ScheduleDraftGroup
          value={working.draft.draft_scheduled_at}
          year={detail.league.season}
          onChange={(draft_scheduled_at) => setDraftConfig({ draft_scheduled_at })}
        />
        <DraftGroup s={working} onDraft={setDraftConfig} errorsFor={errorsFor} />

        <PageSectionHeading>League settings</PageSectionHeading>

        <FormatGroup s={working} onSettings={updateSettings} errorsFor={errorsFor} />

        <GroupCard title="Roster & lineup slots">
          <RosterSlotBuilder
            value={working.roster_settings}
            onChange={setRoster}
            teamCount={working.team_count}
          />
        </GroupCard>

        <GroupCard title="Scoring">
          <div className={cn(!canEdit && 'pointer-events-none opacity-95')}>
            <ScoringTemplatePicker value={scoringId} onChange={setScoringId} />
          </div>
          {errorsFor('scoring_system_id').map((e) => (
            <InlineIssue key={e.message} tone="error" message={e.message} />
          ))}
        </GroupCard>

        <WaiversGroup s={working} onSettings={updateSettings} />
        <TradesGroup s={working} onSettings={updateSettings} errorsFor={errorsFor} />
        <LineupsGroup s={working} onSettings={updateSettings} />
        <TiebreakersGroup s={working} onSettings={updateSettings} />
      </fieldset>
    </div>
  )
}

/** Page-level band between card groups ("Draft setup" / "League settings"). */
function PageSectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-1.5 text-h6 text-ink">{children}</h2>
}

// ---------------------------------------------------------------------------
// Group shell
// ---------------------------------------------------------------------------

/**
 * Collapsed by default so the panel first reads as a list of section names;
 * each section expands independently. Native <details>/<summary> deliberately:
 * a summary is not a form control, so the read-only `<fieldset disabled>`
 * around the form never blocks a non-commissioner from expanding a section
 * to view it. Content stays mounted while closed, so form state is unaffected.
 */
function GroupCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <details className="group">
        <summary className="flex min-h-header cursor-pointer list-none items-center justify-between gap-2 px-card-pad py-2.5 [&::-webkit-details-marker]:hidden">
          <CardTitle>{title}</CardTitle>
          <Icon
            name="arrow-bottom"
            size={14}
            className="shrink-0 -rotate-90 transition-transform group-open:rotate-0"
          />
        </summary>
        <CardContent className="flex flex-col gap-3.5 border-t border-ink">
          {children}
        </CardContent>
      </details>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// §7.3.1 — Format & structure
// ---------------------------------------------------------------------------

function FormatGroup({
  s,
  onSettings,
  errorsFor,
}: {
  s: LeagueSettings
  onSettings: (patch: Partial<LeagueSettings>) => void
  errorsFor: (field: string) => FieldIssue[]
}) {
  const playoffTeamOptions = PLAYOFF_TEAMS_OPTIONS.filter((n) => n <= s.team_count)

  return (
    <GroupCard title="Basic settings">
      <FieldRow label="Teams" htmlFor="set-teams" hint="Even counts 8–16 (v1).">
        <ChoiceSelect
          id="set-teams"
          ariaLabel="Number of teams"
          value={String(s.team_count)}
          options={numOptions([8, 10, 12, 14, 16])}
          onValueChange={(v) => onSettings({ team_count: Number(v) as LeagueSettings['team_count'] })}
          width="w-28"
        />
      </FieldRow>

      <FieldRow label="Divisions" htmlFor="set-divisions">
        <ChoiceSelect
          id="set-divisions"
          ariaLabel="Divisions"
          value={String(s.divisions)}
          options={numOptions([1, 2])}
          onValueChange={(v) => onSettings({ divisions: Number(v) })}
          width="w-28"
        />
      </FieldRow>

      <SectionLabel>Season &amp; playoffs</SectionLabel>

      <FieldRow label="Regular season weeks" htmlFor="set-rsw">
        <ChoiceSelect
          id="set-rsw"
          ariaLabel="Regular season weeks"
          value={String(s.regular_season_weeks)}
          options={numOptions([12, 13, 14, 15])}
          onValueChange={(v) => onSettings({ regular_season_weeks: Number(v) })}
          width="w-28"
        />
      </FieldRow>

      {/* F27 (Q10/v2.8.6): playoff_start_week is READ-ONLY derived =
          regular_season_weeks + 1 — rendered exactly as the wizard does. */}
      <FieldRow label="Playoffs start" hint="The week after the regular season ends (derived).">
        <Badge variant="stroke">
          Week&nbsp;<span className="fs-num">{s.playoff_start_week}</span>
        </Badge>
      </FieldRow>

      <FieldRow label="Playoff teams" htmlFor="set-playoff-teams" hint="0 = points-only champion.">
        <ChoiceSelect
          id="set-playoff-teams"
          ariaLabel="Playoff teams"
          value={String(s.playoff_teams)}
          options={numOptions(playoffTeamOptions)}
          onValueChange={(v) => onSettings({ playoff_teams: Number(v) as LeagueSettings['playoff_teams'] })}
          width="w-28"
        />
      </FieldRow>

      <FieldRow label="Weeks per playoff round" htmlFor="set-ppr">
        <ChoiceSelect
          id="set-ppr"
          ariaLabel="Weeks per playoff round"
          value={String(s.playoff_weeks_per_round)}
          options={[
            { value: '1', label: '1 week' },
            { value: '2', label: '2 weeks' },
          ]}
          onValueChange={(v) =>
            onSettings({ playoff_weeks_per_round: Number(v) as LeagueSettings['playoff_weeks_per_round'] })
          }
        />
      </FieldRow>

      {['playoff_start_week', 'playoff_teams', 'team_count'].flatMap((field) =>
        errorsFor(field).map((e) => <InlineIssue key={e.message} tone="error" message={e.message} />),
      )}

      <SectionLabel>Scoring format</SectionLabel>

      <FieldRow label="Schedule" htmlFor="set-schedule" hint="Total-points has no matchups.">
        <ChoiceSelect
          id="set-schedule"
          ariaLabel="Schedule mode"
          value={s.schedule_mode}
          options={[
            { value: 'h2h', label: 'Head-to-head' },
            { value: 'total_points', label: 'Total points' },
          ]}
          onValueChange={(v) => onSettings({ schedule_mode: v as LeagueSettings['schedule_mode'] })}
        />
      </FieldRow>

      <ToggleRow
        id="set-median"
        label="Median game"
        hint="Extra weekly game vs the league median."
        checked={s.median_game}
        onCheckedChange={(median_game) => onSettings({ median_game })}
      />
      <ToggleRow
        id="set-second-opponent"
        label="Second opponent"
        hint="A second H2H matchup each week."
        checked={s.second_opponent}
        onCheckedChange={(second_opponent) => onSettings({ second_opponent })}
      />
      <ToggleRow
        id="set-reseed"
        label="Reseed playoffs"
        hint="Re-rank by seed each round."
        checked={s.playoff_reseed}
        onCheckedChange={(playoff_reseed) => onSettings({ playoff_reseed })}
      />
      <ToggleRow
        id="set-consolation"
        label="Consolation bracket"
        hint="Toilet bowl for non-playoff teams."
        checked={s.consolation_bracket}
        onCheckedChange={(consolation_bracket) => onSettings({ consolation_bracket })}
      />
      <ToggleRow
        id="set-third-place"
        label="Third-place game"
        checked={s.third_place_game}
        onCheckedChange={(third_place_game) => onSettings({ third_place_game })}
      />
    </GroupCard>
  )
}

// ---------------------------------------------------------------------------
// §7.3.4 — Waivers & free agency
// ---------------------------------------------------------------------------

function WaiversGroup({
  s,
  onSettings,
}: {
  s: LeagueSettings
  onSettings: (patch: Partial<LeagueSettings>) => void
}) {
  return (
    <GroupCard title="Waivers & free agency">
      <FieldRow label="Waiver type" htmlFor="set-waiver-type">
        <ChoiceSelect
          id="set-waiver-type"
          ariaLabel="Waiver type"
          value={s.waiver_type}
          width="w-48"
          options={[
            { value: 'faab', label: 'FAAB (blind bid)' },
            { value: 'rolling_priority', label: 'Rolling priority' },
            { value: 'reverse_standings', label: 'Reverse standings' },
            { value: 'none_fcfs', label: 'None (first come)' },
          ]}
          onValueChange={(v) => onSettings({ waiver_type: v as LeagueSettings['waiver_type'] })}
        />
      </FieldRow>

      {s.waiver_type === 'faab' && (
        <>
          <FieldRow label="FAAB budget" htmlFor="set-faab-budget" hint="Season-long blind-bid pool.">
            <Input
              id="set-faab-budget"
              type="number"
              min={0}
              max={1000}
              value={s.faab_budget}
              onChange={(e) => onSettings({ faab_budget: clampInt(e.target.value, 0, 1000, s.faab_budget) })}
              className="h-btn-md w-24 text-[12px]"
            />
          </FieldRow>
          <FieldRow label="Minimum bid" htmlFor="set-faab-min">
            <Input
              id="set-faab-min"
              type="number"
              min={0}
              max={10}
              value={s.faab_min_bid}
              onChange={(e) => onSettings({ faab_min_bid: clampInt(e.target.value, 0, 10, s.faab_min_bid) })}
              className="h-btn-md w-24 text-[12px]"
            />
          </FieldRow>
          <FieldRow label="Bid tiebreaker" htmlFor="set-faab-tb">
            <ChoiceSelect
              id="set-faab-tb"
              ariaLabel="FAAB tiebreaker"
              value={s.faab_tiebreaker}
              width="w-48"
              options={[
                { value: 'reverse_standings', label: 'Reverse standings' },
                { value: 'rolling_priority', label: 'Rolling priority' },
              ]}
              onValueChange={(v) => onSettings({ faab_tiebreaker: v as LeagueSettings['faab_tiebreaker'] })}
            />
          </FieldRow>
        </>
      )}

      <FieldRow label="Process day" htmlFor="set-waiver-day">
        <ChoiceSelect
          id="set-waiver-day"
          ariaLabel="Waiver process day"
          value={s.waiver_process_day}
          options={[
            { value: 'tue', label: 'Tuesday' },
            { value: 'wed', label: 'Wednesday' },
            { value: 'thu', label: 'Thursday' },
          ]}
          onValueChange={(v) => onSettings({ waiver_process_day: v as LeagueSettings['waiver_process_day'] })}
        />
      </FieldRow>

      <FieldRow label="Process time" htmlFor="set-waiver-time" hint="24-hour ET.">
        <Input
          id="set-waiver-time"
          type="time"
          value={s.waiver_process_time}
          onChange={(e) => onSettings({ waiver_process_time: e.target.value })}
          className="h-btn-md w-28 text-[12px]"
        />
      </FieldRow>

      <FieldRow label="Waiver period" htmlFor="set-waiver-hours" hint="Hours a dropped player sits.">
        <Input
          id="set-waiver-hours"
          type="number"
          min={0}
          max={168}
          value={s.waiver_period_hours}
          onChange={(e) => onSettings({ waiver_period_hours: clampInt(e.target.value, 0, 168, s.waiver_period_hours) })}
          className="h-btn-md w-24 text-[12px]"
        />
      </FieldRow>

      <FieldRow label="Free agency" htmlFor="set-free-agency">
        <ChoiceSelect
          id="set-free-agency"
          ariaLabel="Free agency"
          value={s.free_agency}
          options={[
            { value: 'immediate_after_waivers', label: 'After waivers' },
            { value: 'continuous', label: 'Continuous' },
          ]}
          onValueChange={(v) => onSettings({ free_agency: v as LeagueSettings['free_agency'] })}
        />
      </FieldRow>

      <UnlimitedOrNumber
        id="set-acq-week"
        label="Acquisitions per week"
        max={50}
        value={s.acquisitions_per_week}
        onChange={(acquisitions_per_week) => onSettings({ acquisitions_per_week })}
      />
      <UnlimitedOrNumber
        id="set-acq-season"
        label="Acquisitions per season"
        max={500}
        value={s.acquisitions_per_season}
        onChange={(acquisitions_per_season) => onSettings({ acquisitions_per_season })}
      />

      <FieldRow label="FA hold" htmlFor="set-fa-hold" hint="Hours before a new add is droppable.">
        <Input
          id="set-fa-hold"
          type="number"
          min={0}
          max={48}
          value={s.fa_hold_hours}
          onChange={(e) => onSettings({ fa_hold_hours: clampInt(e.target.value, 0, 48, s.fa_hold_hours) })}
          className="h-btn-md w-24 text-[12px]"
        />
      </FieldRow>

      <ToggleRow
        id="set-player-lock"
        label="Lock players at kickoff"
        hint="Unowned players lock for adds when their game starts."
        checked={s.player_game_lock}
        onCheckedChange={(player_game_lock) => onSettings({ player_game_lock })}
      />
      <ToggleRow
        id="set-bench-lock"
        label="Bench lock"
        hint="A claim whose drop already played fails at processing."
        checked={s.bench_lock}
        onCheckedChange={(bench_lock) => onSettings({ bench_lock })}
      />
    </GroupCard>
  )
}

/** A field that is either "unlimited" or a bounded integer (§7.3.4 caps). */
function UnlimitedOrNumber({
  id,
  label,
  max,
  value,
  onChange,
}: {
  id: string
  label: string
  max: number
  value: 'unlimited' | number
  onChange: (next: 'unlimited' | number) => void
}) {
  const unlimited = value === 'unlimited'
  return (
    <FieldRow label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        {!unlimited && (
          <Input
            id={id}
            type="number"
            min={0}
            max={max}
            value={value}
            onChange={(e) => onChange(clampInt(e.target.value, 0, max, value))}
            className="h-btn-md w-20 text-[12px]"
          />
        )}
        <ChoiceSelect
          ariaLabel={`${label} limit`}
          value={unlimited ? 'unlimited' : 'limited'}
          width="w-28"
          options={[
            { value: 'unlimited', label: 'Unlimited' },
            { value: 'limited', label: 'Limited' },
          ]}
          onValueChange={(v) => onChange(v === 'unlimited' ? 'unlimited' : Math.min(max, 4))}
        />
      </div>
    </FieldRow>
  )
}

// ---------------------------------------------------------------------------
// §7.3.5 — Trades
// ---------------------------------------------------------------------------

function TradesGroup({
  s,
  onSettings,
  errorsFor,
}: {
  s: LeagueSettings
  onSettings: (patch: Partial<LeagueSettings>) => void
  errorsFor: (field: string) => FieldIssue[]
}) {
  const deadlineOptions = [
    { value: 'none', label: 'No deadline' },
    ...Array.from({ length: s.regular_season_weeks }, (_, i) => ({
      value: String(i + 1),
      label: `Week ${i + 1}`,
    })),
  ]

  return (
    <GroupCard title="Trades">
      <FieldRow label="Trade review" htmlFor="set-trade-review">
        <ChoiceSelect
          id="set-trade-review"
          ariaLabel="Trade review"
          value={s.trade_review}
          options={[
            { value: 'none', label: 'None (instant)' },
            { value: 'commissioner', label: 'Commissioner' },
            { value: 'league_vote', label: 'League vote' },
          ]}
          onValueChange={(v) => onSettings({ trade_review: v as LeagueSettings['trade_review'] })}
        />
      </FieldRow>

      {s.trade_review === 'league_vote' && (
        <FieldRow label="Veto votes" htmlFor="set-veto" hint={`1–${s.team_count} to veto a trade.`}>
          <Input
            id="set-veto"
            type="number"
            min={1}
            max={s.team_count}
            value={s.trade_veto_votes}
            onChange={(e) =>
              // Clamp to team_count (the real cap the validator enforces) — the
              // R109 fix, correct here from the start.
              onSettings({ trade_veto_votes: clampInt(e.target.value, 1, s.team_count, s.trade_veto_votes) })
            }
            className="h-btn-md w-24 text-[12px]"
          />
        </FieldRow>
      )}

      <FieldRow label="Review period" htmlFor="set-trade-hours" hint="Hours before a trade executes.">
        <Input
          id="set-trade-hours"
          type="number"
          min={0}
          max={96}
          value={s.trade_review_period_hours}
          onChange={(e) =>
            onSettings({ trade_review_period_hours: clampInt(e.target.value, 0, 96, s.trade_review_period_hours) })
          }
          className="h-btn-md w-24 text-[12px]"
        />
      </FieldRow>

      <FieldRow label="Trade deadline" htmlFor="set-trade-deadline">
        <ChoiceSelect
          id="set-trade-deadline"
          ariaLabel="Trade deadline"
          value={s.trade_deadline_week === null ? 'none' : String(s.trade_deadline_week)}
          options={deadlineOptions}
          width="w-36"
          onValueChange={(v) => onSettings({ trade_deadline_week: v === 'none' ? null : Number(v) })}
        />
      </FieldRow>

      <ToggleRow
        id="set-faab-trades"
        label="Allow FAAB in trades"
        checked={s.allow_faab_in_trades}
        onCheckedChange={(allow_faab_in_trades) => onSettings({ allow_faab_in_trades })}
      />
      <ToggleRow
        id="set-future-considerations"
        label="Allow future considerations"
        hint="Notes-only “gentleman’s” trades."
        checked={s.allow_future_considerations}
        onCheckedChange={(allow_future_considerations) => onSettings({ allow_future_considerations })}
      />

      <FieldRow label="If a game is live" htmlFor="set-trade-lock">
        <ChoiceSelect
          id="set-trade-lock"
          ariaLabel="Trade lock behavior"
          value={s.trade_lock_behavior}
          width="w-40"
          options={[
            { value: 'defer', label: 'Defer to next lock-free' },
            { value: 'reject', label: 'Reject the trade' },
          ]}
          onValueChange={(v) => onSettings({ trade_lock_behavior: v as LeagueSettings['trade_lock_behavior'] })}
        />
      </FieldRow>

      {['trade_veto_votes', 'trade_deadline_week'].flatMap((field) =>
        errorsFor(field).map((e) => <InlineIssue key={e.message} tone="error" message={e.message} />),
      )}
    </GroupCard>
  )
}

// ---------------------------------------------------------------------------
// §7.3.6 — Lineups & lock
// ---------------------------------------------------------------------------

function LineupsGroup({
  s,
  onSettings,
}: {
  s: LeagueSettings
  onSettings: (patch: Partial<LeagueSettings>) => void
}) {
  const windowIsHours = typeof s.stat_correction_window === 'number'
  return (
    <GroupCard title="Lineups & lock">
      <FieldRow label="Lineup lock" htmlFor="set-lineup-lock">
        <ChoiceSelect
          id="set-lineup-lock"
          ariaLabel="Lineup lock"
          value={s.lineup_lock}
          width="w-44"
          options={[
            { value: 'per_player_kickoff', label: 'Per-player kickoff' },
            { value: 'first_game_of_week', label: 'First game of week' },
          ]}
          onValueChange={(v) => onSettings({ lineup_lock: v as LeagueSettings['lineup_lock'] })}
        />
      </FieldRow>

      <ToggleRow
        id="set-illegal-lineups"
        label="Allow illegal lineups"
        hint="Off blocks empty/OUT slots at submit."
        checked={s.allow_illegal_lineups}
        onCheckedChange={(allow_illegal_lineups) => onSettings({ allow_illegal_lineups })}
      />
      <ToggleRow
        id="set-auto-sub"
        label="Auto-sub inactives"
        hint="Sleeper-style — sub inactive starters from the bench."
        checked={s.auto_sub_inactives}
        onCheckedChange={(auto_sub_inactives) => onSettings({ auto_sub_inactives })}
      />

      <FieldRow label="Stat-correction window" htmlFor="set-correction-mode" hint="How long corrections auto-apply.">
        <div className="flex items-center gap-2">
          {windowIsHours && (
            <Input
              id="set-correction-hours"
              type="number"
              min={0}
              max={168}
              value={s.stat_correction_window as number}
              onChange={(e) =>
                onSettings({
                  stat_correction_window: clampInt(e.target.value, 0, 168, s.stat_correction_window as number),
                })
              }
              className="h-btn-md w-20 text-[12px]"
            />
          )}
          <ChoiceSelect
            id="set-correction-mode"
            ariaLabel="Stat-correction window"
            value={windowIsHours ? 'hours' : 'thu_06_00_et'}
            width="w-36"
            options={[
              { value: 'thu_06_00_et', label: 'Thu 6:00 AM ET' },
              { value: 'hours', label: 'Custom hours' },
            ]}
            onValueChange={(v) =>
              onSettings({ stat_correction_window: v === 'thu_06_00_et' ? 'thu_06_00_et' : 48 })
            }
          />
        </div>
      </FieldRow>
    </GroupCard>
  )
}

// ---------------------------------------------------------------------------
// §7.3.7 — Tiebreakers (ordered, reorderable)
// ---------------------------------------------------------------------------

const TIEBREAKER_LABELS: Record<Tiebreaker, string> = {
  win_pct: 'Win %',
  points_for: 'Points For',
  head_to_head: 'Head-to-head',
  points_against: 'Points Against',
  division_record: 'Division record',
  coin_flip: 'Coin flip (deterministic)',
}

function TiebreakersGroup({
  s,
  onSettings,
}: {
  s: LeagueSettings
  onSettings: (patch: Partial<LeagueSettings>) => void
}) {
  const chain = s.tiebreakers

  function move(index: number, delta: number) {
    const next = [...chain]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onSettings({ tiebreakers: next })
  }

  return (
    <GroupCard title="Tiebreakers">
      <p className="text-[12px] font-semibold text-n-3">
        Applied in order whenever teams tie on the primary sort — standings and playoff seeding
        share this one chain (§7.3.7).
      </p>
      <ol className="flex flex-col gap-1.5">
        {chain.map((entry, i) => (
          <li
            key={entry}
            className="flex items-center gap-2.5 rounded-sm border border-n-4 px-3 py-2 text-[12px] font-bold"
          >
            <span className="fs-num w-5 shrink-0 text-n-3">{i + 1}</span>
            <span className="mr-auto">{TIEBREAKER_LABELS[entry] ?? entry}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Move ${TIEBREAKER_LABELS[entry]} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <Icon name="arrow-up" size={13} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Move ${TIEBREAKER_LABELS[entry]} down`}
              disabled={i === chain.length - 1}
              onClick={() => move(i, 1)}
            >
              <Icon name="arrow-bottom" size={13} />
            </Button>
          </li>
        ))}
      </ol>
    </GroupCard>
  )
}

// ---------------------------------------------------------------------------
// Schedule the draft — draft_scheduled_at (D60(4) nested path)
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Local wall-clock string ("YYYY-MM-DDTHH:mm") → ISO WITH the scheduler's
 *  local offset (not Z), so the stored offset — §16.4's "league reference
 *  time" — reads as the wall clock the commissioner actually picked
 *  ("7:00 PM (UTC−7)", not a UTC translation). */
function toIsoWithLocalOffset(local: string): string | null {
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return null
  const eastMinutes = -d.getTimezoneOffset()
  const sign = eastMinutes >= 0 ? '+' : '-'
  return `${local}:00${sign}${pad2(Math.trunc(Math.abs(eastMinutes) / 60))}:${pad2(Math.abs(eastMinutes) % 60)}`
}

const MONTH_OPTIONS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
].map((label, i) => ({ value: String(i + 1), label }))

/** Half-hour grid, "12:00 AM" … "11:30 PM", valued as 24h "HH:mm". */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.trunc(i / 2)
  const minute = i % 2 === 0 ? '00' : '30'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  const ampm = hour >= 12 ? 'PM' : 'AM'
  return { value: `${pad2(hour)}:${minute}`, label: `${hour12}:${minute} ${ampm}` }
})

/**
 * Month → Day → Time, in that order: Day unlocks once a month is picked,
 * Time once the day is too. The three picks are local UI state (seeded from
 * the saved value); only a COMPLETE pick writes draft_scheduled_at into the
 * working settings. The year is the league's season — not a fourth pick.
 */
function ScheduleDraftGroup({
  value,
  year,
  onChange,
}: {
  value: string | null
  year: number
  onChange: (next: string | null) => void
}) {
  const seed = value ? new Date(value) : null
  const seedValid = seed !== null && !Number.isNaN(seed.getTime())
  const [month, setMonth] = useState(() => (seedValid ? String(seed.getMonth() + 1) : ''))
  const [day, setDay] = useState(() => (seedValid ? String(seed.getDate()) : ''))
  const [time, setTime] = useState(() =>
    seedValid ? `${pad2(seed.getHours())}:${pad2(seed.getMinutes() < 30 ? 0 : 30)}` : '',
  )

  const daysInMonth = month ? new Date(year, Number(month), 0).getDate() : 0
  const dayOptions = numOptions(Array.from({ length: daysInMonth }, (_, i) => i + 1))

  function emit(m: string, d: string, t: string) {
    if (m && d && t) {
      onChange(toIsoWithLocalOffset(`${year}-${pad2(Number(m))}-${pad2(Number(d))}T${t}`))
    }
  }

  function handleMonth(m: string) {
    setMonth(m)
    // A shorter month can strand the picked day (e.g. 31 → February).
    const maxDay = new Date(year, Number(m), 0).getDate()
    if (day && Number(day) > maxDay) {
      setDay('')
      return
    }
    emit(m, day, time)
  }

  function handleDay(d: string) {
    setDay(d)
    emit(month, d, time)
  }

  function handleTime(t: string) {
    setTime(t)
    emit(month, day, t)
  }

  function handleClear() {
    setMonth('')
    setDay('')
    setTime('')
    onChange(null)
  }

  return (
    <GroupCard title="Schedule the draft">
      <FieldRow
        label="Draft date & time"
        htmlFor="set-draft-month"
        hint={`Drafting in the ${year} season, in your timezone — every manager sees it in theirs.`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <ChoiceSelect
            id="set-draft-month"
            ariaLabel="Draft month"
            value={month}
            placeholder="Month"
            options={MONTH_OPTIONS}
            onValueChange={handleMonth}
            width="w-32"
          />
          <ChoiceSelect
            ariaLabel="Draft day"
            value={day}
            placeholder="Day"
            options={dayOptions}
            onValueChange={handleDay}
            disabled={!month}
            width="w-20"
          />
          <ChoiceSelect
            ariaLabel="Draft time"
            value={time}
            placeholder="Time"
            options={TIME_OPTIONS}
            onValueChange={handleTime}
            disabled={!month || !day}
            width="w-28"
          />
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
              Clear
            </Button>
          )}
        </div>
      </FieldRow>
      <p className="text-[12px] font-semibold text-n-3">
        {value ? (
          <>
            Drafting{' '}
            <span className="fs-num text-ink">
              {new Date(value).toLocaleString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>{' '}
            — save to lock it in. The countdown appears on the league home.
          </>
        ) : (
          'No draft time set yet. Pick one and save — the league home shows it to every manager.'
        )}
      </p>
    </GroupCard>
  )
}

// ---------------------------------------------------------------------------
// §7.3.8 — Draft configuration
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

function DraftGroup({
  s,
  onDraft,
  errorsFor,
}: {
  s: LeagueSettings
  onDraft: (patch: Partial<LeagueSettings['draft']>) => void
  errorsFor: (field: string) => FieldIssue[]
}) {
  const d = s.draft
  return (
    <GroupCard title="Draft configuration">
      <FieldRow label="Draft type" htmlFor="set-draft-type">
        <ChoiceSelect
          id="set-draft-type"
          ariaLabel="Draft type"
          value={d.draft_type}
          options={[
            { value: 'snake', label: 'Snake' },
            { value: 'auction', label: 'Auction' },
            { value: 'linear', label: 'Linear' },
          ]}
          onValueChange={(v) => onDraft({ draft_type: v as LeagueSettings['draft']['draft_type'] })}
        />
      </FieldRow>

      {d.draft_type === 'snake' && (
        <ToggleRow
          id="set-snake-reversal"
          label="Third-round reversal"
          hint="Sleeper-style — the 3rd round doesn't flip."
          checked={d.snake_reversal}
          onCheckedChange={(snake_reversal) => onDraft({ snake_reversal })}
        />
      )}

      <FieldRow label="Draft order" htmlFor="set-order-mode" hint="Set before the room opens.">
        <ChoiceSelect
          id="set-order-mode"
          ariaLabel="Draft order mode"
          value={d.draft_order_mode}
          width="w-44"
          options={[
            { value: 'random', label: 'Random' },
            { value: 'manual', label: 'Commissioner sets' },
            { value: 'custom', label: 'Saved order' },
          ]}
          onValueChange={(v) => onDraft({ draft_order_mode: v as LeagueSettings['draft']['draft_order_mode'] })}
        />
      </FieldRow>

      <FieldRow label="Pick clock" htmlFor="set-pick-timer">
        <ChoiceSelect
          id="set-pick-timer"
          ariaLabel="Pick clock"
          value={String(d.pick_timer_seconds)}
          width="w-48"
          options={Object.entries(PICK_TIMER_LABELS).map(([v, label]) => ({ value: v, label }))}
          onValueChange={(v) =>
            onDraft({ pick_timer_seconds: Number(v) as LeagueSettings['draft']['pick_timer_seconds'] })
          }
        />
      </FieldRow>

      {d.draft_type === 'auction' && (
        <>
          <FieldRow label="Auction budget" htmlFor="set-auction-budget" hint="One-time draft budget.">
            <Input
              id="set-auction-budget"
              type="number"
              min={50}
              max={1000}
              value={d.auction_budget}
              onChange={(e) => onDraft({ auction_budget: clampInt(e.target.value, 50, 1000, d.auction_budget) })}
              className="h-btn-md w-24 text-[12px]"
            />
          </FieldRow>
          <FieldRow label="Minimum bid" htmlFor="set-auction-min">
            <Input
              id="set-auction-min"
              type="number"
              min={0}
              max={5}
              value={d.auction_min_bid}
              onChange={(e) => onDraft({ auction_min_bid: clampInt(e.target.value, 0, 5, d.auction_min_bid) })}
              className="h-btn-md w-24 text-[12px]"
            />
          </FieldRow>
          <FieldRow label="Nomination clock" htmlFor="set-auction-nom" hint="Seconds to nominate.">
            <Input
              id="set-auction-nom"
              type="number"
              min={10}
              max={120}
              value={d.auction_nomination_seconds}
              onChange={(e) =>
                onDraft({ auction_nomination_seconds: clampInt(e.target.value, 10, 120, d.auction_nomination_seconds) })
              }
              className="h-btn-md w-24 text-[12px]"
            />
          </FieldRow>
        </>
      )}

      {['draft.auction_budget'].flatMap((field) =>
        errorsFor(field).map((e) => <InlineIssue key={e.message} tone="error" message={e.message} />),
      )}
    </GroupCard>
  )
}
