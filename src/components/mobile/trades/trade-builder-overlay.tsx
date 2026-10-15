'use client'

import { useMemo, useState } from 'react'

import { formatInstantWithDate, lockBadgeFor } from '@/components/leagues/lineup-editor-ops'
import {
  builderDoor,
  builderGate,
  builderLegs,
  builderProblem,
  counterSeed,
  DEADLINE_PASSED_TITLE,
  deadlinePassedCopy,
  dropsNeededCopy,
  faabOverBalance,
  faabOverCopy,
  isDeadlineRefusal,
  lockedAssetTitle,
  NO_TRADE_PARTNER_COPY,
  noManagerCopy,
  parseFaab,
  rosterWords,
} from '@/components/leagues/trades-ops'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { useAuth } from '@/hooks/use-auth'
import type { LeagueDetail } from '@/hooks/use-league'
import { useMobileTeamPlayerAges } from '@/hooks/use-mobile-team-player-ages'
import { usePlayersByIds } from '@/hooks/use-players-by-ids'
import { useProposeTrade } from '@/hooks/use-propose-trade'
import { useRostersLive } from '@/hooks/use-rosters'
import { useStandings } from '@/hooks/use-standings'
import { useTradeAction } from '@/hooks/use-trade-action'
import { tradeDeadlinePassed, useTradeDeadline } from '@/hooks/use-trade-deadline'
import { useTradePreview } from '@/hooks/use-trade-preview'
import { toast } from '@/hooks/use-toast'
import { rawErrorText, userFacingMessage } from '@/lib/leagues/api/client-fetch'
import type { RosterPlayer, RosterTeam } from '@/lib/leagues/api/rosters-service'
import type { TradeView } from '@/lib/leagues/api/trades-service'
import { cn } from '@/lib/utils'

import { TeamAvatar } from '@/components/mobile/league/team/team-avatar'
import { ageOn, byPositionOrder, ord, posCode, recordText, shortName, teamOrder } from '@/components/mobile/league/team/team-ops'

import { MOverlay, MOverlayScroll, MSwitch } from './m-overlay'
import { CloseButton, FaabDisc, ToggleRow } from './trade-ui'
import { managerOf, sidesSummary } from './trades-mobile-ops'

/**
 * "Propose a trade" — the mobile trade builder (handoff League › Team §2.5
 * pick step, §2.6 review step), on the app's real trade machinery: the
 * rosters read for both columns, `builderDoor` for who can be offered a
 * trade (teams with a manager), the league's legality answer (162's
 * `trade_preview`, `builderGate`) gating Send, the offering team's drops
 * when its roster would overflow (E36), FAAB legs when the league allows
 * them, the deadline (`useTradeDeadline`), and `useProposeTrade` — or
 * `useTradeAction`'s counter for a counter-offer (`counterSeed`). Nothing
 * here decides legality; an offer the league would refuse can't be sent.
 *
 * App-only parts kept in the handoff's look: FAAB boxes under each column,
 * the drop picker, a note, the legality line. Not built (no backend): the
 * "Offer expires in" choice and "Send a direct message".
 */
export interface TradeBuilderOverlayProps {
  leagueId: string
  detail: LeagueDetail
  mode: 'propose' | 'counter'
  /** propose: the team the door points at, and the players asked for. */
  initialTo?: string | null
  initialGet?: readonly string[]
  /** counter: the offer being countered. */
  counterOf?: TradeView | null
  onClose: () => void
}

