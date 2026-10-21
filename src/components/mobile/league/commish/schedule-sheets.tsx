'use client'

import { useEffect, useMemo, useState } from 'react'

import { REPAIR_TITLE, repairMatchupLabel, repairOptions, repairProblem } from '@/components/leagues/commish-repair-ops'
import { formatKickoff } from '@/components/leagues/lineup-editor-ops'
import {
  confirmGate,
  editFormProblem,
  frozenWeekCopy,
  remixWindowCopy,
  systemPostPreview,
  type MatchupCell,
  type TeamRef,
} from '@/components/leagues/schedule-view-ops'
import { SkeletonBlocks } from '@/components/mobile/league/league/league-bits'
import { MField, MNotice, MSelect, M_TEXT_FIELD } from '@/components/mobile/ui/m-form'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useCommishEditSchedule } from '@/hooks/use-commish-schedule'
import { useConfirmRemix, useEditMatchup, useRemixPreview, type RemixPreview, type ScheduleMatchup } from '@/hooks/use-schedule'
import { cn } from '@/lib/utils'

import {
  EDIT_SHEET_NOTE,
  EDIT_SHEET_TITLE,
  REASON_HINT,
  REASON_LABEL,
  REMIX_ROW_LABEL,
  editAppliedCopy,
  remixWeekCards,
  repairAppliedCopy,
  repairTeamOptions,
} from './commish-ops'

/**
 * The Commissioner tools' three schedule changes as phone sheets (gap list
 * §4 item 109) — the console's Schedule group on desktop (`EditMatchupForm`,
 * `ScheduleRemixModal`, `CommishRepairPanel`), on the SAME hooks and rules:
 *  - **Change matchup** — an upcoming week's pairing (`useEditMatchup`, the
 *    normal verb; no override needed);
 *  - **Remix schedule** — a seeded preview first (write-free), then Confirm
 *    sends that seed back (`useRemixPreview` / `useConfirmRemix`);
 *  - **Re-pair a matchup** — after the season starts, in override mode
 *    (`useCommishEditSchedule`).
 * Every choice offered is one the verb accepts (prevent, don't refuse): a
 * pairing that changes nothing or seats a team twice keeps Save off and
 * says why; a team that can't move is shown greyed. A reason is optional
 * everywhere and never gates anything. Never optimistic — what shows after
 * a save is the server's answer, a refusal word for word. A sheet can't be
 * closed while its save is in flight.
 */

const BODY = 'flex flex-col gap-4 px-5 pb-3'
const FOOT_BUTTON = 'flex h-12 w-full items-center justify-center rounded-[14px] text-[15px] font-semibold'
const PRIMARY = cn(FOOT_BUTTON, 'bg-accent text-white active:bg-accent-strong disabled:bg-m-b3s disabled:text-m-t3')
const QUIET = cn(FOOT_BUTTON, 'bg-m-b2 text-m-t1 active:bg-m-b2h disabled:opacity-50')

function refusalOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** A change went through: the server's words on the green tint (a change
 *  that changed nothing reads neutral). */
function Applied({ title, detail, marker, neutral = false }: { title: string; detail?: string; marker: string; neutral?: boolean }) {
  return (
    <p
      role="status"
      className={cn('rounded-message px-3 py-2.5 text-[13px] font-medium leading-[1.4]', neutral ? 'bg-m-b1 text-m-t2' : 'bg-m-gg text-m-tg')}
      {...{ [marker]: '' }}
    >
      <span className="font-semibold">{title}</span>
      {detail ? ` ${detail}` : null}
    </p>
  )
}

/** The league chat post a change wrote (or, before Confirm, a preview of it). */
function ChatPost({ label, text, marker }: { label: string; text: string; marker: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-m-t3">{label}</span>
      <p className="rounded-message bg-m-b1 px-3 py-2.5 text-[13px] font-medium leading-[1.4] text-m-t2" {...{ [marker]: '' }}>
        {text}
      </p>
    </div>
  )
}

function ReasonField({ id, value, onChange, placeholder, disabled }: { id: string; value: string; onChange: (v: string) => void; placeholder: string; disabled?: boolean }) {
  return (
    <MField label={REASON_LABEL} hint={REASON_HINT} htmlFor={id}>
      <input id={id} className={M_TEXT_FIELD} value={value} onChange={(e) => onChange(e.target.value)} maxLength={500} placeholder={placeholder} disabled={disabled} data-reason />
    </MField>
  )
}

/** Close unless a save is in flight (its answer must land on screen). The
 *  header's X, a swipe down and a backdrop tap all come through here. */
function guardClose(pending: boolean, onOpenChange: (open: boolean) => void) {
  return (open: boolean) => {
    if (!open && pending) return
    onOpenChange(open)
  }
}

