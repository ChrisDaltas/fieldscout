'use client'

import { useId, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useCommishSetAutopilot } from '@/hooks/use-commish-autopilot'
import { useCommishFaab } from '@/hooks/use-commish-faab'
import { useCommishMovePlayer } from '@/hooks/use-commish-move-player'
import { useCommishForceAddDrop } from '@/hooks/use-commish-roster'
import { useCommishRenameTeam } from '@/hooks/use-commish-team'
import { useDraftPool } from '@/hooks/use-draft-pool'
import { useRenameOwnTeam } from '@/hooks/use-rename-own-team'
import type { CommishEditFaabResult } from '@/lib/leagues/api/commish-faab-service'
import type { CommishRosterOverrideResult } from '@/lib/leagues/api/commish-roster-service'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { cn } from '@/lib/utils'

import {
  ADD_NO_MATCH_COPY,
  ADD_SEARCH_HINT,
  ADD_SEARCH_MIN,
  AUTOPILOT_SWITCH_LABEL,
  RENAME_VIA_OVERRIDE_HINT,
  TEAM_TOOLS_EMPTY_ROSTER_COPY,
  TEAM_TOOLS_INTRO,
  TEAM_TOOLS_TITLE,
  addCandidates,
  renameGate,
  renameOutcome,
  rosterBypassedCopy,
  rosterOutcome,
  type AddCandidate,
  type RenameArm,
  type RenameOutcomeBranch,
  type ToolOutcome,
} from './team-commish-ops'

/**
 * The team page's commissioner ROSTER tools — M6A task L.E1.13 item 1 (spec
 * §15.4:1694 → `commish_move_player`, §15.4:1695 → `commish_force_add_drop`,
 * migration 127; §10.3; PROGRESS §3 STANDING RULE (h); D346, D351; Q66).
 *
 * **A face of OVERRIDE MODE, not a control of its own** (rule (h)): the page
 * mounts this only while the ONE switch (`OverrideModeBar`, which the lineup
 * editor above it already mounts over `commish-override-store.ts`) is on and
 * the viewer is a commissioner. There is no second toggle here, no per-move
 * "override" button and **no reason input — the request carries none** (Q66 /
 * F343): 127 stores NULL and still writes the receipt and the §10.3 post.
 *
 * **Not optimistic, not retried** — the hooks' contract. What is painted
 * after a submit is the server's CANONICAL document through `rosterOutcome`
 * (`no_changes` never says "saved"; `score_stale` FIRST among the success
 * arms — R971 / §4 rule 15), the `bypassed[]` narration in words, or the
 * verb's refusal VERBATIM (a full roster, a player another team holds — the
 * legality gates that bind a commissioner too). The hooks re-read rosters,
 * the pool, the lineups, the activity feed and the log on success AND error.
 */
export function TeamCommishTools({
  leagueId,
  teamId,
  teamName,
  roster,
  otherTeams,
  heldPlayerIds,
}: {
  leagueId: string
  teamId: string
  teamName: string
  roster: readonly RosterPlayer[]
  otherTeams: readonly { id: string; name: string }[]
  /** Every player ANY roster in this league holds — the add picker's filter. */
  heldPlayerIds: ReadonlySet<string>
}) {
  const move = useCommishMovePlayer(leagueId)
  const addDrop = useCommishForceAddDrop(leagueId)
  const [last, setLast] = useState<'move' | 'roster' | null>(null)
  const [search, setSearch] = useState('')
  const searching = search.trim().length >= ADD_SEARCH_MIN
  // `useDraftPool` is the app's one player search (the players page's own);
  // an under-length search reads nothing worth showing and is not rendered.
  const players = useDraftPool(searching ? search : '', '')
  const candidates = useMemo(() => addCandidates(players.data ?? [], heldPlayerIds), [players.data, heldPlayerIds])

  const pending = move.isPending || addDrop.isPending
  const spoke = last === 'move' ? move : last === 'roster' ? addDrop : null

  return (
    <TeamCommishToolsView
      teamName={teamName}
      roster={roster}
      otherTeams={otherTeams}
      pending={pending}
      outcome={spoke?.data ?? null}
      refusal={spoke?.error?.message ?? null}
      search={search}
      onSearch={setSearch}
      candidates={!searching ? { state: 'idle' } : players.isPending ? { state: 'loading' } : players.isError ? { state: 'error', retry: () => void players.refetch() } : { state: 'ready', players: candidates }}
      onMove={(player, toTeamId) => {
        if (pending) return
        addDrop.reset()
        setLast('move')
        move.submit({ playerId: player.player_id, fromTeamId: teamId, toTeamId })
      }}
      onDrop={(player) => {
        if (pending) return
        move.reset()
        setLast('roster')
        addDrop.submit({ teamId, dropPlayerId: player.player_id })
      }}
      onAdd={(candidate) => {
        if (pending) return
        move.reset()
        setLast('roster')
        addDrop.submit({ teamId, addPlayerId: candidate.id })
      }}
    />
  )
}

