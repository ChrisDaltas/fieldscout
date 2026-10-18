'use client'

import { useId, useMemo, useState } from 'react'

import {
  ADD_NO_MATCH_COPY,
  ADD_SEARCH_HINT,
  ADD_SEARCH_MIN,
  AUTOPILOT_SWITCH_LABEL,
  TEAM_TOOLS_EMPTY_ROSTER_COPY,
  TEAM_TOOLS_INTRO,
  TEAM_TOOLS_TITLE,
  addCandidates,
  renameGate,
  renameOutcome,
  rosterBypassedCopy,
  rosterOutcome,
  type ToolOutcome,
} from '@/components/leagues/team-commish-ops'
import { faabEditOutcome } from '@/components/leagues/team-commish-tools'
import { MSwitch } from '@/components/mobile/trades/m-overlay'
import { useCommishSetAutopilot } from '@/hooks/use-commish-autopilot'
import { useCommishFaab } from '@/hooks/use-commish-faab'
import { useCommishMovePlayer } from '@/hooks/use-commish-move-player'
import { useCommishForceAddDrop } from '@/hooks/use-commish-roster'
import { useCommishRenameTeam } from '@/hooks/use-commish-team'
import { useDraftPool } from '@/hooks/use-draft-pool'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { TEAM_NAME_MAX } from '@/lib/leagues/team-name'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { posCode } from './team-ops'

/**
 * The commissioner's team tools in the mobile design language — the desktop
 * team page's set (`team-commish-tools.tsx`: rename, per-team autopilot, FAAB
 * edit, move / drop / add) on the SAME hooks and words (`team-commish-ops`),
 * restyled: b0 fields and pills on the section's b1 card, the mobile switch,
 * tinted notes. All of them are faces of the ONE override-mode switch (rule
 * (h)) — the section mounts them only while it is on. Not optimistic: what
 * shows after a save is the server's answer, a refusal verbatim. No reason
 * input anywhere (Q66).
 */

const FIELD = 'h-10 min-w-0 rounded-[12px] bg-m-b0 px-3 text-[14px] font-medium text-m-t1 outline-none placeholder:text-m-t5 focus:shadow-m-select disabled:opacity-50'
const PILL = 'flex h-8 flex-none items-center justify-center rounded-pill px-3 text-[13px] font-semibold disabled:opacity-40'
const PILL_QUIET = cn(PILL, 'bg-m-b0 text-m-t1 active:bg-m-b2h')
const PILL_BLUE = cn(PILL, 'bg-accent text-white active:bg-accent-strong')
const PILL_RED = cn(PILL, 'bg-m-gr text-m-tr')

const TONE: Record<ToolOutcome<string>['tone'], string> = {
  positive: 'bg-m-gg text-m-tg',
  caution: 'bg-m-go text-m-to',
  neutral: 'bg-m-b0 text-m-t2',
}

function Refusal({ text, marker }: { text: string; marker: string }) {
  return (
    <p role="alert" className="rounded-[12px] bg-m-gr px-3 py-2 text-[13px] font-medium text-m-tr" {...{ [marker]: '' }}>
      {text}
    </p>
  )
}

function Outcome({ said, extra, marker }: { said: ToolOutcome<string>; extra?: string | null; marker: string }) {
  return (
    <div role="status" className={cn('flex flex-col gap-1 rounded-[12px] px-3 py-2 text-[13px] font-medium', TONE[said.tone])} {...{ [marker]: said.branch }}>
      <span>{said.text}</span>
      {extra && <span className="text-[12px] font-medium text-m-t3">{extra}</span>}
    </div>
  )
}

function Saving() {
  return (
    <span role="status" className="text-[12px] font-semibold text-m-t3">
      Saving…
    </span>
  )
}