// ---------------------------------------------------------------------------
// Change an upcoming week's matchup
// ---------------------------------------------------------------------------

export function EditMatchupSheet({
  open,
  onOpenChange,
  leagueId,
  week,
  row,
  teams,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leagueId: string
  week: number
  row: MatchupCell
  teams: readonly TeamRef[]
}) {
  const edit = useEditMatchup(leagueId)
  const [home, setHome] = useState(row.home.id)
  const [away, setAway] = useState(row.away?.id ?? '')
  const [reason, setReason] = useState('')
  const problem = editFormProblem(row, home, away)
  const applied = edit.data ?? null
  const names = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])
  const options = teams.map((t) => ({ value: t.id, label: t.name }))
  const save = () => {
    if (problem || edit.isPending) return
    edit.edit({ matchup_id: row.id, home_team_id: home, away_team_id: away, reason: reason.trim() || null })
  }
  return (
    <MobileSheet
      open={open}
      onOpenChange={guardClose(edit.isPending, onOpenChange)}
      title={EDIT_SHEET_TITLE}
      showClose
      subtitle={`Week ${week}`}
      footer={
        <div className="flex flex-col gap-2 px-4 pt-2.5">
          {applied ? (
            <button type="button" onClick={() => onOpenChange(false)} className={PRIMARY} data-edit-done>
              Done
            </button>
          ) : (
            <button type="button" onClick={save} disabled={problem !== null || edit.isPending} className={PRIMARY} data-edit-save>
              {edit.isPending ? 'Saving…' : 'Save pairing'}
            </button>
          )}
        </div>
      }
    >
      <div className={BODY} data-edit-sheet>
        {applied ? (
          <>
            <Applied title="Matchup changed." detail={editAppliedCopy(applied, names)} marker="data-edit-applied" />
            <ChatPost label="Posted to league chat" text={applied.system_post} marker="data-system-post" />
          </>
        ) : (
          <>
            <MField label="Home" htmlFor="edit-home">
              <MSelect id="edit-home" full value={home} options={options} onValueChange={setHome} disabled={edit.isPending} />
            </MField>
            <MField label="Away" htmlFor="edit-away">
              <MSelect id="edit-away" full value={away} options={options} onValueChange={setAway} disabled={edit.isPending} placeholder="Pick a team" />
            </MField>
            <ReasonField id="edit-reason" value={reason} onChange={setReason} placeholder="Why this pairing changes" disabled={edit.isPending} />
            {problem && (
              <p className="text-[13px] font-medium text-m-t3" data-edit-problem>
                {problem}
              </p>
            )}
            {edit.isError && <MNotice tone="error">{refusalOf(edit.error, 'The change was refused.')}</MNotice>}
            <p className="text-[12px] font-medium leading-[1.35] text-m-t3">{EDIT_SHEET_NOTE}</p>
          </>
        )}
      </div>
    </MobileSheet>
  )
}

// ---------------------------------------------------------------------------
// Remix the schedule
// ---------------------------------------------------------------------------

