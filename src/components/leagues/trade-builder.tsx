'use client'

import { useMemo, useState } from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { RosterPlayer, RosterTeam } from '@/lib/leagues/api/rosters-service'
import { cn } from '@/lib/utils'

import { lockBadgeFor } from './lineup-editor-ops'
import { StatusBanner } from './status-banners'
import {
  builderLegs,
  builderProblem,
  dropsNeeded,
  dropsPromptCopy,
  isDeadlineRefusal,
  lockedAssetTitle,
  parseFaab,
  type BuilderLeg,
  type BuilderSides,
  plainRefusal,
} from './trades-ops'

/**
 * `trade-builder` — spec §16.2 ("two-sided selector w/ legality preview"),
 * §16.5.2's Trade lifecycle row, §13.3 — M5 task L.D3.7 (PROGRESS D419).
 *
 * Two columns — what the offering team gives, what it asks for — picked from
 * the two ROSTERS (the rosters read, never a client guess), plus FAAB when
 * the league allows it in trades, the team's own drops (E36) and a note.
 *
 * **The legality preview is the server's answer.** There is no dry-run door
 * to 148/151's `trade_check_internal`, so none is invented (F462 asks for
 * one): the offer is sent, and a refusal renders VERBATIM. When the sentence
 * says the offering team's roster would overflow, the drop picker opens and
 * says how many (`dropsNeeded`). When it says the trade deadline has passed,
 * the builder locks with that sentence — the deadline instant is the
 * server's (F452).
 *
 * A player whose game has started wears 🔒 with what that means under the
 * league's `trade_lock_behavior` (Q75 — `defer` waits, `reject` refuses);
 * he stays pickable — the verb decides.
 *
 * Also the COUNTER-OFFER form (`mode = 'counter'`): the teams are fixed, the
 * picks start from the offer turned around (`counterSeed`).
 *
 * Not optimistic; one `action_id` per send (the hooks'). No clock read.
 */

export interface TradeBuilderSend {
  fromTeamId: string
  toTeamId: string
  legs: BuilderLeg[]
  drops: string[]
  note: string
}

export interface TradeBuilderViewProps {
  mode: 'propose' | 'counter'
  teams: readonly RosterTeam[]
  /** The offering team. */
  fromTeamId: string
  /** A commissioner in override mode may offer for any team (TD5): the
   *  choices; null = the offering team is fixed (the viewer's own). */
  fromChoices: readonly { id: string; name: string }[] | null
  initial?: Partial<Pick<BuilderSides, 'toTeamId' | 'give' | 'get' | 'faabGive' | 'faabGet'>>
  allowFaab: boolean
  lockBehavior: string
  pending: boolean
  /** The server's refusal, verbatim (already `userFacingMessage`d). */
  refusal: string | null
  /** A deadline refusal seen on this page (any verb) — the builder locks. */
  deadlineRefusal: string | null
  /** The offer went in — the receiving team's name. */
  sentTo: string | null
  onFromTeam?: (teamId: string) => void
  onSend: (send: TradeBuilderSend) => void
  onClose: () => void
}