/** One tool's block inside the card, divided from the next by a b3 rule. */
function Block({ children, label, marker }: { children: React.ReactNode; label: string; marker: string }) {
  return (
    <section aria-label={label} className="flex flex-col gap-2 border-t border-m-b3 pt-3 first:border-t-0 first:pt-0" {...{ [marker]: '' }}>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Rename — the commissioner's arm (audited; offered only in override mode)
// ---------------------------------------------------------------------------

export function MCommishRename({ leagueId, teamId, teamName }: { leagueId: string; teamId: string; teamName: string }) {
  const id = useId()
  const rename = useCommishRenameTeam(leagueId)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(teamName)
  const gate = renameGate(draft)
  const said = rename.data ? renameOutcome(rename.data, true) : null
  const refusal = rename.error?.message ?? null

  return (
    <Block label="Team name" marker="data-m-rename">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-[14px] font-semibold">Team name</span>
          <span className="truncate text-[12px] font-medium text-m-t3">{teamName}</span>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => {
              rename.reset()
              setDraft(teamName)
              setOpen(true)
            }}
            className={PILL_QUIET}
            data-rename-open="commissioner"
          >
            Rename
          </button>
        )}
      </div>
      {open && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (gate.ok && !rename.isPending) rename.submit({ teamId, name: gate.name })
          }}
          data-rename-form="commissioner"
        >
          <label htmlFor={`${id}-name`} className="text-[12px] font-medium text-m-t3">
            New name — a commissioner rename is recorded and posted to the league.
          </label>
          <input
            id={`${id}-name`}
            value={draft}
            maxLength={TEAM_NAME_MAX}
            autoComplete="off"
            disabled={rename.isPending}
            aria-describedby={gate.ok ? undefined : `${id}-gate`}
            onChange={(e) => setDraft(e.target.value)}
            className={FIELD}
            data-rename-input
          />
          {!gate.ok && (
            <span id={`${id}-gate`} className="text-[12px] font-medium text-m-t3" data-rename-gate>
              {gate.why}
            </span>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={!gate.ok || rename.isPending} className={PILL_BLUE} data-rename-save>
              {rename.isPending ? 'Saving…' : 'Save name'}
            </button>
            <button type="button" disabled={rename.isPending} onClick={() => setOpen(false)} className={PILL_QUIET}>
              Close
            </button>
          </div>
          {refusal && <Refusal text={refusal} marker="data-rename-refusal" />}
          {!refusal && said && <Outcome said={said} marker="data-rename-outcome" />}
        </form>
      )}
    </Block>
  )
}

// ---------------------------------------------------------------------------
// Autopilot — the per-team switch (an unmanaged seat only)
// ---------------------------------------------------------------------------

export function MAutopilot({ leagueId, teamId, on }: { leagueId: string; teamId: string; on: boolean }) {
  const autopilot = useCommishSetAutopilot(leagueId)
  const refusal = autopilot.error?.message ?? null
  return (
    <Block label={AUTOPILOT_SWITCH_LABEL} marker="data-m-autopilot">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={autopilot.isPending}
        onClick={() => {
          if (!autopilot.isPending) autopilot.submit({ teamId, on: !on })
        }}
        className="flex items-center gap-[10px] text-left disabled:opacity-60"
        data-autopilot-switch={on ? 'on' : 'off'}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-[14px] font-semibold">{AUTOPILOT_SWITCH_LABEL}</span>
          {autopilot.isPending && <Saving />}
        </span>
        <MSwitch on={on} size="md" />
      </button>
      {refusal && <Refusal text={refusal} marker="data-autopilot-refusal" />}
    </Block>
  )
}

// ---------------------------------------------------------------------------
// FAAB balance (a FAAB league)
// ---------------------------------------------------------------------------

export function MFaabEdit({ leagueId, teamId, teamName, balance }: { leagueId: string; teamId: string; teamName: string; balance: number | null }) {
  const faab = useCommishFaab(leagueId)
  return (
    <MFaabEditForm
      // The box re-seeds when the stored balance changes (R1224); the
      // outcome lives in the hook, so it survives.
      key={balance ?? 'none'}
      teamName={teamName}
      balance={balance}
      pending={faab.isPending}
      outcome={faab.data ? faabEditOutcome(faab.data) : null}
      refusal={faab.error?.message ?? null}
      onSave={(next) => {
        if (!faab.isPending) faab.submit({ teamId, balance: next })
      }}
    />
  )
}

