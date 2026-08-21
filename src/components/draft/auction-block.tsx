'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useDraftBids } from '@/hooks/use-draft-bids'
import type { PlayerIdentity } from '@/hooks/use-players-by-ids'
import type { RosterSettings } from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'

import {
  antiSnipeView,
  auctionPhase,
  nominationKeyOf,
  bidAmountAcceptable,
  buildAuctionColumns,
  buildBidBox,
  nominationBidHistory,
  type AuctionTeamColumn,
  type BidBlocker,
} from './auction-block-ops'
import {
  auctionKnobsOf,
  readLiveNomination,
  teamBudgets,
  type LiveNomination,
} from './auction-budget'
import { abbreviateName } from './draft-board-ops'

/** The drafts-row slice the block reads. Deliberately narrow: everything
 *  below rides the ONE channel the room already holds (D184) — the `drafts`
 *  UPDATE carries `current_nomination` and `budget_adjustments` since 088. */
export interface AuctionBlockDraft {
  id: string
  status: string
  config: unknown
  total_rounds: number | null
  current_pick_number: number | null
  current_deadline: string | null
  on_clock_team_id: string | null
  current_nomination: unknown
  budget_adjustments: unknown
  nomination_order: unknown
}

interface AuctionBlockProps {
  draft: AuctionBlockDraft
  teams: ReadonlyArray<{ id: string; name: string }>
  picks: ReadonlyArray<{
    pick_number: number
    team_id: string
    player_id: string
    price?: number | null
    is_undone: boolean | null
  }>
  playerById: ReadonlyMap<string, PlayerIdentity>
  roster: RosterSettings
  myTeamId: string | null
  /** Heartbeat-corrected server−client offset (§9.3) — the anti-snipe view's
   *  only clock input besides the sample the tick below takes. */
  offsetMs: number
  /** The player the nominator picked out of the pool, awaiting an opening
   *  bid. Room-owned so pool and block can never disagree (the L.B4.2
   *  overlay precedent). */
  nomineeId: string | null
  onClearNominee: () => void
  /** Fires the L.C2.1 hooks. NEVER optimistic (§15.6) — the caller shows
   *  "submitting…" and the room repaints off the broadcast/refetch. */
  onNominate: (playerId: string, openingBid: number) => void
  onBid: (amount: number) => void
  submitting: boolean
  className?: string
}

/**
 * AuctionBlock — spec §16.2 `auction-block.tsx` ("current nomination + high
 * bid + time remaining (prominent), bid input, budgets, max-bid, anti-snipe;
 * team columns per §16.4's v2.10 auction-room-layout callout"); M3 task
 * L.C3.1; tasks-M3 D126/D128/D129/D135.
 *
 * **Where it lives.** Inside the board ZONE of the v2.12 room (§16.4's three
 * zones — command bar, status strip, full-width board), as the auction's
 * replacement for the snake board grid. There is no side rail to put the
 * budgets in: DR.4 deleted it, so §16.4's per-team columns compose here, at
 * full width, and the working panels (pool, Targets, roster, lists, chat)
 * stay in DR.5's bottom dock exactly as they are for snake. The dock is
 * NON-MODAL (D150), which is what makes the composition work — the
 * centerpiece stays visible and the countdown keeps running while the
 * nominator browses the pool.
 *
 * **What it does NOT do.**
 *  - It does not own the clock. §16.4 zone 2's `PickClock` renders the
 *    nomination/bid deadline off the same `drafts.current_deadline` (D126
 *    arms one clock at a time), and §16.3's say-a-thing-once rule means
 *    this block must not print a second countdown. What it adds is the one
 *    fact the countdown cannot state: the ANTI-SNIPE FLOOR, and the moment
 *    it re-arms (E6/D128).
 *  - It does not decide anything about money. Every number is the
 *    display-only, parity-pinned mirror (`auction-budget.ts` ≡ 084's
 *    `draft_team_budget`); the max-bid cap on the input exists to PREVENT
 *    E5's refusal, and the server refuses independently with its own copy
 *    if an over-cap amount ever reaches it (§4.7).
 *  - It renders no commissioner control. §8.7's one door is the command
 *    bar's Draft Options (v2.12); the auction sections land in L.C3.2.
 *
 * **Elevation** (CLAUDE.md, 2026-08-11): nothing here rests elevated. The
 * three at-a-glance marks §16.4 asks for — MY team, the NOMINATING team,
 * the LATEST-BID team — are carried by fill and border, never by a shadow,
 * and each also carries a WORD (You / Nominating / High bid) so the status
 * is color-independent (§16.3's WCAG pledge).
 */
