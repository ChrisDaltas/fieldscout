'use client'

import { userFacingMessage } from '@/lib/leagues/api/client-fetch'
import { useMemo, useState } from 'react'

import { leagueCardContext } from '@/components/players/player-card-context'
import { PlayerLink } from '@/components/players/player-link'
import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTradePreview, type UseTradePreview } from '@/hooks/use-trade-preview'
import type { RosterPlayer, RosterTeam } from '@/lib/leagues/api/rosters-service'
import { cn } from '@/lib/utils'

import { lockBadgeFor } from './lineup-editor-ops'
import { StatusBanner } from './status-banners'
import {
  builderDoor,
  builderGate,
  builderLegs,
  builderProblem,
  dropsNeeded,
  dropsNeededCopy,
  dropsPromptCopy,
  faabOverBalance,
  faabOverCopy,
  isDeadlineRefusal,
  lockedAssetTitle,
  NO_TRADE_PARTNER_COPY,
  noManagerCopy,
  parseFaab,
  rosterWords,
  type BuilderLeg,
  type BuilderSides,
} from './trades-ops'

/**
 * `trade-builder` — spec §16.2 ("two-sided selector w/ legality preview"),
 * §16.5.2's Trade lifecycle row, §13.3 — M5 tasks L.D3.7 (PROGRESS D419) and
 * L.D3.12 (D426).
 *
 * Two columns — what the offering team gives, what it asks for — picked from
 * the two ROSTERS (the rosters read, never a client guess), plus FAAB when
 * the league allows it in trades, the team's own drops (E36) and a note.
 *
 * **An offer the league would refuse cannot be built (L.D3.12 — Chris
 * 2026-09-29: "there is no such thing as trade that isn't legal").** As the
 * manager picks, the offer is checked with the league (`usePreview` →
 * migration 162's `trade_preview`, the verbs' own `trade_check_internal`):
 * Send is enabled only when it says the offer goes in. When the offering
 * team's roster would be over its size, the drop picker opens with how many
 * more to pick; the receiving team's own overflow is said (it picks its
 * drops when it accepts). A FAAB box above what the team has is refused
 * here, from the rosters read's balance (the preview rechecks it). A player
 * no longer on the named team is not in the roster list.
 *
 * A player whose game has started wears 🔒 (Q75, the rosters read's lock
 * view) and stays pickable — the lock is judged when the trade GOES THROUGH
 * (151's executor), not when it is offered (R1283). Picked, his row says what
 * will happen: under `defer` the trade waits for the week's last game (E35);
 * under `reject` it can't go through until the week's games are over.
 *
 * **Before migration 162 is pushed** (`unavailable`) the builder works as it
 * did (D419): the offer is sent and a refusal renders VERBATIM — when the
 * sentence says the offering team's roster would overflow the drop picker
 * opens (`dropsNeeded`), and a deadline refusal locks the builder. Those
 * refusals stay as the backstop after 162 too.
 *
 * Also the COUNTER-OFFER form (`mode = 'counter'`): the teams are fixed, the
 * picks start from the offer turned around (`counterSeed`).
 *
 * **Only a team with a manager can be offered a trade** (174 fix round, R1410
 * — PROGRESS D463): since the commissioner no longer answers for a team, an
 * offer to an open or orphaned seat could never be answered, so "Trade with"
 * lists only teams with a manager (`tradePartners`). A deep link toward a
 * team with no manager opens with nobody picked and says why; when no other
 * team has a manager the builder says so instead of offering a dead Send.
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
  leagueId: string
  mode: 'propose' | 'counter'
  teams: readonly RosterTeam[]
  /** The offering team — the viewer's own (174 / D463: the commissioner
   *  offers only for the team he manages, so there is no chooser). */
  fromTeamId: string
  initial?: Partial<Pick<BuilderSides, 'toTeamId' | 'give' | 'get' | 'faabGive' | 'faabGet'>> & { drops?: readonly string[] }
  allowFaab: boolean
  lockBehavior: string
  pending: boolean
  /** The server's refusal, RAW (parsed here; shown through `userFacingMessage`, D481). */
  refusal: string | null
  /** A deadline refusal seen on this page (any verb) — the builder locks. */
  deadlineRefusal: string | null
  /** The offer went in — the receiving team's name. */
  sentTo: string | null
  onSend: (send: TradeBuilderSend) => void
  onClose: () => void
  /** The league's answer as the offer is built (162); injected so a static
   *  render can hand it any answer. */
  usePreview?: UseTradePreview
}

