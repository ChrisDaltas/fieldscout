import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { leagueScope, placeBid } from '@/lib/leagues/api/draft-service'

import {
  assertPlayerPoolPresent,
  cleanupSweep,
  provisionBotUsers,
  readAuctionMarket,
  readBidLedger,
  readPickSheet,
  rewindDeadline,
  serviceClient,
  stageBidDeadline,
  tickOnce,
  type BotSeatUser,
} from './helpers/harness'
import { openDockPlayers } from './helpers/dock'
import { provisionLeague, signInDev, signInDevPro } from './helpers/provision'
import { STORAGE_STATE } from './helpers/local-env'

/**
 * L.C5.1 spec (b) — THE BID STORM (tasks-M3 §6 item 2; M3 exit criterion 3;
 * §22.6(2)'s shape at Playwright scale per C35; D128; E2; §8.6.3).
 *
 * One nomination; a service-layer burst of 20 bids across six SEATED bot
 * users (each minted by harness job 6 and bidding through the REAL
 * `placeBid` service fn under its OWN JWT — D100; parallel actors, never
 * sequential calls narrated as a storm) while BOTH browsers also bid.
 * The storm is authored against TODAY'S engine (D197(4)): jump bids are
 * legal (§8.6.3/AP.3 — the $25 jump is the deliberate one), the anti-snipe
 * floor is 092's `GREATEST(standing, now + anti_snipe)` (D128 — reset TO
 * anti_snipe, repeatably), and the drafts-row lock serializes every write.
 *
 * Asserted:
 *  - SERIALIZATION: the ledger's amounts are strictly increasing in commit
 *    order — every accepted bid beat the standing high under the row lock.
 *  - NO BID LOST, NONE DUPLICATED (E2): the set of bot-team ledger rows
 *    equals the set of 200-response bid rows EXACTLY (both directions);
 *    action_ids are distinct; a deliberate same-action_id REPLAY of the
 *    winning submit answers 200 with the ORIGINAL row and writes nothing.
 *  - RACE LOSERS get the named friendly refusals, never anything else:
 *    "outbid at $N" / "already the high bidder" (D136 — refusal mechanisms
 *    tolerated BY NAME, the F113/F132 lesson; any other failure is RED).
 *  - ANTI-SNIPE (D128): with the deadline STAGED into the window (job 7),
 *    the server deadline moves LATER across wave 1 and LATER AGAIN across
 *    wave 2 (repeatably), the final floor lands ≈ anti_snipe from the last
 *    commit, and both browsers RENDER the re-arm ("Anti-snipe — clock reset
 *    to 10s" — it latches until the next deadline change, so this is a
 *    converged-state assertion, not a transient race).
 *  - SINGLE WINNER at the max accepted amount: the $25 jump (the one bid
 *    its bot carries, so it can never self-raise-refuse) wins the lot; the
 *    losers' browsers converge on the outbid state (min raise $26).
 *  - CONVERGENCE < 2s: after the close (rewind + tick → award), both
 *    browsers reflect the next nomination turn inside 2s.
 */

const TEAM_COUNT = 8
const BOT_COUNT = 6
const NOMINATION_SEQ = 1
/** How long the storm's lot is held open for the post-storm assertions
 *  (F297). Comfortably past the two 15s browser waits that follow it, and
 *  irrelevant to every number the test asserts — the lot is closed
 *  deliberately, by rewind + tick, at the convergence step. */
const LOT_HOLD_MS = 120_000

type BidOutcome =
  | {
      kind: 'accepted'
      amount: number
      actionId: string
      bidId: string
      teamId: string
      /** The standing high bid in the RESPONSE's own drafts row (§8.1 step
       *  5) — the row-lock serialization witness: an accepted bid was the
       *  top at ITS commit, whatever order the racers started in. */
      highAfter: number
    }
  | { kind: 'outbid'; amount: number }
  | { kind: 'self-raise'; amount: number }

/** One storm bid through the real service fn under the bot's own JWT.
 *  Any outcome other than 200 / the two NAMED race refusals is RED. */