function MFaabEditForm({
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
  outcome: string | null
  refusal: string | null
  onSave: (balance: number) => void
}) {
  const id = useId()
  const [text, setText] = useState(balance === null ? '' : String(balance))
  const next = /^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null
  return (
    <Block label="FAAB balance" marker="data-m-faab">
      <label htmlFor={`${id}-faab`} className="text-[14px] font-semibold">
        {`${teamName}’s FAAB balance`}
      </label>
      <p className="text-[12px] font-medium text-m-t3">
        Now {balance === null ? 'not set' : `$${balance}`}. Set any whole-dollar amount — the manager is told, and the change shows in league activity.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-semibold text-m-t3">$</span>
        <input id={`${id}-faab`} value={text} onChange={(e) => setText(e.target.value)} inputMode="numeric" disabled={pending} className={cn(FIELD, 'w-24 tabular-nums')} />
        <button type="button" disabled={pending || next === null} onClick={() => next !== null && onSave(next)} className={PILL_BLUE} data-faab-save>
          {pending ? 'Saving…' : 'Set balance'}
        </button>
      </div>
      {refusal && <Refusal text={refusal} marker="data-faab-refusal" />}
      {!refusal && outcome && (
        <p role="status" className="text-[13px] font-medium text-m-t2" data-faab-outcome>
          {outcome}
        </p>
      )}
    </Block>
  )
}

// ---------------------------------------------------------------------------
// Roster tools — move a player to another team, drop one, add a free agent
// ---------------------------------------------------------------------------