export type AddCandidatesState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; retry: () => void }
  | { state: 'ready'; players: readonly AddCandidate[] }

/** The panel as a function of its props — every branch of the result
 *  document is a real render in `team-commish.render.test.ts` without a
 *  browser (a static render runs no mutation). */
export function TeamCommishToolsView({
  teamName,
  roster,
  otherTeams,
  pending,
  outcome,
  refusal,
  search,
  onSearch,
  candidates,
  onMove,
  onDrop,
  onAdd,
}: {
  teamName: string
  roster: readonly RosterPlayer[]
  otherTeams: readonly { id: string; name: string }[]
  pending: boolean
  outcome: Pick<CommishRosterOverrideResult, 'no_changes' | 'no_changes_why' | 'score_stale' | 'score_stale_reason' | 'bypassed'> | null
  refusal: string | null
  search: string
  onSearch: (text: string) => void
  candidates: AddCandidatesState
  onMove: (player: RosterPlayer, toTeamId: string) => void
  onDrop: (player: RosterPlayer) => void
  onAdd: (candidate: AddCandidate) => void
}) {
  const id = useId()
  const said = outcome ? rosterOutcome(outcome) : null
  const bypassed = outcome && !outcome.no_changes ? rosterBypassedCopy(outcome.bypassed) : null

  return (
    <section
      className="flex flex-col gap-3 rounded-sm border-2 border-brand-strong bg-brand-soft p-2 sm:p-3"
      aria-label={TEAM_TOOLS_TITLE}
      data-team-commish-tools
    >
      <div className="flex flex-col gap-3 rounded-sm border border-ink bg-white px-3 py-3">
        <h3 className="text-[12px] font-bold text-ink">{TEAM_TOOLS_TITLE}</h3>
        <p className="text-[11px] font-medium text-n-3">{TEAM_TOOLS_INTRO}</p>

        {/* The verb's refusal, VERBATIM — that text is the UX. */}
        {refusal && (
          <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink" data-tools-refusal>
            {refusal}
          </p>
        )}
        {!refusal && said && <OutcomeNote said={said} extra={bypassed} extraMarker="data-tools-bypassed" marker="data-tools-outcome" />}
        {pending && (
          <p role="status" className="text-[11px] font-semibold text-n-3" data-tools-pending>
            Saving…
          </p>
        )}

        {roster.length === 0 ? (
          <p className="text-[12px] font-medium text-n-3" data-empty="commish-roster">
            {TEAM_TOOLS_EMPTY_ROSTER_COPY}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-n-4" data-tools-roster>
            {roster.map((player) => (
              <RosterToolRow key={player.player_id} player={player} otherTeams={otherTeams} pending={pending} onMove={onMove} onDrop={onDrop} />
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 border-t border-n-4 pt-3" data-tools-add>
          <label htmlFor={`${id}-add`} className="text-[11px] font-bold text-ink">
            {`Add a player to ${teamName}`}
          </label>
          <Input
            id={`${id}-add`}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search players by name"
            autoComplete="off"
            disabled={pending}
            className="h-btn-md px-2 text-[12px]"
            data-add-search
          />
          {candidates.state === 'idle' && <p className="text-[11px] font-medium text-n-3">{ADD_SEARCH_HINT}</p>}
          {candidates.state === 'loading' && (
            <div className="flex flex-col gap-1.5" data-skeleton="add-candidates">
              <Skeleton className="h-6 rounded-sm" />
              <Skeleton className="h-6 rounded-sm" />
            </div>
          )}
          {candidates.state === 'error' && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2" data-add-problem>
              <p className="text-[12px] font-bold text-ink">Couldn’t search players — this is a failed read, not an empty result.</p>
              <Button variant="stroke" size="sm" onClick={candidates.retry}>
                Retry
              </Button>
            </div>
          )}
          {candidates.state === 'ready' && candidates.players.length === 0 && (
            <p className="text-[12px] font-medium text-n-3" data-empty="add-candidates">
              {ADD_NO_MATCH_COPY}
            </p>
          )}
          {candidates.state === 'ready' && candidates.players.length > 0 && (
            <ul className="flex flex-col divide-y divide-n-4" data-add-candidates>
              {candidates.players.map((candidate) => (
                <li key={candidate.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate text-[12px] font-semibold text-ink">
                    {candidate.full_name}{' '}
                    <span className="font-medium text-n-3">{[candidate.position, candidate.team].filter(Boolean).join(' · ')}</span>
                  </span>
                  <Button variant="stroke" size="sm" disabled={pending} onClick={() => onAdd(candidate)} data-add-player={candidate.id}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function RosterToolRow({
  player,
  otherTeams,
  pending,
  onMove,
  onDrop,
}: {
  player: RosterPlayer
  otherTeams: readonly { id: string; name: string }[]
  pending: boolean
  onMove: (player: RosterPlayer, toTeamId: string) => void
  onDrop: (player: RosterPlayer) => void
}) {
  const [target, setTarget] = useState('')
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5" data-tools-player={player.player_id}>
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">
        {player.full_name}{' '}
        <span className="font-medium text-n-3">{[player.position, player.nfl_team].filter(Boolean).join(' · ')}</span>
      </span>
      {otherTeams.length > 0 && (
        <>
          <Select value={target} onValueChange={setTarget} disabled={pending}>
            <SelectTrigger className="h-btn-md w-40 px-2 text-[12px]" aria-label={`Move ${player.full_name} to`} data-move-target>
              <SelectValue placeholder="Move to…" />
            </SelectTrigger>
            <SelectContent>
              {otherTeams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="stroke"
            size="sm"
            disabled={pending || target === ''}
            title={target === '' ? 'Pick the team to move him to first.' : undefined}
            onClick={() => onMove(player, target)}
            data-move-player
          >
            Move
          </Button>
        </>
      )}
      <Button variant="stroke" size="sm" disabled={pending} onClick={() => onDrop(player)} data-drop-player>
        Drop
      </Button>
    </li>
  )
}

function OutcomeNote({
  said,
  extra,
  marker,
  extraMarker,
}: {
  said: ToolOutcome<string>
  extra: string | null
  marker: string
  extraMarker: string
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-1 rounded-sm border px-3 py-2 text-[12px] font-semibold text-ink',
        said.tone === 'positive' && 'border-positive bg-positive-soft',
        said.tone === 'caution' && 'border-ink bg-caution-soft',
        said.tone === 'neutral' && 'border-ink bg-n-4',
      )}
      {...{ [marker]: said.branch }}
    >
      <span>{said.text}</span>
      {extra && (
        <span className="text-[11px] font-medium" {...{ [extraMarker]: '' }}>
          {extra}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rename — inline on the team page (item 2)
// ---------------------------------------------------------------------------

/**
 * Rename, inline in the team page's header card. TWO arms, one form:
 * the MANAGER's for his own team (`rename_own_team` — no reason, no receipt,
 * NOT inside override mode: he is exercising no §10.1 power), and the
 * COMMISSIONER's for any team (`commish_rename_team` — audited, and offered
 * ONLY inside override mode, rule (h)). `renameArm` decides; a commissioner
 * on another team's page outside the mode is told the mode is the way.
 */
export function TeamRename({
  leagueId,
  teamId,
  teamName,
  arm,
  showOverrideHint,
}: {
  leagueId: string
  teamId: string
  teamName: string
  arm: RenameArm
  /** A commissioner, not in the mode, on a team that is not his. */
  showOverrideHint: boolean
}) {
  const own = useRenameOwnTeam(leagueId, teamId)
  const commish = useCommishRenameTeam(leagueId)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(teamName)
  const active = arm === 'commissioner' ? commish : own

  if (arm === null) {
    return showOverrideHint ? (
      <span className="text-[11px] font-medium text-n-3" data-rename-hint>
        {RENAME_VIA_OVERRIDE_HINT}
      </span>
    ) : null
  }
  return (
    <TeamRenameView
      arm={arm}
      open={open}
      draft={draft}
      pending={active.isPending}
      outcome={active.data ? renameOutcome(active.data, arm === 'commissioner') : null}
      refusal={active.error?.message ?? null}
      onOpen={() => {
        own.reset()
        commish.reset()
        setDraft(teamName)
        setOpen(true)
      }}
      onClose={() => setOpen(false)}
      onDraft={setDraft}
      onSave={(name) => {
        if (active.isPending) return
        if (arm === 'commissioner') commish.submit({ teamId, name })
        else own.submit(name)
      }}
    />
  )
}

export function TeamRenameView({
  arm,
  open,
  draft,
  pending,
  outcome,
  refusal,
  onOpen,
  onClose,
  onDraft,
  onSave,
}: {
  arm: Exclude<RenameArm, null>
  open: boolean
  draft: string
  pending: boolean
  outcome: ToolOutcome<RenameOutcomeBranch> | null
  refusal: string | null
  onOpen: () => void
  onClose: () => void
  onDraft: (text: string) => void
  onSave: (name: string) => void
}) {
  const id = useId()
  const gate = renameGate(draft)
  const gateId = `${id}-gate`
  if (!open) {
    return (
      <Button variant="stroke" size="sm" onClick={onOpen} data-rename-open={arm}>
        Rename
      </Button>
    )
  }
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (gate.ok && !pending) onSave(gate.name)
      }}
      data-rename-form={arm}
    >
      <label htmlFor={`${id}-name`} className="text-[11px] font-bold text-ink">
        {arm === 'commissioner' ? 'Team name (commissioner rename — recorded and posted to the league)' : 'Team name'}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`${id}-name`}
          value={draft}
          maxLength={120}
          autoComplete="off"
          disabled={pending}
          aria-describedby={gate.ok ? undefined : gateId}
          onChange={(event) => onDraft(event.target.value)}
          className="h-btn-md min-w-0 flex-1 px-2 text-[12px]"
          data-rename-input
        />
        <Button type="submit" variant="blue" size="sm" disabled={!gate.ok || pending} data-rename-save>
          {pending ? 'Saving…' : 'Save name'}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onClose}>
          Close
        </Button>
      </div>
      {/* WHY Save is disabled, said (rule (h)) — never a dead button. */}
      {!gate.ok && (
        <span id={gateId} className="text-[11px] font-semibold text-n-3" data-rename-gate>
          {gate.why}
        </span>
      )}
      {refusal && (
        <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink" data-rename-refusal>
          {refusal}
        </p>
      )}
      {!refusal && outcome && <OutcomeNote said={outcome} extra={null} marker="data-rename-outcome" extraMarker="data-rename-extra" />}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Autopilot — the per-team switch (M6A L.E1.22; Q63)
// ---------------------------------------------------------------------------

/**
 * The commissioner's "Put on autopilot" switch, in the team page's header
 * card. A face of OVERRIDE MODE (rule (h)): the page mounts it only while the
 * commissioner is in the mode and only for an UNMANAGED seat
 * (`autopilotSwitchShown`). NOT optimistic — the checked state is the rosters
 * document's `autopilot`, re-read after every answer (the hook), so the
 * switch never shows a state the server did not store. No reason input
 * (Q66), no explanatory copy; a refusal renders VERBATIM.
 */
export function TeamAutopilotSwitch({ leagueId, teamId, on }: { leagueId: string; teamId: string; on: boolean }) {
  const autopilot = useCommishSetAutopilot(leagueId)
  return (
    <TeamAutopilotSwitchView
      on={on}
      pending={autopilot.isPending}
      refusal={autopilot.error?.message ?? null}
      onChange={(next) => {
        if (autopilot.isPending) return
        autopilot.submit({ teamId, on: next })
      }}
    />
  )
}

export function TeamAutopilotSwitchView({
  on,
  pending,
  refusal,
  onChange,
}: {
  on: boolean
  pending: boolean
  refusal: string | null
  onChange: (next: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex w-full flex-col gap-1.5" data-autopilot-switch={on ? 'on' : 'off'}>
      <div className="flex items-center gap-2">
        <Switch id={id} checked={on} disabled={pending} onCheckedChange={onChange} data-autopilot-toggle />
        <Label htmlFor={id} className="text-[12px] font-bold text-ink">
          {AUTOPILOT_SWITCH_LABEL}
        </Label>
        {pending && (
          <span role="status" className="text-[11px] font-semibold text-n-3" data-autopilot-pending>
            Saving…
          </span>
        )}
      </div>
      {/* The verb's refusal, VERBATIM — that text is the UX. */}
      {refusal && (
        <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink" data-autopilot-refusal>
          {refusal}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The commissioner's FAAB edit (M5 L.D2.13 — §15.4 `POST …/commish/faab`,
// 147's `commish_edit_faab`; D385)
// ---------------------------------------------------------------------------

/**
 * Set a team's FAAB balance — a face of OVERRIDE MODE like the roster tools
 * (rule (h)): the team page mounts it only while the one switch is on, for a
 * FAAB league. Any whole number from $0 up (above the budget is allowed — a
 * repair tool, D385(2)); no reason input (Q66). Not optimistic — the answer
 * is the truth, including "no change" and pending bids now above the new
 * balance.
 */
export function TeamFaabEdit({ leagueId, teamId, teamName, balance }: { leagueId: string; teamId: string; teamName: string; balance: number | null }) {
  const faab = useCommishFaab(leagueId)
  return (
    <TeamFaabEditView
      teamName={teamName}
      balance={balance}
      pending={faab.isPending}
      outcome={faab.data ?? null}
      refusal={faab.error?.message ?? null}
      onSave={(next) => {
        if (faab.isPending) return
        faab.submit({ teamId, balance: next })
      }}
    />
  )
}

type FaabOutcome = Pick<CommishEditFaabResult, 'no_changes' | 'faab_balance' | 'previous_balance' | 'pending_bids_above_balance'>

export function faabEditOutcome(result: FaabOutcome): string {
  if (result.no_changes) return `No change — the balance is already $${result.faab_balance}.`
  const was = result.previous_balance === null ? '' : ` (was $${result.previous_balance})`
  const n = result.pending_bids_above_balance
  const bids = n > 0 ? ` ${n} pending bid${n === 1 ? ' is' : 's are'} now above it — ${n === 1 ? 'it fails' : 'they fail'} at the run unless changed.` : ''
  return `Balance set to $${result.faab_balance}${was}.${bids}`
}

export function TeamFaabEditView({
  teamName,
  balance,
  pending,
  outcome,
  refusal,
  onSave,
}: {
  teamName: string
  balance: number | null
  pending: boolean
  outcome: FaabOutcome | null
  refusal: string | null
  onSave: (balance: number) => void
}) {
  const id = useId()
  const [text, setText] = useState(balance === null ? '' : String(balance))
  const next = /^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null
  return (
    <section className="flex flex-col gap-2 rounded-sm border-2 border-brand-strong bg-brand-soft p-2 sm:p-3" aria-label="FAAB balance" data-team-faab-edit>
      <div className="flex flex-col gap-2 rounded-sm border border-ink bg-white px-3 py-3">
        <label htmlFor={`${id}-faab`} className="text-[12px] font-bold text-ink">
          {`${teamName}’s FAAB balance`}
        </label>
        <p className="text-[11px] font-medium text-n-3">
          Now {balance === null ? 'not set' : `$${balance}`}. Set any whole-dollar amount — the manager is told, and the change shows in league activity.
        </p>
        {refusal && (
          <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink" data-faab-refusal>
            {refusal}
          </p>
        )}
        {!refusal && outcome && (
          <p role="status" className="text-[12px] font-semibold text-ink" data-faab-outcome>
            {faabEditOutcome(outcome)}
          </p>
        )}
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-bold">$</span>
          <Input id={`${id}-faab`} value={text} onChange={(e) => setText(e.target.value)} inputMode="numeric" className="h-btn-md w-24 px-2 text-[12px]" />
          <Button variant="blue" size="sm" disabled={pending || next === null} onClick={() => next !== null && onSave(next)} data-faab-save>
            {pending ? 'Saving…' : 'Set balance'}
          </Button>
        </span>
      </div>
    </section>
  )
}