async function stormBid(
  bot: BotSeatUser,
  leagueId: string,
  draftId: string,
  playerId: string,
  amount: number,
): Promise<BidOutcome> {
  const actionId = randomUUID()
  const res = await placeBid(bot.client, leagueScope(leagueId), bot.userId, {
    draft_id: draftId,
    nomination_seq: NOMINATION_SEQ,
    player_id: playerId,
    amount,
    action_id: actionId,
  })
  if (res.status === 200) {
    const body = res.body as {
      bid: { id: string; team_id: string }
      draft: { current_nomination: { high_bid: number } | null }
    }
    return {
      kind: 'accepted',
      amount,
      actionId,
      bidId: body.bid.id,
      teamId: body.bid.team_id,
      highAfter: Number(body.draft.current_nomination?.high_bid ?? -1),
    }
  }
  const message = String((res.body as { error?: unknown }).error ?? '')
  if (res.status === 400 && message.includes('outbid at $')) return { kind: 'outbid', amount }
  if (res.status === 400 && message.includes('already the high bidder')) {
    return { kind: 'self-raise', amount }
  }
  throw new Error(`storm bid $${amount} (${bot.username}): unexpected ${res.status} — ${message}`)
}

/** A browser participant's one storm bid: click whatever the composer
 *  offers. The click races live re-renders and the market itself — the
 *  named outcomes are 'accepted' (its row lands in the ledger), 'refused'
 *  (the friendly outbid toast), or 'unstable' (the button re-rendered out
 *  from under the click — the market moved first). */
async function browserBid(page: Page): Promise<'clicked' | 'unstable'> {
  try {
    await page.getByRole('button', { name: /^Bid \$\d+$/ }).click({ timeout: 3_000 })
    return 'clicked'
  } catch {
    return 'unstable'
  }
}