export function MRosterTools({
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
  const id = useId()
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const move = useCommishMovePlayer(leagueId)
  const addDrop = useCommishForceAddDrop(leagueId)
  const [last, setLast] = useState<'move' | 'roster' | null>(null)
  const [search, setSearch] = useState('')
  const searching = search.trim().length >= ADD_SEARCH_MIN
  const players = useDraftPool(searching ? search : '', '')
  const candidates = useMemo(() => addCandidates(players.data ?? [], heldPlayerIds), [players.data, heldPlayerIds])
  const pending = move.isPending || addDrop.isPending
  const spoke = last === 'move' ? move : last === 'roster' ? addDrop : null
  const refusal = spoke?.error?.message ?? null
  const said = spoke?.data ? rosterOutcome(spoke.data) : null
  const bypassed = spoke?.data && !spoke.data.no_changes ? rosterBypassedCopy(spoke.data.bypassed) : null

  return (
    <Block label={TEAM_TOOLS_TITLE} marker="data-m-roster-tools">
      <h3 className="text-[14px] font-semibold">{TEAM_TOOLS_TITLE}</h3>
      <p className="text-[12px] font-medium text-m-t3">{TEAM_TOOLS_INTRO}</p>
      {refusal && <Refusal text={refusal} marker="data-tools-refusal" />}
      {!refusal && said && <Outcome said={said} extra={bypassed} marker="data-tools-outcome" />}
      {pending && <Saving />}

      {roster.length === 0 ? (
        <p className="text-[13px] font-medium text-m-t3" data-empty="commish-roster">
          {TEAM_TOOLS_EMPTY_ROSTER_COPY}
        </p>
      ) : (
        <ul className="flex flex-col" data-tools-roster>
          {roster.map((player) => (
            <ToolRow
              key={player.player_id}
              player={player}
              otherTeams={otherTeams}
              pending={pending}
              onOpen={() => openPlayer(player.player_id, leagueId)}
              onMove={(toTeamId) => {
                if (pending) return
                addDrop.reset()
                setLast('move')
                move.submit({ playerId: player.player_id, fromTeamId: teamId, toTeamId })
              }}
              onDrop={() => {
                if (pending) return
                move.reset()
                setLast('roster')
                addDrop.submit({ teamId, dropPlayerId: player.player_id })
              }}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 pt-1" data-tools-add>
        <label htmlFor={`${id}-add`} className="text-[12px] font-semibold text-m-t3">
          {`Add a player to ${teamName}`}
        </label>
        <input
          id={`${id}-add`}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players by name"
          autoComplete="off"
          disabled={pending}
          className={FIELD}
          data-add-search
        />
        {!searching ? (
          <p className="text-[12px] font-medium text-m-t3">{ADD_SEARCH_HINT}</p>
        ) : players.isPending ? (
          <div className="flex flex-col gap-1.5" aria-busy="true" data-skeleton="add-candidates">
            <div className="h-9 rounded-[10px] bg-m-b0" />
            <div className="h-9 rounded-[10px] bg-m-b0" />
          </div>
        ) : players.isError ? (
          <div role="alert" className="flex items-center gap-2 rounded-[12px] bg-m-gr px-3 py-2" data-add-problem>
            <p className="min-w-0 flex-1 text-[13px] font-medium text-m-tr">Couldn’t search players — this is a failed read, not an empty result.</p>
            <button type="button" onClick={() => void players.refetch()} className={PILL_QUIET}>
              Retry
            </button>
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-[12px] font-medium text-m-t3" data-empty="add-candidates">
            {ADD_NO_MATCH_COPY}
          </p>
        ) : (
          <ul className="flex flex-col" data-add-candidates>
            {candidates.map((c) => (
              <li key={c.id} className="flex items-center gap-2 border-b border-m-b3 py-2 last:border-b-0">
                <button type="button" onClick={() => openPlayer(c.id, leagueId)} className="flex min-w-0 flex-1 flex-col gap-px text-left">
                  <span className="truncate text-[14px] font-semibold">{c.full_name}</span>
                  <span className="truncate text-[11px] font-medium text-m-t3">{[posCode(c.position), c.team].filter(Boolean).join(' · ')}</span>
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (pending) return
                    move.reset()
                    setLast('roster')
                    addDrop.submit({ teamId, addPlayerId: c.id })
                  }}
                  className={PILL_QUIET}
                  data-add-player={c.id}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Block>
  )
}

function ToolRow({
  player,
  otherTeams,
  pending,
  onOpen,
  onMove,
  onDrop,
}: {
  player: RosterPlayer
  otherTeams: readonly { id: string; name: string }[]
  pending: boolean
  onOpen: () => void
  onMove: (toTeamId: string) => void
  onDrop: () => void
}) {
  const [target, setTarget] = useState('')
  return (
    <li className="flex flex-col gap-2 border-b border-m-b3 py-[10px] last:border-b-0" data-tools-player={player.player_id}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col gap-px text-left">
          <span className="truncate text-[14px] font-semibold">{player.full_name}</span>
          <span className="truncate text-[11px] font-medium text-m-t3">{[posCode(player.position), player.nfl_team].filter(Boolean).join(' · ')}</span>
        </button>
        <button type="button" disabled={pending} onClick={onDrop} className={PILL_RED} data-drop-player>
          Drop
        </button>
      </div>
      {otherTeams.length > 0 && (
        <div className="flex items-center gap-2">
          {/* The handoff's native select look (§2.6: 32px pill, b2 → b0 on
              this card, 13/600, the native arrow kept). */}
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={pending}
            aria-label={`Move ${player.full_name} to`}
            className="h-8 min-w-0 flex-1 cursor-pointer rounded-pill border-0 bg-m-b0 px-[10px] text-[13px] font-semibold text-m-t1 outline-none focus:shadow-m-select disabled:opacity-50"
            data-move-target
          >
            <option value="">Move to…</option>
            {otherTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={pending || target === ''} onClick={() => target && onMove(target)} className={PILL_QUIET} data-move-player>
            Move
          </button>
        </div>
      )}
    </li>
  )
}