export function TradeBuilderOverlay(props: TradeBuilderOverlayProps) {
  const { leagueId, detail, mode, counterOf = null, onClose } = props
  const { user } = useAuth()
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const fromTeamId = mode === 'counter' && counterOf ? counterOf.recipient.team_id : myTeamId
  const rosters = useRostersLive(leagueId)
  const deadline = useTradeDeadline(leagueId)
  const pastDeadline = tradeDeadlinePassed(deadline.data)

  let body: React.ReactNode
  if (!fromTeamId) {
    body = <Notice text="You don’t manage a team in this league, so you can’t offer trades." />
  } else if (pastDeadline && deadline.data?.state === 'known') {
    const tz = detail.settings.draft.time_zone ?? null
    body = <Notice title={DEADLINE_PASSED_TITLE} text={deadlinePassedCopy(deadline.data.view, (iso) => formatInstantWithDate(iso, tz).local)} />
  } else if (!rosters.data) {
    body = rosters.isError ? (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" role="alert">
        <p className="text-[14px] font-medium text-m-t3">Couldn’t load the league’s rosters, so the trade builder can’t open.</p>
        <button type="button" onClick={() => void rosters.refetch()} className="h-9 rounded-pill bg-m-b2 px-4 text-[13px] font-semibold">
          Retry
        </button>
      </div>
    ) : (
      <div className="flex flex-col gap-2 px-4 pt-2" aria-busy="true">
        <div className="h-8 w-3/4 rounded-pill bg-m-b1" />
        <div className="grid grid-cols-2 gap-[10px] pt-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-[62px] rounded-[12px] bg-m-b1" />
          ))}
        </div>
      </div>
    )
  } else {
    return (
      <BuilderBody
        {...props}
        fromTeamId={fromTeamId}
        myTeamId={myTeamId}
        teams={rosters.data.teams}
        initial={
          mode === 'counter' && counterOf
            ? counterSeed(counterOf)
            : { toTeamId: props.initialTo ?? undefined, get: [...(props.initialGet ?? [])] }
        }
        evaluatedAt={deadline.data?.state === 'known' ? deadline.data.view.evaluated_at : null}
      />
    )
  }

  return (
    <MOverlay label="Propose a trade" onClose={onClose}>
      <TopBar onClose={onClose} />
      <MOverlayScroll>{body}</MOverlayScroll>
    </MOverlay>
  )
}

function TopBar({ onClose, disabled }: { onClose: () => void; disabled?: boolean }) {
  return (
    <div className="flex h-12 flex-none items-center gap-2 px-3">
      <CloseButton onClick={onClose} filled disabled={disabled} />
      <h1 className="min-w-0 flex-1 text-center text-[16px] font-semibold">Propose a trade</h1>
      <span className="size-9 flex-none" aria-hidden />
    </div>
  )
}

function Notice({ title, text }: { title?: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center" role="status">
      {title && <p className="text-[15px] font-semibold">{title}</p>}
      <p className="text-[14px] font-medium text-m-t3">{text}</p>
    </div>
  )
}