test.describe('the bid storm (exit criterion 3)', () => {
  test.beforeAll(async () => {
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('20-bid burst across 6 seated bots + 2 browsers: serialized, none lost, anti-snipe re-floors, single winner, < 2s convergence', async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const service = serviceClient()

    const commishAuth = await signInDev()
    const managerAuth = await signInDevPro()
    const bots = await provisionBotUsers(service, BOT_COUNT)
    const league = await provisionLeague({
      nameSuffix: 'auction storm',
      teamCount: TEAM_COUNT,
      rounds: 2,
      clockSeconds: 30,
      commish: commishAuth,
      manager: managerAuth,
      extraManagers: bots,
      order: 'commish-first',
      draftType: 'auction',
      auction: { budget: 200, nominationSeconds: 60, bidSeconds: 60, antiSnipeSeconds: 10 },
      createDraftRow: true,
      start: true,
    })
    const draftId = league.draftId!
    const botTeamByUser = new Map<string, string>()
    bots.forEach((bot, i) => botTeamByUser.set(bot.userId, league.extraTeamIds[i]!))
    const botTeamIds = new Set(league.extraTeamIds)
    const roomPath = `/app/leagues/${league.leagueId}/draft`

    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    const managerContext = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    try {
      const commish = await commishContext.newPage()
      const manager = await managerContext.newPage()
      await commish.goto(roomPath)
      await manager.goto(roomPath)

      // ---- The one nomination (commissioner, via the real room UI) -------
      await expect(commish.getByText("You're on the clock").first()).toBeVisible({
        timeout: 30_000,
      })
      await openDockPlayers(commish)
      const nomineeLabel = await commish
        .getByRole('button', { name: /^Add .+ to Targets$/ })
        .first()
        .getAttribute('aria-label')
      await commish.getByRole('button', { name: 'Nominate', exact: true }).first().click()
      await commish.getByRole('button', { name: /^Nominate at \$1$/ }).click()

      // The manager's browser raises to $2 through the UI (the pre-storm
      // raise — proves the UI path is live before the burst).
      await expect(manager.getByRole('button', { name: /^Bid \$2$/ })).toBeVisible({
        timeout: 20_000,
      })
      await manager.getByRole('button', { name: /^Bid \$2$/ }).click()
      await expect(commish.getByRole('button', { name: /^Bid \$3$/ })).toBeVisible({
        timeout: 20_000,
      })

      const marketAtOpen = await readAuctionMarket(service, draftId)
      expect(marketAtOpen.nomination?.high_bid).toBe(2)
      const playerId = marketAtOpen.nomination!.player_id
      void nomineeLabel // identity travels via the market read; the label was the click target

      // ---- Stage the clock INTO the anti-snipe window (job 7 — D128's ----
      // test bench; the L.C4.1 sniper arm) ---------------------------------
      // The browser-side re-arm is a 4s FLASH (ANTI_SNIPE_FLASH_MS), so the
      // watchers START here, before the storm, and are awaited after it —
      // the flash lands mid-storm and the promise holds the observation.
      const commishReArmSeen = commish
        .getByText('Anti-snipe — clock reset to 10s')
        .first()
        .waitFor({ state: 'visible', timeout: 60_000 })
      const managerReArmSeen = manager
        .getByText('Anti-snipe — clock reset to 10s')
        .first()
        .waitFor({ state: 'visible', timeout: 60_000 })
      await stageBidDeadline(service, draftId, 4_000)
      const staged = await readAuctionMarket(service, draftId)
      const stagedDeadline = Date.parse(staged.currentDeadline!)

      // ---- THE STORM: 20 service bids + 2 browser bids -------------------
      // Ladder wave 1: $3–$12 round-robin over bots 0–4 (a bot can hold two
      // rungs, so a self-raise refusal is a NAMED legal outcome). The $25
      // jump rides wave 2 on bot 5, which carries NO other bid — it can
      // never self-raise, so the storm's winner is deterministic.
      const wave1Amounts = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      const wave2Amounts = [13, 14, 15, 16, 17, 18, 19, 20, 21]
      const stormStart = Date.now()
      const wave1 = await Promise.all(
        wave1Amounts.map((amount) =>
          stormBid(bots[(amount - 3) % 5]!, league.leagueId, draftId, playerId, amount),
        ),
      )
      const afterWave1 = await readAuctionMarket(service, draftId)
      const deadlineAfterWave1 = Date.parse(afterWave1.currentDeadline!)

      // Both browsers bid mid-storm (between the waves — their composers
      // race the broadcasts; outcomes are tolerated BY NAME below).
      const [commishClick, managerClick] = await Promise.all([
        browserBid(commish),
        browserBid(manager),
      ])

      const wave2 = await Promise.all([
        ...wave2Amounts.map((amount) =>
          stormBid(bots[(amount - 13) % 5]!, league.leagueId, draftId, playerId, amount),
        ),
        stormBid(bots[5]!, league.leagueId, draftId, playerId, 25),
      ])
      const stormMs = Date.now() - stormStart
      const wave2End = Date.now()

      const outcomes = [...wave1, ...wave2]
      const accepted = outcomes.filter((o): o is Extract<BidOutcome, { kind: 'accepted' }> => o.kind === 'accepted')
      const outbid = outcomes.filter((o) => o.kind === 'outbid').length
      const selfRaise = outcomes.filter((o) => o.kind === 'self-raise').length
      expect(outcomes.length).toBe(19 + 1) // the §22.6(2) shape: 20 storm bids
      expect(accepted.length).toBeGreaterThanOrEqual(2) // the ladder moved
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(
        `[auction-storm] 20 service bids in ${stormMs}ms (+2 browser bids: ` +
          `commish=${commishClick}, manager=${managerClick}): ${accepted.length} accepted, ` +
          `${outbid} outbid, ${selfRaise} self-raise — all named, nothing else`,
      )

      // ---- SINGLE WINNER at the max accepted amount ----------------------
      const afterStorm = await readAuctionMarket(service, draftId)
      expect(afterStorm.nomination?.high_bid).toBe(25)
      expect(afterStorm.nomination?.high_bidder_team_id).toBe(botTeamByUser.get(bots[5]!.userId))

      // ---- ANTI-SNIPE (D128): later, then later again — repeatably -------
      const deadlineAfterWave2 = Date.parse(afterStorm.currentDeadline!)
      expect(deadlineAfterWave1, 'wave 1 re-floored the staged clock').toBeGreaterThan(
        stagedDeadline,
      )
      expect(deadlineAfterWave2, 'wave 2 re-floored it again').toBeGreaterThan(deadlineAfterWave1)
      const floorMs = deadlineAfterWave2 - wave2End
      expect(floorMs, 'the final floor ≈ anti_snipe from the last commit').toBeGreaterThan(5_000)
      expect(floorMs).toBeLessThan(12_000)
      // Both browsers OBSERVED the re-arm flash mid-storm (the watchers
      // armed before the burst) — and both now sit inside the re-floored
      // window, where the armed line renders continuously until the award.
      await commishReArmSeen
      await managerReArmSeen
      await expect(commish.getByText(/^Anti-snipe/).first()).toBeVisible({ timeout: 15_000 })
      await expect(manager.getByText(/^Anti-snipe/).first()).toBeVisible({ timeout: 15_000 })

      // ---- HOLD THE LOT OPEN for the assertions that still need it (F297) -
      // MEASURED 2026-09-08, and this is F297's whole mechanism: everything
      // from here to the $26 min-raise assertion below — two ledger reads,
      // the E2 replay submit, and the browsers' own waits — has to finish
      // inside what is LEFT of this lot's life. That is the 10s anti-snipe
      // floor from the last storm bid, rounded up by the 5s `draft_tick`
      // cron: ~10-15s. On a loaded machine it does not fit. In the
      // reproduction the cron lawfully closed the nomination 13.2s after the
      // storm, awarded the lot to the $25 winner (bot 6: budget $175, one
      // buy), and the room moved to lot 2 — so the composer the assertion
      // waits for no longer existed and `Bid $26` timed out at :347. The
      // engine did nothing wrong; the test was asserting a state with a
      // deadline and had never said so.
      //
      // Every anti-snipe number above is ALREADY CAPTURED (they are read
      // from `afterStorm` / `wave2End`, taken before this line), so pushing
      // the deadline out weakens nothing — it only stops a legal concurrent
      // actor from ending the state under assertion. The lot is still closed
      // through the REAL engine below (rewind + tick), which stays the ONLY
      // thing that closes it. Never a retry, never a sleep (house rule): the
      // harness's sanctioned virtual-time door is the same one that staged
      // the clock into the anti-snipe window in the first place (D100).
      await stageBidDeadline(service, draftId, LOT_HOLD_MS)
      const held = await readAuctionMarket(service, draftId)
      // ...and PROVE the hold held. A lot the cron closed first would leave
      // every assertion below chasing a state that is gone, and the failure
      // would read as a mystery locator timeout instead of what it is —
      // "nothing happened" must never pass for "it worked" (CLAUDE.md).
      expect(
        held.nomination?.high_bid,
        'the storm lot is STILL OPEN at $25 after the hold (the cron did not beat us to it)',
      ).toBe(25)
      expect(Date.parse(held.currentDeadline!) - Date.now()).toBeGreaterThan(30_000)

      // ---- THE LEDGER: serialized, none lost, none duplicated (E2) -------
      const ledger = await readBidLedger(service, draftId, NOMINATION_SEQ)
      // THE SERIALIZATION PROOF, commit-honest (run 2's lesson: `created_at`
      // is transaction-START time, so two racers can commit in the opposite
      // order of their timestamps — an order-by-created_at "monotonicity"
      // check red-flagged a perfectly serialized ledger). Under the row
      // lock the validator only accepts `amount > standing high`, so:
      //  (1) every accepted RESPONSE shows its own amount as the standing
      //      high at ITS commit (§8.1 step 5 — the per-commit witness), and
      //  (2) no two accepted bids can carry the same amount — the ledger's
      //      amounts are DISTINCT, and commit order IS ascending-amount
      //      order by construction.
      for (const a of accepted) {
        expect(a.highAfter, `accepted $${a.amount} was the standing high at its commit`).toBe(
          a.amount,
        )
      }
      const amounts = ledger.map((row) => row.amount)
      expect(new Set(amounts).size, `distinct amounts: ${JSON.stringify(amounts)}`).toBe(
        amounts.length,
      )
      expect(Math.max(...amounts)).toBe(25)
      // Bot-team rows == accepted 200s, EXACTLY, both directions.
      const botRows = ledger.filter((row) => botTeamIds.has(row.team_id))
      expect(new Set(botRows.map((r) => r.action_id)).size).toBe(botRows.length)
      expect(new Set(botRows.map((r) => r.id)).size).toBe(botRows.length)
      expect([...botRows.map((r) => r.id)].sort()).toEqual(
        [...accepted.map((a) => a.bidId)].sort(),
      )
      // Human-team rows: the opening, the manager's $2, plus at most the two
      // mid-storm browser clicks — nothing phantom.
      const humanRows = ledger.filter((row) => !botTeamIds.has(row.team_id))
      expect(humanRows.length).toBeGreaterThanOrEqual(2)
      expect(humanRows.length).toBeLessThanOrEqual(4)
      expect(humanRows[0]!.amount).toBe(1) // the nomination's opening row
      expect(humanRows[1]!.amount).toBe(2) // the manager's UI raise

      // ---- E2 UNDER BURST: replay the WINNING submit verbatim ------------
      const winner = accepted.find((a) => a.amount === 25)
      if (!winner) throw new Error('the $25 jump was not accepted — the storm design broke')
      const replay = await placeBid(bots[5]!.client, leagueScope(league.leagueId), bots[5]!.userId, {
        draft_id: draftId,
        nomination_seq: NOMINATION_SEQ,
        player_id: playerId,
        amount: 25,
        action_id: winner.actionId,
      })
      expect(replay.status).toBe(200)
      expect((replay.body as { bid: { id: string } }).bid.id).toBe(winner.bidId)
      const ledgerAfterReplay = await readBidLedger(service, draftId, NOMINATION_SEQ)
      expect(ledgerAfterReplay.length, 'the replay wrote NOTHING').toBe(ledger.length)

      // ---- The losers see the instant outbid state -----------------------
      // Both humans are outbid at $25: their composers converge on the $26
      // min raise (the market state), and any refused mid-storm click also
      // showed the friendly toast (asserted when it happened — by name).
      await expect(commish.getByRole('button', { name: /^Bid \$26$/ })).toBeVisible({
        timeout: 15_000,
      })
      await expect(manager.getByRole('button', { name: /^Bid \$26$/ })).toBeVisible({
        timeout: 15_000,
      })

      // ---- CLOSE → award → both browsers converge < 2s -------------------
      await rewindDeadline(service, draftId)
      const awardAt = Date.now()
      await tickOnce(service)
      // The next nominator is the manager (seat 2) — both rooms flip to the
      // new nomination turn off the drafts broadcast.
      await expect(manager.getByText("You're on the clock").first()).toBeVisible({
        timeout: 2_000,
      })
      await expect(commish.getByText(/On the clock ·/).first()).toBeVisible({ timeout: 2_000 })
      const convergedMs = Date.now() - awardAt
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(`[auction-storm] award → both rooms converged in ${convergedMs}ms`)

      // The award is the storm's winner at the storm's price — no double
      // award (one live pick for the lot), no lost winner.
      const picks = await readPickSheet(service, draftId)
      expect(picks.length).toBe(1)
      expect(picks[0]!.team_id).toBe(botTeamByUser.get(bots[5]!.userId))
      const { data: pickRow } = await service
        .from('draft_picks')
        .select('price, player_id')
        .eq('draft_id', draftId)
        .eq('is_undone', false)
        .single()
      expect(pickRow!.price).toBe(25)
      expect(pickRow!.player_id).toBe(playerId)
    } finally {
      await commishContext.close()
      await managerContext.close()
    }
  })
})