export function AuctionBlock({
  draft,
  teams,
  picks,
  playerById,
  roster,
  myTeamId,
  offsetMs,
  nomineeId,
  onClearNominee,
  onNominate,
  onBid,
  submitting,
  className,
}: AuctionBlockProps) {
  const nomination = useMemo(
    () => readLiveNomination(draft.current_nomination as never),
    [draft.current_nomination],
  )
  const phase = auctionPhase(nomination)
  const knobs = useMemo(() => auctionKnobsOf(draft.config as never), [draft.config])
  const antiSnipeSeconds = useMemo(() => readAntiSnipeSeconds(draft.config), [draft.config])

  const teamIds = useMemo(() => teams.map((t) => t.id), [teams])
  const budgets = useMemo(
    () =>
      teamBudgets(
        {
          auctionBudget: knobs.auctionBudget,
          reserve: knobs.reserve,
          totalRounds: draft.total_rounds,
          budgetAdjustments: draft.budget_adjustments as never,
        },
        picks.map((p) => ({
          team_id: p.team_id,
          price: p.price ?? null,
          is_undone: p.is_undone,
        })),
        teamIds,
      ),
    [knobs, draft.total_rounds, draft.budget_adjustments, picks, teamIds],
  )

  const positionById = useMemo(
    () => new Map(Array.from(playerById.values()).map((p) => [p.id, p.position])),
    [playerById],
  )

  const columns = useMemo(
    () =>
      buildAuctionColumns({
        nominationOrder: parseTeamIdArray(draft.nomination_order),
        teams,
        picks,
        budgets,
        positionById,
        startingSlots: roster.starting_slots,
        bench: roster.bench,
        myTeamId,
        nominatingTeamId: draft.on_clock_team_id,
        nomination,
      }),
    [
      draft.nomination_order,
      draft.on_clock_team_id,
      teams,
      picks,
      budgets,
      positionById,
      roster,
      myTeamId,
      nomination,
    ],
  )

  const myBudget = myTeamId ? (budgets.get(myTeamId) ?? null) : null
  const box = buildBidBox({
    phase,
    status: draft.status,
    myTeamId,
    myBudget,
    nomination,
    nominatingTeamId: draft.on_clock_team_id,
    // The NOMINATION FLOOR (§8.6.2). The bid box derives the raise minimum
    // itself as `high_bid + 1` — a fixed $1 increment no setting reaches
    // (§8.6.3) — so this is read on the nominating branch only.
    nominationFloor: knobs.reserve,
  })

  // The bid feed rides the room's ONE channel (D184/D185 — `use-draft.ts`
  // folds `draft_bids` into THIS query's cache through the feed sink). The
  // hook opens no channel; mounting it is what gives the sink a cache to
  // drain into, so the ladder below is live without a second subscription.
  const bids = useDraftBids(draft.id)
  const history = useMemo(
    () => nominationBidHistory(bids.data ?? [], draft.current_pick_number),
    [bids.data, draft.current_pick_number],
  )

  const teamNameById = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])

  return (
    <div className={cn('flex min-w-0 flex-col gap-4', className)}>
      <Nomination
        phase={phase}
        nomination={nomination}
        nomineeId={nomineeId}
        onClearNominee={onClearNominee}
        playerById={playerById}
        teamNameById={teamNameById}
        box={box}
        antiSnipe={{
          seconds: antiSnipeSeconds,
          phase,
          status: draft.status,
          currentDeadline: draft.current_deadline,
          nominationKey: nominationKeyOf(draft.current_pick_number, nomination),
          offsetMs,
        }}
        history={history}
        onNominate={onNominate}
        onBid={onBid}
        submitting={submitting}
        isMock={false}
      />
      <TeamColumns columns={columns} playerById={playerById} reserve={knobs.reserve} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The centerpiece (§16.4: "current nominated player, current high bid, and
// time remaining stay prominently visible")
// ---------------------------------------------------------------------------

function Nomination({
  phase,
  nomination,
  nomineeId,
  onClearNominee,
  playerById,
  teamNameById,
  box,
  antiSnipe,
  history,
  onNominate,
  onBid,
  submitting,
}: {
  phase: 'nominating' | 'bidding'
  nomination: LiveNomination | null
  nomineeId: string | null
  onClearNominee: () => void
  playerById: ReadonlyMap<string, PlayerIdentity>
  teamNameById: ReadonlyMap<string, string>
  box: ReturnType<typeof buildBidBox>
  antiSnipe: {
    seconds: number
    phase: 'nominating' | 'bidding'
    status: string
    currentDeadline: string | null
    nominationKey: string | null
    offsetMs: number
  }
  history: ReturnType<typeof nominationBidHistory>
  onNominate: (playerId: string, openingBid: number) => void
  onBid: (amount: number) => void
  submitting: boolean
  isMock: boolean
}) {
  const subject = phase === 'bidding' ? (nomination?.player_id ?? null) : nomineeId
  const player = subject ? playerById.get(subject) : undefined
  const snipe = useAntiSnipe(antiSnipe)

  // The amount box. Two re-seed rules, and both were sharpened by the
  // browser pass:
  //   - a NEW SUBJECT (a different nomination, or a different player picked
  //     to nominate) always resets to the minimum — carrying "$12" from the
  //     bidding you just lost into the next player's opening bid is a
  //     number you did not mean;
  //   - a rising MINIMUM within one subject only resets when what you typed
  //     is now illegal. An input that fights the typist mid-raise is worse
  //     than one that lags a bid by a keystroke.
  const [amount, setAmount] = useState<string>(String(box.minAmount))
  const lastMinRef = useRef(box.minAmount)
  const lastSubjectRef = useRef(subject)
  useEffect(() => {
    if (lastSubjectRef.current !== subject) {
      lastSubjectRef.current = subject
      lastMinRef.current = box.minAmount
      setAmount(String(box.minAmount))
      return
    }
    if (lastMinRef.current === box.minAmount) return
    lastMinRef.current = box.minAmount
    setAmount((current) => {
      const parsed = Number.parseInt(current, 10)
      return Number.isInteger(parsed) && parsed >= box.minAmount ? current : String(box.minAmount)
    })
  }, [box.minAmount, subject])

  const parsed = Number.parseInt(amount, 10)
  const acceptable = bidAmountAcceptable(box, parsed)

  const submit = () => {
    if (!acceptable || submitting) return
    if (phase === 'bidding') onBid(parsed)
    else if (subject) onNominate(subject, parsed)
  }

  return (
    <Card>
      <CardHeader>
        <span className="text-[13px] font-extrabold">
          {phase === 'bidding' ? 'Up for bid' : 'Nominating'}
        </span>
        {/* The floor's STATE, never a second countdown (§16.3 say-a-thing-
            once — the strip's PickClock is the room's one clock). */}
        {snipe.active && (
          <span
            className={cn(
              'fs-overline text-[9px]',
              snipe.reArmed || snipe.inWindow ? 'text-negative-strong' : 'text-n-3',
            )}
            role={snipe.reArmed ? 'status' : undefined}
          >
            {snipe.reArmed
              ? `Anti-snipe — clock reset to ${snipe.seconds}s`
              : snipe.inWindow
                ? `Anti-snipe armed — a bid now resets the clock to ${snipe.seconds}s`
                : `Anti-snipe ${snipe.seconds}s`}
          </span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {subject === null ? (
          <p className="text-[12px] font-medium text-n-3">
            {box.blocker === 'not-nominator'
              ? 'Waiting on the nominating team to put a player up.'
              : 'Open the Players panel and choose a player to nominate.'}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            {player?.position && <PositionBadge position={player.position} />}
            <span className="text-[18px] font-extrabold leading-none">
              {player ? player.full_name : 'Loading player…'}
            </span>
            {player?.team && (
              <span className="fs-overline text-[9px] text-n-3">{player.team}</span>
            )}
            {phase === 'bidding' && nomination && (
              <span className="ml-auto flex items-baseline gap-1.5">
                <span className="fs-overline text-[9px] text-n-3">High bid</span>
                <span className="fs-num text-[22px] font-extrabold text-accent-strong">
                  ${nomination.high_bid}
                </span>
                <span className="text-[12px] font-bold">
                  {teamNameById.get(nomination.high_bidder_team_id) ?? 'a team'}
                </span>
              </span>
            )}
            {phase === 'nominating' && (
              <Button variant="stroke" size="sm" className="ml-auto" onClick={onClearNominee}>
                Choose another
              </Button>
            )}
          </div>
        )}

        {/* The bid / opening-bid input, with the max-bid cap SURFACED (§8.6.1;
            L.C3.1 item 1 — "E5's message prevented at the UI"). */}
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="fs-overline text-[9px] text-n-3">
              {phase === 'bidding' ? 'Your bid' : 'Opening bid'}
              {box.maxAmount !== null && (
                <>
                  {' · '}
                  <span className="fs-num">max ${box.maxAmount}</span>
                </>
              )}
            </span>
            <Input
              type="number"
              inputMode="numeric"
              className="w-32"
              aria-label={phase === 'bidding' ? 'Your bid' : 'Opening bid'}
              min={box.minAmount}
              max={box.maxAmount ?? undefined}
              step={1}
              value={amount}
              disabled={!box.canAct || subject === null}
              onChange={(event) => setAmount(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
            />
          </label>
          <Button
            variant="green"
            size="sm"
            shadow
            disabled={!acceptable || submitting || subject === null}
            onClick={submit}
          >
            {submitting
              ? 'Submitting…'
              : phase === 'bidding'
                ? `Bid $${Number.isInteger(parsed) ? parsed : box.minAmount}`
                : `Nominate at $${Number.isInteger(parsed) ? parsed : box.minAmount}`}
          </Button>
          <p className="text-[11px] font-semibold text-n-3">
            {box.canAct
              ? acceptable
                ? `Minimum $${box.minAmount}.`
                : overCapCopy(box.minAmount, box.maxAmount, parsed)
              : blockerCopy(box.blocker, box.phase)}
          </p>
        </div>

        {/* The raise ladder — §16.3's one-glance "who is bidding". */}
        {history.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {history.map((row) => (
              <span
                key={`${row.teamId}-${row.amount}-${row.createdAt}`}
                className="flex items-center gap-1 rounded-sm border border-ink bg-white px-2 py-0.5 text-[11px] font-semibold"
              >
                <span className="fs-num font-extrabold">${row.amount}</span>
                <span className="truncate text-n-3">
                  {teamNameById.get(row.teamId) ?? 'a team'}
                </span>
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** The blocker sentences — one per `BidBlocker`, so no state is silent. */
function blockerCopy(blocker: BidBlocker | null, phase: 'nominating' | 'bidding'): string {
  switch (blocker) {
    case 'no-seat':
      return 'You don’t hold a seat in this draft, so you can watch but not bid.'
    case 'not-live':
      return 'The draft is paused — clocks and bidding are frozen.'
    case 'roster-complete':
      return 'Your roster is full, so you’re skipped in the rotation and can’t bid.'
    case 'already-high':
      return 'You hold the high bid — wait to be outbid.'
    case 'max-bid-reached':
      return 'Your max bid can’t reach the next raise. You keep $1 per open roster spot.'
    case 'not-nominator':
      return 'It’s not your turn to nominate.'
    default:
      return phase === 'bidding' ? 'Place your bid.' : 'Nominate a player.'
  }
}

function overCapCopy(min: number, max: number | null, parsed: number): string {
  if (!Number.isInteger(parsed)) return `Enter a whole dollar amount — minimum $${min}.`
  if (parsed < min) return `Minimum $${min}.`
  if (max !== null && parsed > max) return `Max $${max} — you keep $1 per open roster spot.`
  return `Minimum $${min}.`
}

/**
 * The anti-snipe view, sampled. Like `pick-clock.tsx`, the interval ONLY
 * drives re-render — the math lives in `auction-block-ops.ts` and takes the
 * sample as a parameter (§9.3's no-`Date.now()`-in-deadline-math rule). The
 * re-arm is latched briefly so a floor reset that lands between two 500ms
 * samples is still SEEN: the deadline itself moves once, and a state that
 * renders for one frame is a state nobody observed.
 */
function useAntiSnipe(input: {
  seconds: number
  phase: 'nominating' | 'bidding'
  status: string
  currentDeadline: string | null
  nominationKey: string | null
  offsetMs: number
}) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  // The deadline AND the nomination it belonged to travel together: a later
  // deadline is only a floor re-arm when the nomination did not change (the
  // NOMINATING→BIDDING transition moves the deadline later too — measured).
  const previousRef = useRef<{ deadline: string | null; key: string | null }>({
    deadline: null,
    key: null,
  })
  const [reArmedAt, setReArmedAt] = useState<number | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const previous = previousRef.current
  const view = antiSnipeView({
    phase: input.phase,
    status: input.status,
    antiSnipeSeconds: input.seconds,
    currentDeadline: input.currentDeadline,
    previousDeadline: previous.deadline,
    nominationKey: input.nominationKey,
    previousNominationKey: previous.key,
    nowMs,
    offsetMs: input.offsetMs,
  })

  useEffect(() => {
    if (view.reArmed) setReArmedAt(Date.now())
    previousRef.current = { deadline: input.currentDeadline, key: input.nominationKey }
  }, [view.reArmed, input.currentDeadline, input.nominationKey])

  // A new nomination clears the latch: the flash names THIS nomination's
  // floor, and carrying it across would be a lie about the new one.
  useEffect(() => {
    setReArmedAt(null)
  }, [input.nominationKey])

  const latched = reArmedAt !== null && nowMs - reArmedAt < ANTI_SNIPE_FLASH_MS
  return { ...view, reArmed: view.active && (view.reArmed || latched) }
}

/** How long the re-arm reads on screen. Long enough to be seen across the
 *  500ms sampler, short enough that it never outlives the window it names. */
const ANTI_SNIPE_FLASH_MS = 4_000

// ---------------------------------------------------------------------------
// Team columns (§16.4's v2.10 auction-room-layout callout, item by item)
// ---------------------------------------------------------------------------

function TeamColumns({
  columns,
  playerById,
  reserve,
}: {
  columns: readonly AuctionTeamColumn[]
  playerById: ReadonlyMap<string, PlayerIdentity>
  reserve: 0 | 1
}) {
  // §16.4's mobile density rule, applied to the auction board the way DR.5
  // applied it to the grid: MY column stays resident (it is the one a
  // manager needs on the clock), the rest are one tap away. Desktop shows
  // every column side by side, scrolling horizontally like the pick grid.
  const [mobileAllOpen, setMobileAllOpen] = useState(false)
  const mine = columns.find((c) => c.isMe) ?? null

  return (
    <Card>
      <CardHeader>
        <span className="text-[13px] font-extrabold">Teams</span>
        <span className="fs-overline text-[9px] text-n-3">By nomination order</span>
      </CardHeader>
      <CardContent>
        {/* Desktop: every team, side by side. */}
        <div
          className="hidden gap-1.5 overflow-x-auto pb-0.5 lg:flex"
          role="region"
          aria-label="Team budgets and rosters"
          tabIndex={0}
        >
          {columns.map((column) => (
            <TeamColumnCard
              key={column.teamId}
              column={column}
              playerById={playerById}
              reserve={reserve}
              className="w-[168px] shrink-0"
            />
          ))}
        </div>

        {/* Mobile: my row resident, the rest summoned. */}
        <div className="flex flex-col gap-1.5 lg:hidden">
          {mine && <TeamColumnCard column={mine} playerById={playerById} reserve={reserve} />}
          <Button
            variant="stroke"
            size="sm"
            className="w-fit"
            aria-expanded={mobileAllOpen}
            onClick={() => setMobileAllOpen((current) => !current)}
          >
            {mobileAllOpen ? 'Hide all teams' : 'Show all teams'}
          </Button>
          {mobileAllOpen &&
            columns
              .filter((column) => !column.isMe)
              .map((column) => (
                <TeamColumnCard
                  key={column.teamId}
                  column={column}
                  playerById={playerById}
                  reserve={reserve}
                />
              ))}
        </div>
      </CardContent>
    </Card>
  )
}

function TeamColumnCard({
  column,
  playerById,
  reserve,
  className,
}: {
  column: AuctionTeamColumn
  playerById: ReadonlyMap<string, PlayerIdentity>
  reserve: 0 | 1
  className?: string
}) {
  const budget = column.budget
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-sm border border-ink bg-white p-2',
        // The three §16.4 marks: FILL and BORDER only (CLAUDE.md — a resting
        // shadow would be an elevation lie, and these are resting states).
        // Nominating borrows the room's existing on-the-clock language
        // (accent); the latest bid is green because it is where the money
        // currently is; MY column keeps a permanent ink rule so it stays
        // identifiable while the other two marks move around it. Each mark
        // also carries a WORD below (§16.3 colour-independent status).
        //
        // **The two moving marks do not COMPOSE — one fill wins, and this
        // says which** (review finding R432; the first version of this
        // comment let the stacked conditionals imply otherwise). They land on
        // the same team at every freshly-opened nomination, because 085/087
        // set `high_bidder_team_id = on_clock_team_id` when the nomination
        // opens (087:2205-2212) — so the nominator carries both marks until
        // someone raises. The money mark wins: written as a ternary here so
        // the precedence is in the code rather than emerging from
        // tailwind-merge's last-pair-wins. §16.3's colour-independent status
        // is unaffected either way — BOTH badges still render below.
        column.isLatestBid
          ? 'border-positive bg-positive-soft'
          : column.isNominating && 'border-accent bg-accent-soft',
        column.isMe && 'border-l-4 border-l-ink',
        column.rosterComplete && !column.isNominating && !column.isLatestBid && 'bg-n-1/40',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[12px] font-extrabold">{column.name}</span>
        {column.isMe && (
          <Badge variant="black" className="shrink-0">
            You
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {column.isNominating && <Badge variant="stroke-purple">Nominating</Badge>}
        {column.isLatestBid && <Badge variant="stroke-green">High bid</Badge>}
        {column.rosterComplete && <Badge variant="stroke">Roster full</Badge>}
      </div>

      <dl className="flex flex-col gap-0.5 text-[11px] font-semibold">
        <div className="flex items-baseline justify-between gap-1">
          <dt className="text-n-3">Budget</dt>
          <dd className="fs-num font-extrabold">
            {budget ? `$${budget.remaining}` : '—'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-1">
          <dt className="text-n-3">Max bid</dt>
          <dd className="fs-num font-extrabold">{budget ? `$${budget.maxBid}` : '—'}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-1">
          <dt className="text-n-3">Spots left</dt>
          <dd className="fs-num font-extrabold">{budget ? budget.openSlots : '—'}</dd>
        </div>
      </dl>

      {/* Which roster positions remain undrafted (§16.4). Bench seats are
          carried by "Spots left" — they are a count, not a position. */}
      <div className="flex flex-wrap gap-1">
        {column.needs.length === 0 ? (
          <span className="fs-overline text-[9px] text-n-3">Starters covered</span>
        ) : (
          column.needs.map((need) => (
            <span
              key={need.key}
              className="rounded-sm border border-dashed border-n-3 px-1 text-[10px] font-bold text-n-3"
            >
              {need.label}
              {need.count > 1 ? ` ×${need.count}` : ''}
            </span>
          ))
        )}
      </div>

      {/* Drafted players WITH PRICES (§16.4) — the auction's board. */}
      <ul className="flex flex-col gap-0.5">
        {column.picks.length === 0 ? (
          <li className="fs-overline text-[9px] text-n-3">No buys yet</li>
        ) : (
          column.picks.map((pick) => {
            const player = playerById.get(pick.playerId)
            return (
              <li
                key={pick.pickNumber}
                className="flex items-baseline justify-between gap-1 text-[11px]"
              >
                <span className="min-w-0 truncate font-bold">
                  {player ? abbreviateName(player.full_name) : '…'}
                </span>
                <span className="fs-num shrink-0 font-semibold text-n-3">
                  ${pick.price ?? reserve}
                </span>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Config reads (the same forgiving posture `auction-budget.ts` documents)
// ---------------------------------------------------------------------------

/** `auction_anti_snipe_seconds` (§7.3.8 — 0..15, default 10). 0 disables the
 *  floor entirely (D128: a pure fixed window). */
function readAntiSnipeSeconds(config: unknown): number {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return 10
  const raw = (config as Record<string, unknown>).auction_anti_snipe_seconds
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) return Number.parseInt(raw, 10)
  return 10
}

/** `drafts.nomination_order` — an ordered array of team ids (065:116). */
function parseTeamIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}