export function RemixSheet({
  open,
  onOpenChange,
  leagueId,
  current,
  names,
  leagueTimeZone,
  actorName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leagueId: string
  /** The season as it stands (`useSchedule`'s matchups). */
  current: readonly ScheduleMatchup[]
  names: ReadonlyMap<string, string>
  leagueTimeZone: string | null
  /** For the chat-post PREVIEW only; the server names the actor itself. */
  actorName: string
}) {
  const preview = useRemixPreview(leagueId)
  const confirm = useConfirmRemix(leagueId)
  const [reason, setReason] = useState('')
  // The sheet mounts once per opening: a remix begins with a roll.
  useEffect(() => {
    preview.preview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const plan = preview.data ?? null
  const applied = confirm.data ?? null
  const gate = confirmGate(plan)
  const busy = preview.isPending || confirm.isPending

  return (
    <MobileSheet
      open={open}
      onOpenChange={guardClose(confirm.isPending, onOpenChange)}
      title={REMIX_ROW_LABEL}
      showClose
      subtitle="Nothing changes until you confirm."
      size="tall"
      footer={
        <div className="flex flex-col gap-2 px-4 pt-2.5">
          {applied ? (
            <button type="button" onClick={() => onOpenChange(false)} className={PRIMARY} data-remix-done>
              Done
            </button>
          ) : (
            <>
              {plan && !gate.ok && (
                <p className="text-center text-[12px] font-medium text-m-t3" data-confirm-gate>
                  {gate.why}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    confirm.reset()
                    preview.preview()
                  }}
                  disabled={busy}
                  className={QUIET}
                  data-remix-roll
                >
                  Roll again
                </button>
                <button
                  type="button"
                  onClick={() => plan && confirm.confirm({ seed: plan.seed, reason: reason.trim() || null })}
                  disabled={!gate.ok || busy}
                  className={PRIMARY}
                  data-confirm-remix
                >
                  {confirm.isPending ? 'Confirming…' : 'Confirm remix'}
                </button>
              </div>
            </>
          )}
        </div>
      }
    >
      <div className={BODY} data-remix-sheet>
        {applied ? (
          <>
            <Applied
              title="Remix applied."
              detail={`Week${applied.weeks_regenerated.length === 1 ? '' : 's'} ${applied.weeks_regenerated.join(', ')} redrawn — ${applied.matchups_replaced} matchup${applied.matchups_replaced === 1 ? '' : 's'} replaced.`}
              marker="data-remix-applied"
            />
            <ChatPost label="Posted to league chat" text={applied.system_post} marker="data-system-post" />
          </>
        ) : preview.isPending || (!plan && !preview.isError) ? (
          <div data-remix-loading>
            <SkeletonBlocks count={3} className="h-24" />
          </div>
        ) : preview.isError || !plan ? (
          <MNotice tone="error" action={{ label: 'Try again', onClick: () => preview.preview() }}>
            Couldn’t preview a remix. {refusalOf(preview.error, '')}
          </MNotice>
        ) : (
          <RemixPlan plan={plan} current={current} names={names} leagueTimeZone={leagueTimeZone} reason={reason} onReason={setReason} actorName={actorName} />
        )}
        {confirm.isError && <MNotice tone="error">{refusalOf(confirm.error, 'The remix was refused.')}</MNotice>}
      </div>
    </MobileSheet>
  )
}

function RemixPlan({
  plan,
  current,
  names,
  leagueTimeZone,
  reason,
  onReason,
  actorName,
}: {
  plan: RemixPreview
  current: readonly ScheduleMatchup[]
  names: ReadonlyMap<string, string>
  leagueTimeZone: string | null
  reason: string
  onReason: (value: string) => void
  actorName: string
}) {
  const kickoff = plan.window.first_kickoff_at ? formatKickoff(plan.window.first_kickoff_at, leagueTimeZone) : null
  const copy = remixWindowCopy(plan.window, kickoff?.local ?? null)
  const weeks = remixWeekCards(plan, current, names)
  return (
    <>
      <p
        className={cn('rounded-message px-3 py-2.5 text-[13px] font-medium leading-[1.4]', plan.window.free ? 'bg-m-b1 text-m-t1' : 'bg-m-go text-m-to')}
        data-window={plan.window.free ? 'free' : 'override'}
      >
        <span className="font-semibold">{copy.title}</span> — {copy.body}
      </p>
      <p className="text-[13px] font-medium tabular-nums text-m-t3" data-remix-seed={plan.seed}>
        {plan.weeks_regenerable.length} of {plan.regular_season_weeks} weeks redrawn · {plan.change_count} change{plan.change_count === 1 ? '' : 's'}
      </p>
      {plan.no_changes && (
        <p role="status" className="rounded-message bg-m-b1 px-3 py-2.5 text-[13px] font-medium text-m-t2">
          This draw is the same as the current schedule — nothing would change.
        </p>
      )}
      {plan.weeks_frozen.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[12px] font-medium text-m-t3" data-frozen-weeks>
          {plan.weeks_frozen.map((f) => (
            <li key={f.week}>{frozenWeekCopy(f)}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2" data-remix-weeks>
        {weeks.map((w) => (
          <section key={w.week} aria-label={`Week ${w.week}`} className="rounded-[14px] bg-m-b1 px-3.5 py-2.5" data-week={w.week}>
            <div className="flex items-center justify-between gap-2 pb-1">
              <h3 className="text-[14px] font-semibold tabular-nums text-m-t1">Week {w.week}</h3>
              <span className="text-[12px] font-medium tabular-nums text-m-t3">{w.changed === 0 ? 'No change' : `${w.changed} changed`}</span>
            </div>
            <ul className="flex flex-col">
              {w.pairings.map((c, i) => (
                <li key={`${c.round_type}:${c.text}:${i}`} className="flex min-h-7 items-center gap-2 text-[13px]" data-pairing={c.state}>
                  <span className={cn('min-w-0 flex-1', c.state === 'same' ? 'font-medium text-m-t3' : 'font-semibold text-m-t1')}>
                    {c.text}
                    {c.round_type === 'secondary' && <span className="font-medium text-m-t3"> · second game</span>}
                    {c.state === 'flipped' && <span className="font-medium text-m-t3"> · home and away swapped</span>}
                  </span>
                  {c.state === 'changed' && <span className="flex h-5 flex-none items-center rounded-pill bg-m-gb px-2 text-[11px] font-semibold text-m-tb">New</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {!plan.window.free && <ReasonField id="remix-reason" value={reason} onChange={onReason} placeholder="Why the schedule is redrawn after kickoff" />}
      <ChatPost label="What league chat will see" text={systemPostPreview(plan, reason, actorName)} marker="data-system-post-preview" />
    </>
  )
}

// ---------------------------------------------------------------------------
// Re-pair a matchup after the season starts (override mode)
// ---------------------------------------------------------------------------

export function RepairSheet({
  open,
  onOpenChange,
  leagueId,
  matchups,
  teams,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leagueId: string
  /** The season as it stands (`useSchedule`'s matchups). */
  matchups: readonly ScheduleMatchup[]
  /** The teams a pairing may seat (`editableTeams`). */
  teams: readonly TeamRef[]
}) {
  const edit = useCommishEditSchedule(leagueId)
  const names = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])
  const options = useMemo(() => repairOptions(matchups, names), [matchups, names])
  const weeks = [...options.keys()]
  const [week, setWeek] = useState<number | null>(null)
  const [matchupId, setMatchupId] = useState('')
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')
  const [reason, setReason] = useState('')

  const inWeek = week === null ? [] : (options.get(week) ?? [])
  const target = inWeek.find((m) => m.id === matchupId) ?? null
  const problem = repairProblem(target, home, away, matchups)
  const applied = edit.data ?? null
  const save = () => {
    if (problem || !target || week === null || edit.isPending) return
    edit.submit({ matchupId: target.id, homeTeamId: home, awayTeamId: away, week, reason })
  }
  const teamOptions = target ? repairTeamOptions(teams, target, matchups) : []
  const said = applied ? repairAppliedCopy(applied, names) : null

  return (
    <MobileSheet
      open={open}
      onOpenChange={guardClose(edit.isPending, onOpenChange)}
      title={REPAIR_TITLE}
      showClose
      subtitle="Recorded and posted to the league."
      footer={
        <div className="flex flex-col gap-2 px-4 pt-2.5">
          {applied ? (
            <button type="button" onClick={() => onOpenChange(false)} className={PRIMARY} data-repair-done>
              Done
            </button>
          ) : (
            <button type="button" onClick={save} disabled={problem !== null || edit.isPending} className={PRIMARY} data-repair-save>
              {edit.isPending ? 'Saving…' : 'Save pairing'}
            </button>
          )}
        </div>
      }
    >
      <div className={BODY} data-repair-sheet>
        {said ? (
          <Applied title={said.title} detail={said.detail} neutral={applied?.no_changes} marker="data-repair-applied" />
        ) : (
          <>
            <MField label="Week" htmlFor="repair-week">
              <MSelect
                id="repair-week"
                full
                value={week === null ? '' : String(week)}
                placeholder="Pick a week"
                options={weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))}
                onValueChange={(v) => {
                  setWeek(Number(v))
                  setMatchupId('')
                  setHome('')
                  setAway('')
                  edit.reset()
                }}
                disabled={edit.isPending}
              />
            </MField>
            <MField label="Matchup" htmlFor="repair-matchup">
              <MSelect
                id="repair-matchup"
                full
                value={matchupId}
                placeholder={week === null ? 'Pick a week first' : 'Pick a matchup'}
                options={inWeek.map((m) => ({ value: m.id, label: repairMatchupLabel(m) }))}
                onValueChange={(id) => {
                  const m = inWeek.find((x) => x.id === id)
                  setMatchupId(id)
                  setHome(m?.home.id ?? '')
                  setAway(m?.away.id ?? '')
                  edit.reset()
                }}
                disabled={week === null || edit.isPending}
              />
            </MField>
            {target && (
              <>
                <MField label="Home" htmlFor="repair-home">
                  <MSelect id="repair-home" full value={home} options={teamOptions} onValueChange={setHome} disabled={edit.isPending} />
                </MField>
                <MField label="Away" htmlFor="repair-away">
                  <MSelect id="repair-away" full value={away} options={teamOptions} onValueChange={setAway} disabled={edit.isPending} />
                </MField>
                <ReasonField id="repair-reason" value={reason} onChange={setReason} placeholder="Why this pairing changes" disabled={edit.isPending} />
              </>
            )}
            {problem && (
              <p className="text-[13px] font-medium text-m-t3" data-repair-problem>
                {problem}
              </p>
            )}
            {edit.isError && <MNotice tone="error">{refusalOf(edit.error, 'The re-pair was refused.')}</MNotice>}
          </>
        )}
      </div>
    </MobileSheet>
  )
}