export function TradeBuilderView({
  mode,
  teams,
  fromTeamId,
  fromChoices,
  initial,
  allowFaab,
  lockBehavior,
  pending,
  refusal,
  deadlineRefusal,
  sentTo,
  onFromTeam,
  onSend,
  onClose,
}: TradeBuilderViewProps) {
  const [toTeamId, setToTeamId] = useState<string | null>(initial?.toTeamId && initial.toTeamId !== fromTeamId ? initial.toTeamId : null)
  const [give, setGive] = useState<string[]>([...(initial?.give ?? [])])
  const [get, setGet] = useState<string[]>([...(initial?.get ?? [])])
  const [faabGiveText, setFaabGiveText] = useState(initial?.faabGive ? String(initial.faabGive) : '')
  const [faabGetText, setFaabGetText] = useState(initial?.faabGet ? String(initial.faabGet) : '')
  const [drops, setDrops] = useState<string[]>([])
  const [showDrops, setShowDrops] = useState(false)
  const [note, setNote] = useState('')

  const from = teams.find((t) => t.team_id === fromTeamId) ?? null
  const to = toTeamId ? (teams.find((t) => t.team_id === toTeamId) ?? null) : null
  const partners = teams.filter((t) => t.team_id !== fromTeamId && t.status !== 'retired')

  const faabGive = allowFaab ? parseFaab(faabGiveText) : null
  const faabGet = allowFaab ? parseFaab(faabGetText) : null
  const faabValid = !Number.isNaN(faabGive ?? 0) && !Number.isNaN(faabGet ?? 0)
  // Picks that no longer sit on the roster (the rosters re-read) are left out.
  const giveNow = give.filter((id) => from?.roster.some((p) => p.player_id === id))
  const getNow = get.filter((id) => to?.roster.some((p) => p.player_id === id))
  const dropsNow = drops.filter((id) => from?.roster.some((p) => p.player_id === id) && !giveNow.includes(id))
  const problem = builderProblem({ toTeamId: toTeamId ?? undefined, give: giveNow, get: getNow, faabGive, faabGet, faabValid })

  // The server said the offering team overflows — open the picker with the count.
  const overflow = refusal ? dropsNeeded(refusal) : null
  const overflowIsMine = overflow !== null && from !== null && overflow.teamName === from.name
  const dropsOpen = showDrops || overflowIsMine || dropsNow.length > 0
  const locked = deadlineRefusal ?? (refusal && isDeadlineRefusal(refusal) ? refusal : null)

  if (sentTo) {
    return (
      <Card data-trade-builder="sent">
        <CardContent className="flex flex-col gap-2 px-card-pad py-3">
          <StatusBanner tone="accent">
            <strong>{mode === 'counter' ? `Counter-offer sent to ${sentTo}.` : `Offer sent to ${sentTo}.`}</strong>
          </StatusBanner>
          <p className="text-[12px] font-medium text-n-3">They’ll get a notification. It’s listed under Pending until they answer — you can call it off there.</p>
          <span>
            <Button variant="stroke" size="sm" onClick={onClose}>
              Done
            </Button>
          </span>
        </CardContent>
      </Card>
    )
  }

  const send = () => {
    if (problem || !toTeamId || locked) return
    onSend({
      fromTeamId,
      toTeamId,
      legs: builderLegs({ fromTeamId, toTeamId, give: giveNow, get: getNow, faabGive: faabGive ?? null, faabGet: faabGet ?? null }),
      drops: dropsNow,
      note,
    })
  }

  return (
    <Card data-trade-builder={mode}>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[12px]">
          {mode === 'counter' ? `Counter-offer to ${to?.name ?? 'the other team'}` : 'Propose a trade'}
          <span className="ml-auto">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
              Close
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-card-pad py-3">
        {locked && (
          <div className="flex flex-col gap-1 rounded-sm border border-ink bg-caution-soft px-3 py-2" role="status" data-trade-deadline-locked>
            <p className="text-[12px] font-bold">🔒 Trades are closed for the season.</p>
            {/* VERBATIM — the server names the week and the instant (F452). */}
            <p className="text-[11px] font-medium text-ink">{locked}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {fromChoices ? (
            <label className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
              Offering team (acting as commissioner)
              <Select value={fromTeamId} onValueChange={(v) => onFromTeam?.(v)}>
                <SelectTrigger className="h-btn-md px-2 text-[12px]" data-trade-from={fromTeamId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fromChoices.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : (
            <div className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
              Offering team
              <span className="flex h-btn-md items-center px-0.5 text-[12px] font-bold text-ink" data-trade-from={fromTeamId}>
                {from?.name ?? 'Your team'}
              </span>
            </div>
          )}
          <label className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
            Trade with
            <Select
              value={toTeamId ?? ''}
              disabled={mode === 'counter'}
              onValueChange={(v) => {
                setToTeamId(v)
                setGet([])
                setFaabGetText('')
              }}
            >
              <SelectTrigger className="h-btn-md px-2 text-[12px]" data-trade-to={toTeamId ?? ''}>
                <SelectValue placeholder="Pick a team" />
              </SelectTrigger>
              <SelectContent>
                {partners.map((t) => (
                  <SelectItem key={t.team_id} value={t.team_id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SideColumn
            title={`${from?.name ?? 'Your team'} gives`}
            side="give"
            roster={from?.roster ?? []}
            picked={giveNow}
            lockBehavior={lockBehavior}
            onToggle={(id) => setGive((g) => toggle(g, id))}
            faab={allowFaab ? { text: faabGiveText, onChange: setFaabGiveText, balance: from?.faab_balance ?? null } : null}
            empty="No players on this roster."
          />
          <SideColumn
            title={to ? `${to.name} gives` : 'They give'}
            side="get"
            roster={to?.roster ?? []}
            picked={getNow}
            lockBehavior={lockBehavior}
            onToggle={(id) => setGet((g) => toggle(g, id))}
            faab={allowFaab && to ? { text: faabGetText, onChange: setFaabGetText, balance: to.faab_balance } : null}
            empty={to ? 'No players on this roster.' : 'Pick a team to see its roster.'}
          />
        </div>

        <div className="flex flex-col gap-1.5" data-trade-drops={dropsOpen ? 'open' : 'closed'}>
          {dropsOpen ? (
            <>
              <p className={cn('text-[11px] font-bold', overflowIsMine ? 'text-ink' : 'text-n-3')} data-trade-drops-prompt={overflowIsMine ? overflow!.more : undefined}>
                {overflowIsMine ? dropsPromptCopy(overflow!.more) : 'Players to drop (only if your roster would be over its size) — dropped only if the trade goes through.'}
              </p>
              <DropPicker
                roster={(from?.roster ?? []).filter((p) => !giveNow.includes(p.player_id))}
                picked={dropsNow}
                lockBehavior={lockBehavior}
                onToggle={(id) => setDrops((d) => toggle(d, id))}
              />
            </>
          ) : (
            <span>
              <Button variant="ghost" size="sm" onClick={() => setShowDrops(true)} data-trade-drops-open>
                Drop players to make room…
              </Button>
            </span>
          )}
        </div>

        <label className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
          Note (optional)
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="A word to the other manager" className="h-btn-md px-2 text-[12px]" />
        </label>

        {refusal && !locked && (
          <div className="flex flex-col gap-1 rounded-sm border border-negative bg-negative-soft px-3 py-2" role="alert" data-trade-refusal>
            <p className="text-[12px] font-bold">The offer wasn’t sent.</p>
            {/* The server's sentence, its builder citations removed (R1244). */}
            <p className="text-[11px] font-medium text-ink">{plainRefusal(refusal)}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="blue" size="sm" shadow disabled={pending || problem !== null || locked !== null} onClick={send} data-trade-send>
            {pending ? 'Sending…' : mode === 'counter' ? 'Send counter-offer' : 'Send offer'}
          </Button>
          <span className="text-[10px] font-medium text-n-3">{problem ?? 'The league checks both rosters, the deadline and any FAAB when you send — its answer is what you see.'}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function toggle(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

function SideColumn({
  title,
  side,
  roster,
  picked,
  lockBehavior,
  onToggle,
  faab,
  empty,
}: {
  title: string
  side: 'give' | 'get'
  roster: readonly RosterPlayer[]
  picked: readonly string[]
  lockBehavior: string
  onToggle: (playerId: string) => void
  faab: { text: string; onChange: (text: string) => void; balance: number | null } | null
  empty: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-trade-side={side}>
      <p className="fs-overline text-[9px] text-n-3">{title}</p>
      {roster.length === 0 ? (
        <p className="rounded-sm border border-n-4 px-2 py-3 text-[11px] font-medium text-n-3">{empty}</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {roster.map((p) => (
            <PlayerPickRow key={p.player_id} player={p} checked={picked.includes(p.player_id)} lockBehavior={lockBehavior} onToggle={onToggle} />
          ))}
        </ul>
      )}
      {faab && (
        <label className="flex items-center gap-2 text-[11px] font-bold text-ink">
          FAAB $
          <Input
            value={faab.text}
            onChange={(e) => faab.onChange(e.target.value)}
            inputMode="numeric"
            aria-label={`${title}: FAAB dollars`}
            className="h-btn-sm w-20 px-2 text-[12px]"
            data-trade-faab={side}
          />
          {faab.balance !== null && <span className="text-[10px] font-medium text-n-3">${faab.balance} left</span>}
        </label>
      )}
    </div>
  )
}

/** One roster player as a pick — shared by the builder's columns, its drop
 *  picker and the accept-with-drops picker on a trade card. */
export function PlayerPickRow({
  player,
  checked,
  lockBehavior,
  onToggle,
}: {
  player: RosterPlayer
  checked: boolean
  lockBehavior: string
  onToggle: (playerId: string) => void
}) {
  const lock = lockBadgeFor(player.game_lock, true)
  const id = `pick-${player.player_id}`
  return (
    <li
      className={cn('flex items-center gap-2 rounded-sm border px-2 py-1', checked ? 'border-accent bg-accent-soft' : 'border-n-4 bg-white')}
      data-trade-pick={player.player_id}
      data-picked={checked || undefined}
    >
      <Checkbox id={id} checked={checked} onCheckedChange={() => onToggle(player.player_id)} aria-label={`Pick ${player.full_name}`} />
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
        <PositionBadge position={player.position} size="sm" />
        <span className="truncate text-[12px] font-bold text-ink">{player.full_name}</span>
        <span className="shrink-0 text-[10px] font-medium text-n-3">{player.nfl_team ?? '—'}</span>
      </label>
      {lock.locked && (
        <Badge variant="black" title={lockedAssetTitle(lockBehavior)} data-lock>
          🔒
        </Badge>
      )}
    </li>
  )
}

export function DropPicker({
  roster,
  picked,
  lockBehavior,
  onToggle,
}: {
  roster: readonly RosterPlayer[]
  picked: readonly string[]
  lockBehavior: string
  onToggle: (playerId: string) => void
}) {
  const sorted = useMemo(() => [...roster].sort((a, b) => a.position.localeCompare(b.position) || a.full_name.localeCompare(b.full_name)), [roster])
  if (sorted.length === 0) return <p className="text-[11px] font-medium text-n-3">No other players on this roster.</p>
  return (
    <ul className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2" data-drop-picker>
      {sorted.map((p) => (
        <PlayerPickRow key={p.player_id} player={p} checked={picked.includes(p.player_id)} lockBehavior={lockBehavior} onToggle={onToggle} />
      ))}
    </ul>
  )
}
