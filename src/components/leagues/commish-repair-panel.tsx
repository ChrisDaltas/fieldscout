'use client'

import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCommishEditSchedule } from '@/hooks/use-commish-schedule'
import type { LeagueDetail } from '@/hooks/use-league'
import { useSchedule } from '@/hooks/use-schedule'

import {
  REPAIR_BLURB,
  REPAIR_NOTHING_COPY,
  REPAIR_TITLE,
  repairMatchupLabel,
  repairOptions,
  repairProblem,
  teamSeatable,
} from './commish-repair-ops'
import { editableTeams } from './schedule-view-ops'
import { StatusBanner } from './status-banners'

/**
 * Re-pair a matchup after the season starts (League UX batch 5) — the
 * Commissioner console's Schedule group, mounted only while override mode is
 * on. Week → matchup → the new pairing, an optional reason. Every choice it
 * offers is one the verb accepts (`commish-repair-ops.ts`); Save stays off
 * until the pairing is one. The server's answer is shown as it came back.
 */
export function CommishRepairPanel({ leagueId, data }: { leagueId: string; data: LeagueDetail }) {
  const schedule = useSchedule(leagueId)
  const edit = useCommishEditSchedule(leagueId)
  const names = useMemo(() => new Map(data.teams.map((t) => [t.id, t.name])), [data.teams])
  const teams = useMemo(() => editableTeams(data.teams), [data.teams])
  const matchups = useMemo(() => schedule.data?.matchups ?? [], [schedule.data])
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
  const refusal = edit.isError ? (edit.error instanceof Error ? edit.error.message : 'The re-pair was refused.') : null

  const pickMatchup = (id: string) => {
    const m = inWeek.find((x) => x.id === id)
    setMatchupId(id)
    setHome(m?.home.id ?? '')
    setAway(m?.away.id ?? '')
    edit.reset()
  }
  const reset = () => {
    setWeek(null)
    setMatchupId('')
    setHome('')
    setAway('')
    setReason('')
    edit.reset()
  }

  if (!schedule.data) return null

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-n-4 px-3 py-2" data-commish-repair>
      <p className="text-[12px] font-bold text-ink">{REPAIR_TITLE}</p>
      <p className="text-[11px] font-medium text-n-3">{REPAIR_BLURB}</p>

      {edit.data ? (
        <div className="flex flex-col gap-1.5" data-repair-applied>
          <StatusBanner tone="accent">
            <strong>{edit.data.no_changes ? 'Nothing changed.' : 'Matchup re-paired.'}</strong>{' '}
            {edit.data.no_changes ? (edit.data.no_changes_why ?? '') : `Week ${edit.data.week}: ${names.get(edit.data.matchup.after.home_team_id) ?? 'Unknown team'} vs ${names.get(edit.data.matchup.after.away_team_id) ?? 'Unknown team'}.`}
          </StatusBanner>
          <span>
            <Button variant="stroke" size="sm" onClick={reset}>
              Done
            </Button>
          </span>
        </div>
      ) : weeks.length === 0 ? (
        <p className="text-[11px] font-medium text-n-3" data-repair-empty>
          {REPAIR_NOTHING_COPY}
        </p>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (problem || !target || week === null) return
            edit.submit({ matchupId: target.id, homeTeamId: home, awayTeamId: away, week, reason })
          }}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
              Week
              <Select
                value={week === null ? '' : String(week)}
                onValueChange={(v) => {
                  setWeek(Number(v))
                  setMatchupId('')
                  setHome('')
                  setAway('')
                  edit.reset()
                }}
              >
                <SelectTrigger className="h-btn-md px-2 text-[12px]" data-repair-week>
                  <SelectValue placeholder="Pick a week" />
                </SelectTrigger>
                <SelectContent>
                  {weeks.map((w) => (
                    <SelectItem key={w} value={String(w)}>
                      Week {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
              Matchup
              <Select value={matchupId} onValueChange={pickMatchup} disabled={week === null}>
                <SelectTrigger className="h-btn-md px-2 text-[12px]" data-repair-matchup>
                  <SelectValue placeholder={week === null ? 'Pick a week first' : 'Pick a matchup'} />
                </SelectTrigger>
                <SelectContent>
                  {inWeek.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {repairMatchupLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          {target && (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    ['Home', home, setHome, 'data-repair-home'],
                    ['Away', away, setAway, 'data-repair-away'],
                  ] as const
                ).map(([label, value, set, attr]) => (
                  <label key={label} className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
                    {label}
                    <Select value={value} onValueChange={(v) => set(v)}>
                      <SelectTrigger className="h-btn-md px-2 text-[12px]" {...{ [attr]: value }}>
                        <SelectValue placeholder={`${label} team`} />
                      </SelectTrigger>
                      <SelectContent>
                        {teams.map((t) => {
                          const seat = teamSeatable(t.id, target, matchups)
                          return (
                            <SelectItem key={t.id} value={t.id} disabled={!seat.ok} title={seat.ok ? undefined : seat.why}>
                              {t.name}
                              {seat.ok ? '' : ' — game already scored'}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  </label>
                ))}
              </div>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
                Reason (optional — posted to the league if you give one)
                <Input
                  className="h-btn-md px-2 text-[12px]"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  placeholder="Why this pairing changes"
                  data-repair-reason
                />
              </label>
              {problem && (
                <p className="text-[11px] font-medium text-n-3" data-repair-problem>
                  {problem}
                </p>
              )}
              {refusal && (
                <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-2 py-1 text-[12px] font-semibold text-ink" data-repair-refusal>
                  {refusal}
                </p>
              )}
              <div className="flex items-center gap-2">
                <Button type="submit" variant="blue" size="sm" disabled={problem !== null || edit.isPending} data-repair-save>
                  {edit.isPending ? 'Saving…' : 'Save pairing'}
                </Button>
                <Button type="button" variant="stroke" size="sm" onClick={reset} disabled={edit.isPending}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  )
}