function toggle(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

function BuilderBody({
  leagueId,
  detail,
  mode,
  counterOf = null,
  onClose,
  fromTeamId,
  myTeamId,
  teams,
  initial,
  evaluatedAt,
}: TradeBuilderOverlayProps & {
  fromTeamId: string
  /** The viewer's team — its avatar is always the accent blue. */
  myTeamId: string | null
  teams: readonly RosterTeam[]
  initial: { toTeamId?: string; get?: readonly string[]; give?: readonly string[]; faabGive?: number | null; faabGet?: number | null }
  evaluatedAt: string | null
}) {
  const settings = detail.settings
  const allowFaab = settings.allow_faab_in_trades && settings.waiver_type === 'faab'
  const allowFuture = settings.allow_future_considerations
  const lockBehavior = settings.trade_lock_behavior
  const order = useMemo(() => teamOrder(detail.teams), [detail.teams])
  const standings = useStandings(leagueId)
  const propose = useProposeTrade(leagueId)
  const act = useTradeAction(leagueId)
  const mutation = mode === 'counter' ? act : propose

  const [step, setStep] = useState<'pick' | 'review'>('pick')
  const [pickedTo, setPickedTo] = useState<string | null>(null)
  const [pickedGet, setPickedGet] = useState<string[] | null>(null)
  const door = builderDoor({ mode, teams, fromTeamId, initial, pickedTo, pickedGet })
  const { partners, toTeamId, get, unanswerable } = door
  const [give, setGive] = useState<string[]>([...(initial.give ?? [])])
  const [faabGiveText, setFaabGiveText] = useState(initial.faabGive ? String(initial.faabGive) : '')
  const [faabGetText, setFaabGetText] = useState(initial.faabGet ? String(initial.faabGet) : '')
  const [drops, setDrops] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [hide, setHide] = useState(false)
  const [showDrops, setShowDrops] = useState(false)
  const [deadlineRefusal, setDeadlineRefusal] = useState<string | null>(null)

  const from = teams.find((t) => t.team_id === fromTeamId) ?? null
  const to = toTeamId ? (teams.find((t) => t.team_id === toTeamId) ?? null) : null
  const pickable = (team: RosterTeam | null, id: string) => team?.roster.some((r) => r.player_id === id) ?? false
  const giveNow = give.filter((id) => pickable(from, id))
  const getNow = get.filter((id) => pickable(to, id))
  const dropsNow = drops.filter((id) => pickable(from, id) && !giveNow.includes(id))
  const faabGive = allowFaab ? parseFaab(faabGiveText) : null
  const faabGet = allowFaab ? parseFaab(faabGetText) : null
  const faabValid = !Number.isNaN(faabGive ?? 0) && !Number.isNaN(faabGet ?? 0)
  const problem = builderProblem({ toTeamId: toTeamId ?? undefined, give: giveNow, get: getNow, faabGive, faabGet, faabValid })
  const faabProblem =
    from && from.faab_balance !== null && faabOverBalance(faabGive, from.faab_balance)
      ? faabOverCopy(from.name, from.faab_balance)
      : to && to.faab_balance !== null && faabOverBalance(faabGet, to.faab_balance)
        ? faabOverCopy(to.name, to.faab_balance)
        : null
  const refusal = mutation.isError ? (rawErrorText(mutation.error) ?? 'The offer was refused.') : null
  const locked = deadlineRefusal ?? (refusal && isDeadlineRefusal(refusal) ? refusal : null)
  const legs = toTeamId ? builderLegs({ fromTeamId, toTeamId, give: giveNow, get: getNow, faabGive: faabGive ?? null, faabGet: faabGet ?? null }) : []
  const preview = useTradePreview(
    leagueId,
    !problem && !faabProblem && toTeamId && !locked ? { kind: 'offer', fromTeamId, toTeamId, legs, drops: dropsNow } : null,
  )
  const words = rosterWords(from?.name ?? null, true)
  const gate = builderGate({ problem, faabProblem, preview, fromWords: words, toName: to?.name ?? 'the other team' })

  // The handoff's "both sides" rule, over the league's: each side gives a
  // player or FAAB — one-sided only when the league allows future
  // considerations (148's check).
  const mineN = giveNow.length + (faabGive && faabGive > 0 ? 1 : 0)
  const theirsN = getNow.length + (faabGet && faabGet > 0 ? 1 : 0)
  const ready = toTeamId !== null && faabValid && !faabProblem && ((mineN > 0 && theirsN > 0) || (allowFuture && mineN + theirsN > 0))
  const count = giveNow.length + getNow.length

  const fromRoster = useMemo(() => byPositionOrder(from?.roster ?? []), [from])
  const toRoster = useMemo(() => byPositionOrder(to?.roster ?? []), [to])
  const allIds = useMemo(() => [...fromRoster, ...toRoster].map((p) => p.player_id), [fromRoster, toRoster])
  const ages = useMobileTeamPlayerAges(allIds)
  const identity = usePlayersByIds(step === 'review' ? [...giveNow, ...getNow] : [])
  const rowOf = (teamId: string) => standings.data?.standings.find((r) => r.team_id === teamId) ?? null
  const toManager = toTeamId ? managerOf(detail, toTeamId) : null
  const mustDrop = gate.checked ? gate.mustDrop : 0
  const dropsOpen = mustDrop > 0 || dropsNow.length > 0 || showDrops

  const close = () => {
    if (mutation.isPending) return
    onClose()
  }

  const send = () => {
    if (!gate.canSend || !toTeamId || locked || mutation.isPending) return
    const onError = (error: Error) => {
      const text = rawErrorText(error) ?? error.message
      if (isDeadlineRefusal(text)) setDeadlineRefusal(text)
    }
    const done = () => {
      toast({ title: `Trade proposal sent to ${toManager ? `@${toManager}` : (to?.name ?? 'the other team')}` })
      onClose()
    }
    if (mode === 'counter' && counterOf) {
      act.submitAsync({ tradeId: counterOf.id, op: 'counter', legs, drops: dropsNow, note }).then(done, onError)
      return
    }
    propose.submitAsync({ fromTeamId, toTeamId, legs, drops: dropsNow, note }).then(done, onError)
  }

  const head = (team: RosterTeam | null, n: 1 | 2) =>
    team ? (
      <div className="flex min-w-0 items-center gap-2">
        <TeamAvatar teamId={team.team_id} name={team.name} teamIds={order} myTeamId={myTeamId} size={28} fontSize={11} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-semibold">{team.name}</span>
          <span className="truncate text-[11px] font-medium text-m-t3">
            {rowOf(team.team_id) ? `${recordText(rowOf(team.team_id)!)} · ${ord(rowOf(team.team_id)!.rank)}` : ''}
          </span>
        </span>
      </div>
    ) : (
      <span className="text-[13px] font-semibold text-m-t3" data-head={n}>
        Pick a team
      </span>
    )

  if (door.noPartner) {
    return (
      <MOverlay label="Propose a trade" onClose={close}>
        <TopBar onClose={close} />
        <Notice text={NO_TRADE_PARTNER_COPY} />
      </MOverlay>
    )
  }

  if (step === 'pick') {
    return (
      <MOverlay label="Propose a trade" onClose={close}>
        <TopBar onClose={close} />
        <p className="flex-none px-4 pb-[10px] text-[13px] font-medium text-m-t3">Pick players from both rosters</p>
        <div className="flex flex-none gap-1.5 overflow-x-auto px-4 pb-3 scrollbar-none" role="group" aria-label="Trade with">
          {(mode === 'counter' ? partners.filter((t) => t.team_id === toTeamId) : partners).map((t) => {
            const on = t.team_id === toTeamId
            return (
              <button
                key={t.team_id}
                type="button"
                aria-pressed={on}
                disabled={mode === 'counter'}
                onClick={() => {
                  if (on) return
                  setPickedTo(t.team_id)
                  setPickedGet([])
                  setFaabGetText('')
                }}
                className={cn('flex h-8 flex-none items-center gap-1.5 whitespace-nowrap rounded-pill pl-1 pr-3 text-[12px] font-semibold', on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1')}
              >
                <TeamAvatar teamId={t.team_id} name={t.name} teamIds={order} myTeamId={myTeamId} size={24} fontSize={10} className={on ? 'ring-1 ring-on-ink-border' : undefined} />
                {t.name}
              </button>
            )
          })}
        </div>
        {unanswerable && !toTeamId && <p className="flex-none px-4 pb-2 text-[12px] font-medium text-m-t3">{noManagerCopy(unanswerable.name)}</p>}
        <div className="grid flex-none grid-cols-2 gap-[10px] px-4 pb-2">
          {head(from, 1)}
          {head(to, 2)}
        </div>
        <MOverlayScroll className="grid grid-cols-2 content-start gap-[10px] px-4 pb-4">
          <div className="flex min-w-0 flex-col gap-1.5" data-trade-column="mine">
            {fromRoster.map((p) => (
              <Tile key={p.player_id} p={p} on={giveNow.includes(p.player_id)} age={ageOn(ages.birthById.get(p.player_id), evaluatedAt)} onToggle={() => setGive((g) => toggle(g, p.player_id))} />
            ))}
            {fromRoster.length === 0 && <p className="py-4 text-center text-[12px] font-medium text-m-t3">No players on this roster.</p>}
            {allowFaab && <FaabBox label="You send" text={faabGiveText} onChange={setFaabGiveText} balance={from?.faab_balance ?? null} over={faabOverBalance(faabGive, from?.faab_balance ?? null)} />}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5" data-trade-column="theirs">
            {toRoster.map((p) => (
              <Tile key={p.player_id} p={p} on={getNow.includes(p.player_id)} age={ageOn(ages.birthById.get(p.player_id), evaluatedAt)} onToggle={() => setPickedGet(toggle(pickedGet ?? get, p.player_id))} />
            ))}
            {!to && <p className="py-4 text-center text-[12px] font-medium text-m-t3">Pick a team to see its roster.</p>}
            {to && toRoster.length === 0 && <p className="py-4 text-center text-[12px] font-medium text-m-t3">No players on this roster.</p>}
            {allowFaab && to && <FaabBox label="They send" text={faabGetText} onChange={setFaabGetText} balance={to.faab_balance} over={faabOverBalance(faabGet, to.faab_balance)} />}
          </div>
        </MOverlayScroll>
        <div className="flex flex-none flex-col gap-[10px] border-t border-m-b3 bg-m-b0 px-4 pb-[max(28px,env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold">Trade proposal</span>
            {count > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-pill bg-accent px-1.5 text-[11px] font-semibold text-white tabular-nums">{count}</span>
            )}
            <span className="min-w-0 flex-1 truncate text-right text-[12px] font-medium text-m-t3">
              {ready ? sidesSummary(giveNow.length, faabGive, getNow.length, faabGet) : faabProblem ?? (faabValid ? 'Pick players on both sides' : 'FAAB is whole dollars.')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => (ready ? setStep('review') : toast({ title: 'Pick at least one player from each team' }))}
            aria-disabled={!ready}
            className={cn('h-12 rounded-pill text-[15px] font-semibold', ready ? 'bg-accent text-white' : 'bg-m-b3s text-m-t3')}
            data-view-proposal={ready ? 'ready' : 'not-ready'}
          >
            View proposal
          </button>
        </div>
      </MOverlay>
    )
  }

  // ---- Review step ----
  const name = (team: RosterTeam | null, n: 1 | 2) => (hide ? `Team ${n}` : (team?.name ?? 'Team'))
  const player = (id: string, team: RosterTeam | null): RosterPlayer | null => team?.roster.find((r) => r.player_id === id) ?? null
  const chips = (ids: readonly string[], team: RosterTeam | null, faab: number | null) => (
    <>
      {ids.map((id) => {
        const p = player(id, team)
        if (!p) return null
        return (
          <div key={id} className="flex min-w-0 items-center gap-2 rounded-[12px] bg-m-b1 p-2">
            <MHeadshot player={{ id, full_name: p.full_name, team: p.nfl_team, position: p.position, headshot_url: identity.playerById.get(id)?.headshot_url ?? null }} size={30} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-semibold">{shortName(p.full_name, p.position)}</span>
              <span className={cn('text-[10px] font-semibold', posTextClass(p.position))}>
                {posCode(p.position)} · {p.nfl_team ?? 'FA'}
              </span>
            </span>
          </div>
        )
      })}
      {faab !== null && faab > 0 && (
        <div className="flex min-w-0 items-center gap-2 rounded-[12px] bg-m-b1 p-2">
          <FaabDisc size={30} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-semibold">${faab}</span>
            <span className="text-[10px] font-semibold text-m-t3">FAAB</span>
          </span>
        </div>
      )}
    </>
  )
  const side = (team: RosterTeam | null, n: 1 | 2, receives: { ids: string[]; faab: number | null; team: RosterTeam | null }, sends: { ids: string[]; faab: number | null; team: RosterTeam | null }) => (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {team && <TeamAvatar teamId={team.team_id} name={team.name} teamIds={order} myTeamId={myTeamId} size={26} fontSize={11} label={hide ? String(n) : undefined} />}
        <span className="truncate text-[14px] font-semibold">{name(team, n)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-positive-strong">Receives</span>
          {chips(receives.ids, receives.team, receives.faab)}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-negative-strong">Sends</span>
          {chips(sends.ids, sends.team, sends.faab)}
        </div>
      </div>
    </section>
  )
  const lockedPicked = [...giveNow, ...getNow].some((id) => {
    const p = player(id, from) ?? player(id, to)
    return p ? lockBadgeFor(p.game_lock, true).locked : false
  })
  const gateBlocked = !gate.canSend && gate.reason

  return (
    <MOverlay label="Propose a trade" onClose={close}>
      <TopBar onClose={close} disabled={mutation.isPending} />
      <MOverlayScroll className="flex flex-col gap-5 px-4 pb-4">
        <button type="button" onClick={() => setStep('pick')} disabled={mutation.isPending} className="flex h-[30px] items-center gap-1 self-start text-[13px] font-semibold text-accent">
          <MIcon name="back" size={12} stroke={2.2} />
          Edit players
        </button>

        {locked && (
          <div className="flex flex-col gap-1 rounded-[14px] bg-m-go px-3 py-2.5" role="status">
            <p className="text-[13px] font-semibold text-m-to">{DEADLINE_PASSED_TITLE}</p>
            <p className="text-[12px] font-medium text-m-t2">{userFacingMessage(locked)}</p>
          </div>
        )}

        {side(from, 1, { ids: getNow, faab: faabGet, team: to }, { ids: giveNow, faab: faabGive, team: from })}
        {side(to, 2, { ids: giveNow, faab: faabGive, team: from }, { ids: getNow, faab: faabGet, team: to })}

        {lockedPicked && <p className="text-[12px] font-medium text-m-t3">{lockedAssetTitle(lockBehavior)}</p>}

        {!dropsOpen && (
          <button type="button" onClick={() => setShowDrops(true)} className="self-start text-[13px] font-semibold text-accent" data-trade-drops-open>
            Drop players as part of this trade
          </button>
        )}
        {dropsOpen && (
          <section className="flex flex-col gap-2" data-trade-drops={dropsOpen ? 'open' : 'closed'}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-semibold">Players to drop</span>
              {mustDrop > 0 && <span className="text-[12px] font-semibold text-m-tr tabular-nums">{mustDrop} more</span>}
            </div>
            <p className="text-[11px] font-medium text-m-t3">
              {mustDrop > 0 ? dropsNeededCopy(mustDrop, words) : 'Only if your roster would be over its size — dropped only if the trade goes through.'}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {fromRoster
                .filter((p) => !giveNow.includes(p.player_id))
                .map((p) => (
                  <Tile key={p.player_id} p={p} on={dropsNow.includes(p.player_id)} age={null} onToggle={() => setDrops((d) => toggle(d, p.player_id))} compact />
                ))}
            </div>
          </section>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] font-semibold">Note</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="A word to the other manager (optional)"
            className="resize-none rounded-[14px] bg-m-b2 px-3 py-2.5 text-[14px] font-medium text-m-t1 placeholder:text-m-t4 focus:outline-none"
          />
        </label>

        <ToggleRow label="Hide team names" sub="For sharing screenshots" on={hide} onToggle={() => setHide((h) => !h)}>
          <MSwitch on={hide} size="md" />
        </ToggleRow>

        {refusal && !locked && (
          <div className="flex flex-col gap-1 rounded-[14px] bg-m-gr px-3 py-2.5" role="alert">
            <p className="text-[13px] font-semibold text-m-tr">The offer wasn’t sent.</p>
            <p className="text-[12px] font-medium text-m-t2">{userFacingMessage(refusal)}</p>
          </div>
        )}
      </MOverlayScroll>
      <div className="flex flex-none flex-col gap-2 border-t border-m-b3 bg-m-b0 px-4 pb-[max(28px,env(safe-area-inset-bottom))] pt-3">
        {gate.reason && (
          <p className={cn('text-center text-[12px] font-medium', gateBlocked && !gate.failed ? 'text-m-t2' : 'text-m-t3')} role={gate.failed ? 'status' : undefined} data-trade-gate>
            {gate.reason}
          </p>
        )}
        <button
          type="button"
          onClick={send}
          disabled={!gate.canSend || mutation.isPending || locked !== null}
          className="h-12 rounded-pill bg-accent text-[15px] font-semibold text-white active:bg-accent-strong disabled:bg-m-b3s disabled:text-m-t3"
          data-trade-send
        >
          {mutation.isPending ? 'Sending…' : 'Send trade proposal'}
        </button>
      </div>
    </MOverlay>
  )
}

/** A roster tile (handoff §2.5): "QB · CLE (9)" · short name · "Age 26";
 *  the check circle top-right; selected = blue tint + 1.5px blue ring. */
function Tile({ p, on, age, onToggle, compact = false }: { p: RosterPlayer; on: boolean; age: number | null; onToggle: () => void; compact?: boolean }) {
  const isDef = p.position === 'DEF' || p.position === 'DST'
  const lock = lockBadgeFor(p.game_lock, true)
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn('relative flex min-w-0 flex-col gap-px rounded-[12px] px-[10px] py-2 text-left', on ? 'bg-m-gb ring-[1.5px] ring-inset ring-accent' : 'bg-m-b1')}
      data-trade-tile={p.player_id}
    >
      <span className={cn('truncate pr-[22px] text-[10px] font-semibold', posTextClass(p.position))}>
        {posCode(p.position)} · {p.nfl_team ?? 'FA'}
        {p.bye_week !== null ? ` (${p.bye_week})` : ''}
        {lock.locked ? ' · Locked' : ''}
      </span>
      <span className="truncate pr-[22px] text-[14px] font-semibold">{shortName(p.full_name, p.position)}</span>
      {!compact && (isDef || age !== null) && <span className="text-[10px] font-medium text-m-t3">{isDef ? 'Defense' : `Age ${age}`}</span>}
      <span
        aria-hidden
        className={cn('absolute right-2 top-2 flex size-5 items-center justify-center rounded-full', on ? 'bg-accent' : 'bg-m-b0 ring-[1.5px] ring-inset ring-m-b4m')}
      >
        {on && <MIcon name="check" size={10} stroke={3} className="text-white" />}
      </span>
    </button>
  )
}

function FaabBox({ label, text, onChange, balance, over }: { label: string; text: string; onChange: (t: string) => void; balance: number | null; over: boolean }) {
  return (
    <label className={cn('flex flex-col gap-0.5 rounded-[12px] px-[10px] py-2', over ? 'bg-m-gr' : 'bg-m-b1')}>
      <span className="text-[10px] font-semibold text-m-t3">FAAB · {label}</span>
      <span className="flex items-center gap-1 text-[14px] font-semibold">
        $
        <input
          value={text}
          onChange={(e) => onChange(e.target.value)}
          inputMode="numeric"
          placeholder="0"
          aria-label={`FAAB ${label.toLowerCase()}`}
          aria-invalid={over || undefined}
          className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-m-t1 placeholder:text-m-t4 focus:outline-none"
        />
      </span>
      {balance !== null && <span className={cn('text-[10px] font-medium', over ? 'text-m-tr' : 'text-m-t3')}>${balance} left</span>}
    </label>
  )
}