export function TradeBuilderView({
  leagueId,
  mode,
  teams,
  fromTeamId,
  initial,
  allowFaab,
  lockBehavior,
  pending,
  refusal,
  deadlineRefusal,
  sentTo,
  onSend,
  onClose,
  usePreview = useTradePreview,
}: TradeBuilderViewProps) {
  // The door — partners, the team, the "they give" picks — is DERIVED from
  // the current team list every render (`builderDoor`: F554, R1410, R1420).
  // The trade center mounts the builder only once the rosters have answered
  // (R1419, `rostersGate`), and a live re-read can still change the list.
  const [pickedTo, setPickedTo] = useState<string | null>(null)
  const [pickedGet, setPickedGet] = useState<string[] | null>(null)
  const door = builderDoor({ mode, teams, fromTeamId, initial, pickedTo, pickedGet })
  const { partners, toTeamId, get, unanswerable } = door
  const [give, setGive] = useState<string[]>([...(initial?.give ?? [])])
  const [faabGiveText, setFaabGiveText] = useState(initial?.faabGive ? String(initial.faabGive) : '')
  const [faabGetText, setFaabGetText] = useState(initial?.faabGet ? String(initial.faabGet) : '')
  const [drops, setDrops] = useState<string[]>([...(initial?.drops ?? [])])
  const [showDrops, setShowDrops] = useState(false)
  const [note, setNote] = useState('')

  const from = teams.find((t) => t.team_id === fromTeamId) ?? null
  const to = toTeamId ? (teams.find((t) => t.team_id === toTeamId) ?? null) : null

  const faabGive = allowFaab ? parseFaab(faabGiveText) : null
  const faabGet = allowFaab ? parseFaab(faabGetText) : null
  const faabValid = !Number.isNaN(faabGive ?? 0) && !Number.isNaN(faabGet ?? 0)
  // Picks that no longer sit on the roster (the rosters re-read) are left out.
  const pickable = (team: RosterTeam | null, id: string) => team?.roster.some((r) => r.player_id === id) ?? false
  const giveNow = give.filter((id) => pickable(from, id))
  const getNow = get.filter((id) => pickable(to, id))
  const dropsNow = drops.filter((id) => pickable(from, id) && !giveNow.includes(id))
  const problem = builderProblem({ toTeamId: toTeamId ?? undefined, give: giveNow, get: getNow, faabGive, faabGet, faabValid })
  const faabProblem =
    from && from.faab_balance !== null && faabOverBalance(faabGive, from.faab_balance)
      ? faabOverCopy(from.name, from.faab_balance)
      : to && to.faab_balance !== null && faabOverBalance(faabGet, to.faab_balance)
        ? faabOverCopy(to.name, to.faab_balance)
        : null
  const locked = deadlineRefusal ?? (refusal && isDeadlineRefusal(refusal) ? refusal : null)
  const legs = toTeamId ? builderLegs({ fromTeamId, toTeamId, give: giveNow, get: getNow, faabGive: faabGive ?? null, faabGet: faabGet ?? null }) : []

  // THE LEAGUE'S ANSWER (162) — asked only for an offer that could be sent.
  const preview = usePreview(
    leagueId,
    !problem && !faabProblem && toTeamId && !locked && !sentTo ? { kind: 'offer', fromTeamId, toTeamId, legs, drops: dropsNow } : null,
  )
  const words = rosterWords(from?.name ?? null, true)
  const gate = builderGate({ problem, faabProblem, preview, fromWords: words, toName: to?.name ?? 'the other team' })

  // Before 162: the server said the offering team overflows — open the
  // picker with the count (the send-and-see path, D419).
  const overflow = refusal ? dropsNeeded(refusal) : null
  const overflowIsMine = overflow !== null && from !== null && overflow.teamName === from.name
  // R1286: the voluntary opener stays — the league allows extra drops.
  const dropsOpen = gate.checked ? gate.mustDrop > 0 || dropsNow.length > 0 || showDrops : showDrops || overflowIsMine || dropsNow.length > 0
  const dropsNeed = gate.checked ? gate.mustDrop : overflowIsMine ? overflow!.more : 0
  const dropsPrompt = gate.checked
    ? gate.mustDrop > 0
      ? dropsNeededCopy(gate.mustDrop, words)
      : 'Dropped only if the trade goes through.'
    : overflowIsMine
      ? dropsPromptCopy(overflow!.more)
      : 'Players to drop (only if your roster would be over its size) — dropped only if the trade goes through.'
  const gateTag = gate.failed ? 'failed' : gate.checked ? (gate.canSend ? 'ok' : preview.state === 'checking' ? 'checking' : 'blocked') : 'unchecked'

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

  // R1410: nobody to offer a trade to — said in words, no dead Send.
  if (door.noPartner) {
    return (
      <Card data-trade-builder="no-partner">
        <CardContent className="flex flex-col gap-2 px-card-pad py-3">
          <StatusBanner tone="neutral" className="text-n-3">
            {NO_TRADE_PARTNER_COPY}
          </StatusBanner>
          <span>
            <Button variant="stroke" size="sm" onClick={onClose}>
              Close
            </Button>
          </span>
        </CardContent>
      </Card>
    )
  }

  const send = () => {
    if (!gate.canSend || !toTeamId || locked) return
    onSend({ fromTeamId, toTeamId, legs, drops: dropsNow, note })
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
            <p className="text-[11px] font-medium text-ink">{userFacingMessage(locked)}</p>
          </div>
        )}

        {unanswerable && !toTeamId && (
          <p className="text-[11px] font-medium text-ink" role="status" data-trade-no-manager={unanswerable.team_id}>
            {noManagerCopy(unanswerable.name)}
          </p>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
            Offering team
            <span className="flex h-btn-md items-center px-0.5 text-[12px] font-bold text-ink" data-trade-from={fromTeamId}>
              {from?.name ?? 'Your team'}
            </span>
          </div>
          <label className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
            Trade with
            <Select
              value={toTeamId ?? ''}
              disabled={mode === 'counter'}
              onValueChange={(v) => {
                setPickedTo(v)
                setPickedGet([])
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
            leagueId={leagueId}
            title={`${from?.name ?? 'Your team'} gives`}
            side="give"
            roster={from?.roster ?? []}
            picked={giveNow}
            lockBehavior={lockBehavior}
            onToggle={(id) => setGive((g) => toggle(g, id))}
            faab={allowFaab ? { text: faabGiveText, onChange: setFaabGiveText, balance: from?.faab_balance ?? null, over: faabOverBalance(faabGive, from?.faab_balance ?? null) } : null}
            empty="No players on this roster."
          />
          <SideColumn
            leagueId={leagueId}
            title={to ? `${to.name} gives` : 'They give'}
            side="get"
            roster={to?.roster ?? []}
            picked={getNow}
            lockBehavior={lockBehavior}
            onToggle={(id) => setPickedGet((p) => toggle(p ?? get, id))}
            faab={allowFaab && to ? { text: faabGetText, onChange: setFaabGetText, balance: to.faab_balance, over: faabOverBalance(faabGet, to.faab_balance) } : null}
            empty={to ? 'No players on this roster.' : 'Pick a team to see its roster.'}
          />
        </div>

        <div className="flex flex-col gap-1.5" data-trade-drops={dropsOpen ? 'open' : 'closed'}>
          {dropsOpen ? (
            <>
              <p className={cn('text-[11px] font-bold', dropsNeed > 0 ? 'text-ink' : 'text-n-3')} data-trade-drops-prompt={dropsNeed > 0 ? dropsNeed : undefined}>
                {dropsPrompt}
              </p>
              <DropPicker
                leagueId={leagueId}
                roster={(from?.roster ?? []).filter((p) => !giveNow.includes(p.player_id))}
                picked={dropsNow}
                lockBehavior={lockBehavior}
                onToggle={(id) => setDrops((d) => toggle(d, id))}
              />
            </>
          ) : (
            <span>
              <Button variant="ghost" size="sm" onClick={() => setShowDrops(true)} data-trade-drops-open>
                Drop players…
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
            <p className="text-[11px] font-medium text-ink">{userFacingMessage(refusal)}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="blue" size="sm" shadow disabled={pending || !gate.canSend || locked !== null} onClick={send} data-trade-send>
            {pending ? 'Sending…' : mode === 'counter' ? 'Send counter-offer' : 'Send offer'}
          </Button>
          <span className={cn('text-[10px] font-medium', gateTag === 'blocked' || gateTag === 'failed' ? 'text-ink' : 'text-n-3')} data-trade-gate={gateTag} role={gateTag === 'failed' ? 'status' : undefined}>
            {gate.reason}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function toggle(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

function SideColumn({
  leagueId,
  title,
  side,
  roster,
  picked,
  lockBehavior,
  onToggle,
  faab,
  empty,
}: {
  leagueId: string
  title: string
  side: 'give' | 'get'
  roster: readonly RosterPlayer[]
  picked: readonly string[]
  lockBehavior: string
  onToggle: (playerId: string) => void
  faab: { text: string; onChange: (text: string) => void; balance: number | null; over: boolean } | null
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
            <PlayerPickRow key={p.player_id} leagueId={leagueId} player={p} checked={picked.includes(p.player_id)} lockBehavior={lockBehavior} onToggle={onToggle} />
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
            aria-invalid={faab.over || undefined}
            className={cn('h-btn-sm w-20 px-2 text-[12px]', faab.over && 'border-negative')}
            data-trade-faab={side}
            data-faab-over={faab.over || undefined}
          />
          {faab.balance !== null && <span className={cn('text-[10px] font-medium', faab.over ? 'text-negative-strong' : 'text-n-3')}>${faab.balance} left</span>}
        </label>
      )}
    </div>
  )
}

/** One roster player as a pick — shared by the builder's columns, its drop
 *  picker and the accept-with-drops picker on a trade card. */
export function PlayerPickRow({
  leagueId,
  player,
  checked,
  lockBehavior,
  onToggle,
}: {
  leagueId: string
  player: RosterPlayer
  checked: boolean
  lockBehavior: string
  onToggle: (playerId: string) => void
}) {
  const lock = lockBadgeFor(player.game_lock, true)
  // R1283: a started player is always pickable; once picked, his row says
  // what will happen under this league's rule (readable on a phone, where
  // the 🔒's title is not).
  const id = `pick-${player.player_id}`
  return (
    <li
      className={cn('flex items-center gap-2 rounded-sm border px-2 py-1', checked ? 'border-accent bg-accent-soft' : 'border-n-4 bg-white')}
      data-trade-pick={player.player_id}
      data-picked={checked || undefined}
    >
      <Checkbox id={id} checked={checked} onCheckedChange={() => onToggle(player.player_id)} aria-label={`Pick ${player.full_name}`} />
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-1.5">
        <PositionBadge position={player.position} size="sm" />
        {/* The name opens his card; the rest of the row still picks him. */}
        <PlayerLink playerId={player.player_id} name={player.full_name} context={leagueCardContext(leagueId)} className="text-[12px] font-bold text-ink" />
        <span className="shrink-0 text-[10px] font-medium text-n-3">{player.nfl_team ?? '—'}</span>
        {lock.locked && checked && (
          <span className="basis-full text-[10px] font-medium text-n-3" data-lock-note={lockBehavior}>
            {lockedAssetTitle(lockBehavior)}
          </span>
        )}
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
  leagueId,
  roster,
  picked,
  lockBehavior,
  onToggle,
}: {
  leagueId: string
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
        <PlayerPickRow key={p.player_id} leagueId={leagueId} player={p} checked={picked.includes(p.player_id)} lockBehavior={lockBehavior} onToggle={onToggle} />
      ))}
    </ul>
  )
}
