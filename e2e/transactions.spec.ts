import { randomUUID } from 'node:crypto'

import { expect, test, type BrowserContext, type Page } from '@playwright/test'

import { commishChangeSetting } from '@/lib/leagues/api/commish-setting-service'
import { actOnTrade } from '@/lib/leagues/api/trades-service'
import { SEASON_ROUNDS } from '@/lib/leagues/sim/plan'

import {
  assertNoForeignSeasonFixtures,
  assertPlayerPoolPresent,
  cleanupSweep,
  driveDraftToCompletion,
  findUndraftedClubmate,
  nflWeekInstants,
  plantGameRow,
  provisionBotUsers,
  readFaabBalance,
  readHolder,
  readLeague,
  readLeagueClaims,
  readPoolRow,
  readTeamLineup,
  readTeamRoster,
  readTrade,
  readTradeDrops,
  readWaiverNextRun,
  readWaiverPriorities,
  recordWeekEnd,
  serviceClient,
  tradeTickAt,
  waiverTickAt,
  type BotSeatUser,
  type RosterEntry,
} from './helpers/harness'
import { provisionLeague, signInDev, signInDevPro, type AuthedUser, type ProvisionedLeague } from './helpers/provision'
import { STORAGE_STATE } from './helpers/local-env'

/**
 * Spec — THE M5 E2E: a waiver morning and the trade lifecycle in a real
 * browser (M5 task L.D3.9, tasks-M5 §6 + §9 row 1; spec §13.2 waivers, §13.3
 * trades, §14 `process-waivers` / `trade-review-expiry`, §16.2
 * `free-agents-table` / trade center, §11.2 the lineup lock; PROGRESS D414,
 * D415, D416, D417, D419, F296).
 *
 * ONE LEAGUE, FOUR STEPS, IN ORDER (`serial`): the draft is the expensive
 * part, so the four tests share one drafted league and each picks up the
 * rosters the last one left.
 *
 *   1. WAIVER MORNING — two managers put in claims on the same free agent in
 *      the browser (blind FAAB bids), the run happens at an INJECTED instant,
 *      and each manager's claims panel shows won / lost with the reason.
 *   2. A TRADE UNDER EACH REVIEW MODE, each to execution — commissioner
 *      review (approved by the commissioner in the browser), no review
 *      (executes at accept), league vote (votes by the other managers; one
 *      trade goes through at the review's end, one is vetoed by the vote).
 *   3. A DEFERRED TRADE — accepted while a player in it has played, parked
 *      until the week's last game ends, executed by the tick after that
 *      instant — and F296's `set_lineup` lock refusal on the same fixture.
 *   4. THE PREVENTED TRADE STATES (L.D3.15 — F492; D426) and the whole
 *      waiver order (F494): the standings page lists the order the run left;
 *      a full roster opens the drop picker on the builder (Send off until the
 *      drop is picked) and on the offer card (Accept off until the receiving
 *      team picks); past the deadline there is no Propose door and no
 *      Counter, a waiting offer says it can't be accepted, and Turn down
 *      still works.
 *
 * TIME — THE TWO CLOCKS, SAID PLAINLY. Every CLIENT verb (claim, propose,
 * accept, vote, the commissioner's approve, `set_lineup`) takes no caller
 * clock: its DEFINER wrapper passes the transaction's own `now()` — WALL
 * time, years before every instant of the synthetic 2099 season, so the
 * league's current week is week 1 and nothing has kicked off unless a game
 * row says so (the F284(a) shape; `transact-personas.ts` header). Only the
 * two JOBS take a virtual instant, and they are driven league-scoped through
 * the harness's job 9 (`waiverTickAt` / `tradeTickAt`) at instants derived
 * from the calendar's stored literals or the trade's own stored deadline —
 * never a raw SQL time hack. The live per-minute crons share the stack; the
 * fixture is shaped so they cannot act on it (below, at each step).
 *
 * WHO DOES WHAT. dev@ (commissioner, a team) and dev-pro@ (manager) act in
 * two BROWSER contexts; three seated bot managers (harness job 6 — the
 * auction-storm shape) accept and vote through `actOnTrade` under their OWN
 * JWT, exactly what the route runs (D100). Settings the commissioner changes
 * between steps go through `commishChangeSetting` under dev@'s JWT (the
 * provisioning shape — what the settings route runs). The service key only
 * drives the jobs, plants the week-1 game fixture and reads.
 */

const TEAM_COUNT = 8
const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/** Wall-clock past, on the synthetic season's week 1 — `inseason-lock.spec.ts`'s
 *  literal (the dev seeder's own trick): the ONE mechanism that makes a
 *  player "played" to a verb that reads the transaction's `now()`. */
const KICKOFF_PAST = '2001-09-09T17:00:00.000Z'

/** The faab bids — distinct, so the run's order is the bid's (Q71 / F422). */
const WINNING_BID = 12
const LOSING_BID = 7

interface Fixture {
  league: ProvisionedLeague
  commish: AuthedUser
  manager: AuthedUser
  bots: BotSeatUser[]
  /** bot seat team ids, in `bots` order. */
  botTeams: string[]
  /** Players no step may move — F296's target is reserved here. */
  reserved: Set<string>
  /** NFL clubs whose week-1 game has kicked off (step 3's planted row) — a
   *  later step that needs a trade to go through at once avoids them. */
  lockedClubs: Set<string>
}

let fx: Fixture | null = null
const fixture = (): Fixture => {
  if (!fx) throw new Error('the league fixture was not provisioned (beforeAll failed)')
  return fx
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function assertOk(what: string, result: { status: number; body: unknown }): Promise<void> {
  expect(result.status, `${what} answered ${result.status}: ${JSON.stringify(result.body).slice(0, 400)}`).toBe(200)
}

/** Set one league setting as the commissioner (the settings route's service). */
async function setSetting(key: string, value: string): Promise<void> {
  const { league, commish } = fixture()
  await assertOk(
    `setting ${key}=${value}`,
    await commishChangeSetting(commish.client, league.leagueId, { key, value, action_id: randomUUID() }),
  )
}

/** The first player on `teamId`'s roster not yet used by a step. */
async function takePlayer(teamId: string, used: Set<string>): Promise<RosterEntry> {
  const { league, reserved } = fixture()
  const roster = await readTeamRoster(serviceClient(), league.leagueId, teamId)
  const { lockedClubs } = fixture()
  const pick = roster.find((p) => !used.has(p.player_id) && !reserved.has(p.player_id) && p.nfl_team !== null && !lockedClubs.has(p.nfl_team))
  if (!pick) {
    throw new Error(`team ${teamId} has no unused player left — roster ${JSON.stringify(roster.map((p) => p.player_id))}`)
  }
  used.add(pick.player_id)
  return pick
}

// ---- Browser helpers ------------------------------------------------------

async function openTrades(page: Page, leagueId: string): Promise<void> {
  await page.goto(`/app/leagues/${leagueId}/trades`)
  await expect(page.locator('[data-trade-center]')).toBeVisible({ timeout: 60_000 })
}

/** Propose give → get through the builder the player-row door opens
 *  (`?with=<team>&player=<id>`, D419(6)); returns the new trade's id. */
async function proposeInBrowser(
  page: Page,
  leagueId: string,
  toTeamId: string,
  give: RosterEntry,
  get: RosterEntry,
): Promise<string> {
  await page.goto(`/app/leagues/${leagueId}/trades?with=${toTeamId}&player=${get.player_id}`)
  const builder = page.locator('[data-trade-builder="propose"]')
  await expect(builder).toBeVisible({ timeout: 60_000 })
  // The door pre-picked the player we are asking for.
  await expect(builder.locator(`[data-trade-side="get"] [data-trade-pick="${get.player_id}"]`)).toHaveAttribute('data-picked', 'true', {
    timeout: 30_000,
  })
  await builder.locator(`[data-trade-side="give"] [data-trade-pick="${give.player_id}"]`).getByRole('checkbox').click()
  await expect(builder.locator(`[data-trade-side="give"] [data-trade-pick="${give.player_id}"]`)).toHaveAttribute('data-picked', 'true')
  return sendOffer(page, leagueId)
}

/** Press the open builder's Send and return the new trade's id. */
async function sendOffer(page: Page, leagueId: string): Promise<string> {
  const posted = page.waitForResponse(
    (res) => new URL(res.url()).pathname === `/api/leagues/${leagueId}/trades` && res.request().method() === 'POST',
    { timeout: 60_000 },
  )
  await page.locator('[data-trade-builder="propose"] [data-trade-send]').click()
  const response = await posted
  const body = (await response.json()) as { trade?: { id?: string } }
  expect(response.status(), `the offer answered ${response.status()}: ${JSON.stringify(body)}`).toBe(200)
  await expect(page.locator('[data-trade-builder="sent"]')).toBeVisible({ timeout: 30_000 })
  const tradeId = body.trade?.id
  if (!tradeId) throw new Error(`the offer's answer carried no trade id: ${JSON.stringify(body)}`)
  return tradeId
}

/** Press one of a trade card's buttons and wait for the route it calls. */
async function pressTradeOp(page: Page, leagueId: string, tradeId: string, op: string): Promise<number> {
  const card = page.locator(`[data-trade="${tradeId}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  const commishOp = op === 'approve' || op === 'veto'
  const answered = page.waitForResponse(
    (res) => {
      const path = new URL(res.url()).pathname
      return commishOp
        ? path === `/api/leagues/${leagueId}/commish/trade` && res.request().method() === 'POST'
        : path === `/api/leagues/${leagueId}/trades/${tradeId}` && res.request().method() === 'PATCH'
    },
    { timeout: 60_000 },
  )
  await card.locator(`[data-trade-op="${op}"]`).click()
  return (await answered).status()
}

/** The trade's card on the History tab after a fresh read. */
async function historyCard(page: Page, leagueId: string, tradeId: string) {
  await openTrades(page, leagueId)
  await page.locator('[data-tab="history"]').click()
  const card = page.locator(`[data-trades="history"] [data-trade="${tradeId}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  return card
}

test.describe.configure({ mode: 'serial' })

test.describe('M5 transactions — a waiver morning and the trade lifecycle (real browser)', () => {
  test.beforeAll(async () => {
    test.setTimeout(420_000)
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
    await assertNoForeignSeasonFixtures(service)

    const commish = await signInDev()
    const manager = await signInDevPro()
    // Three seated bot managers: a league-vote trade between dev-pro@ and a
    // bot leaves dev@ + two bots as the managers who can vote (D415(1)).
    const bots = await provisionBotUsers(service, 3)
    const league = await provisionLeague({
      nameSuffix: 'transactions',
      teamCount: TEAM_COUNT,
      rounds: SEASON_ROUNDS,
      season: true, // SEASON_ROSTER: seven seats each — room for a claim and five trades
      clockSeconds: 30,
      commish,
      manager,
      extraManagers: bots,
      order: 'commish-first',
      createDraftRow: true,
      start: true,
    })
    const drive = await driveDraftToCompletion(service, league.draftId!, { maxSteps: 200 })
    expect(await readLeague(service, league.leagueId)).toMatchObject({ status: 'in_season' })
    // eslint-disable-next-line no-console -- the DoD evidence line
    console.log(`[transactions] ${TEAM_COUNT * SEASON_ROUNDS} picks in ${drive.steps} engine steps → ${drive.status}`)
    fx = { league, commish, manager, bots, botTeams: league.extraTeamIds, reserved: new Set(), lockedClubs: new Set() }
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('waiver morning: two blind claims → the run at an injected instant → won and lost, with the reason', async ({ browser }) => {
    test.setTimeout(300_000)
    const service = serviceClient()
    const { league } = fixture()
    const managerTeam = league.managerTeamId!
    const commishTeam = league.commishTeamId

    // ---- Track the league on the synthetic calendar (before any claim) ----
    // The live per-minute `process-waivers` cron may already have tracked the
    // league from WALL time (it seeds every untracked in-season league —
    // F423). One scoped tick eight days before week 1 settles that stale run
    // while NO claim is pending (it decides nothing) and re-tracks the league
    // onto 2099 — or seeds it. From then on the cron, reading wall time,
    // never finds this league due (`150:1339-1343`): only the injected tick
    // below can run it. The sim's own recorded move (`transact-personas.ts`).
    const week1 = await nflWeekInstants(service, 1)
    const seedAt = new Date(Date.parse(week1.starts_at) - 8 * DAY_MS).toISOString()
    const seeded = await waiverTickAt(service, league.leagueId, seedAt, ['seeded', 'settled'])
    const runAt = await readWaiverNextRun(service, league.leagueId)
    if (!runAt) throw new Error(`waiver_tick at ${seedAt} left the league untracked: ${JSON.stringify(seeded.result)}`)
    expect(Date.parse(runAt), 'the tracked run is after the seed instant').toBeGreaterThan(Date.parse(seedAt))
    expect(Date.parse(runAt), 'the tracked run is before week 1 opens').toBeLessThan(Date.parse(week1.starts_at))
    // eslint-disable-next-line no-console -- the DoD evidence line
    console.log(`[transactions] waiver tick @ ${seedAt}: ${seeded.outcome} → next run ${runAt}`)

    // ---- The contested free agent and each claimant's drop -------------
    const managerRoster = await readTeamRoster(service, league.leagueId, managerTeam)
    const commishRoster = await readTeamRoster(service, league.leagueId, commishTeam)
    const managerDrop = managerRoster.find((p) => p.nfl_team !== null)!
    const commishDrop = commishRoster.find((p) => p.nfl_team !== null)!
    const target = await findUndraftedClubmate(service, league.leagueId, managerDrop.nfl_team!)
    // eslint-disable-next-line no-console -- the DoD evidence line
    console.log(
      `[transactions] contested ${target.full_name} (${target.player_id}); dev-pro drops ${managerDrop.full_name}, ` +
        `dev drops ${commishDrop.full_name}; bids $${WINNING_BID} / $${LOSING_BID}`,
    )

    const claimInBrowser = async (context: BrowserContext, bid: number, drop: RosterEntry): Promise<Page> => {
      const page = await context.newPage()
      await page.goto(`/app/leagues/${league.leagueId}/players`)
      await expect(page.locator('[data-waiver-claims-panel]')).toBeVisible({ timeout: 60_000 })
      await page.getByLabel('Search players').fill(target.full_name)
      const row = page.locator(`[data-pool-row="${target.player_id}"]`)
      await expect(row).toBeVisible({ timeout: 60_000 })
      // Claims-only until the run (the draft just reset the window, no run has
      // counted since — `153:325`): Claim is offered and live.
      const claim = row.locator('[data-action="acquire"][data-acquire="claim"]')
      await expect(claim).toBeEnabled()
      await claim.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.locator('[data-claim-form="faab"]')).toBeVisible()
      // D481(n): a FAAB claim's one step IS the bid — no confirm on top.
      await expect(dialog.locator('[data-acquire-confirm="claim"]')).toHaveText('Place claim')
      await dialog.locator('[data-claim-bid-input]').fill(String(bid))
      await dialog.locator('[data-claim-drop]').click()
      await page.getByRole('option', { name: new RegExp(escapeRe(drop.full_name)) }).click()
      const posted = page.waitForResponse(
        (res) => new URL(res.url()).pathname === `/api/leagues/${league.leagueId}/waivers` && res.request().method() === 'POST',
        { timeout: 60_000 },
      )
      await dialog.locator('[data-claim-submit]').click()
      expect((await posted).status(), 'the claim route answers 200').toBe(200)
      await expect(dialog.locator('[data-claim-result]')).toContainText(`$${bid}`)
      await dialog.getByRole('button', { name: 'Done' }).click()
      // The pending claim is in the panel, in the run's order.
      await expect(page.locator('[data-claims-pending] [data-claim]')).toHaveCount(1, { timeout: 30_000 })
      await expect(page.locator('[data-claims-pending] [data-claim-bid]')).toHaveAttribute('data-claim-bid', String(bid))
      return page
    }

    const managerContext = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    try {
      const managerPage = await claimInBrowser(managerContext, WINNING_BID, managerDrop)
      const commishPage = await claimInBrowser(commishContext, LOSING_BID, commishDrop)

      const pending = await readLeagueClaims(service, league.leagueId)
      expect(pending.map((c) => c.status)).toEqual(['pending', 'pending'])

      // ---- THE RUN, at its own tracked instant ------------------------------
      const run = await waiverTickAt(service, league.leagueId, runAt, ['settled'])
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(`[transactions] waiver run @ ${runAt}: ${JSON.stringify(run.result)}`)

      // The server's outcome — asserted before the screen, never inferred from it.
      const settled = await readLeagueClaims(service, league.leagueId)
      const won = settled.find((c) => c.team_id === managerTeam)!
      const lost = settled.find((c) => c.team_id === commishTeam)!
      expect(won).toMatchObject({ status: 'won', add_player_id: target.player_id, faab_bid: WINNING_BID })
      expect(lost.status).toBe('lost')
      expect(lost.result_reason).toBe('outbid')
      expect(await readHolder(service, league.leagueId, target.player_id)).toBe(managerTeam)
      expect(await readHolder(service, league.leagueId, managerDrop.player_id), 'the winner’s drop left his roster').toBeNull()
      expect(await readHolder(service, league.leagueId, commishDrop.player_id), 'the loser keeps his drop').toBe(commishTeam)
      expect(await readFaabBalance(service, league.leagueId, managerTeam)).toBe(100 - WINNING_BID)
      expect(await readFaabBalance(service, league.leagueId, commishTeam)).toBe(100)

      // ---- WON / LOST on each manager's own screen, with the reason --------
      await managerPage.reload()
      const wonRow = managerPage.locator('[data-claims-results] [data-claim-result="won"]')
      await expect(wonRow).toBeVisible({ timeout: 60_000 })
      await expect(wonRow).toContainText(target.full_name)
      await expect(wonRow).toContainText(`Won for $${WINNING_BID}.`)
      await expect(managerPage.locator('[data-claims-budget]')).toContainText(`$${100 - WINNING_BID}`)

      await commishPage.reload()
      const lostRow = commishPage.locator('[data-claims-results] [data-claim-result="lost"]')
      await expect(lostRow).toBeVisible({ timeout: 60_000 })
      await expect(lostRow).toContainText(target.full_name)
      await expect(lostRow).toContainText('Another team bid more.')
      await expect(commishPage.locator('[data-claims-budget]')).toContainText('$100')
      test.info().annotations.push({
        type: 'waiver-morning',
        description: `run @ ${runAt}: dev-pro won ${target.player_id} for $${WINNING_BID}; dev lost (${lost.result_reason})`,
      })
    } finally {
      await managerContext.close()
      await commishContext.close()
    }
  })

  test('a trade under each review mode, each to its end: commissioner, none, league vote (executed + vetoed)', async ({ browser }) => {
    test.setTimeout(300_000)
    const service = serviceClient()
    const { league, bots, botTeams, reserved } = fixture()
    const managerTeam = league.managerTeamId!
    const commishTeam = league.commishTeamId
    const [bot1, bot2, bot3] = bots
    const bot1Team = botTeams[0]!
    const used = new Set<string>()

    // F296's target is RESERVED before any trade can move him: a player the
    // draft put on dev-pro's roster that nothing has touched, so he holds no
    // `league_player_pool` row (the lock tick refreshes existing rows only —
    // `119:775-780`) and the lineup editor can never show him a 🔒.
    for (const p of await readTeamRoster(service, league.leagueId, managerTeam)) {
      if (p.nfl_team !== null && (await readPoolRow(service, league.leagueId, p.player_id)) === null) {
        reserved.add(p.player_id)
        break
      }
    }
    if (reserved.size !== 1) throw new Error('dev-pro holds no untouched player without a pool row — F296 has no target')

    const botAct = async (bot: BotSeatUser, tradeId: string, body: Record<string, unknown>) =>
      assertOk(`bot ${bot.username} ${JSON.stringify(body)}`, await actOnTrade(bot.client, league.leagueId, tradeId, { ...body, action_id: randomUUID() }))

    const managerContext = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    try {
      const mPage = await managerContext.newPage()
      const cPage = await commishContext.newPage()

      // ---- (1) COMMISSIONER REVIEW (the default): approved by him ----------
      const t1Give = await takePlayer(managerTeam, used)
      const t1Get = await takePlayer(bot1Team, used)
      const t1 = await proposeInBrowser(mPage, league.leagueId, bot1Team, t1Give, t1Get)
      await botAct(bot1, t1, { op: 'accept' })
      expect((await readTrade(service, t1)).status).toBe('in_review')
      await openTrades(cPage, league.leagueId)
      await expect(cPage.locator(`[data-trade="${t1}"]`)).toHaveAttribute('data-trade-status', 'in_review', { timeout: 60_000 })
      expect(await pressTradeOp(cPage, league.leagueId, t1, 'approve'), 'the commissioner approve answers 200').toBe(200)
      await expect(cPage.locator(`[data-trade="${t1}"] [data-commish-trade-outcome]`)).toBeVisible({ timeout: 30_000 })
      expect((await readTrade(service, t1)).status).toBe('complete')
      expect(await readHolder(service, league.leagueId, t1Give.player_id)).toBe(bot1Team)
      expect(await readHolder(service, league.leagueId, t1Get.player_id)).toBe(managerTeam)
      await expect((await historyCard(mPage, league.leagueId, t1)).locator('[data-trade-status-label]')).toHaveText('Completed')

      // ---- (2) NO REVIEW: goes through at the accept, in the browser --------
      await setSetting('trade_review', 'none')
      const t2Give = await takePlayer(managerTeam, used)
      const t2Get = await takePlayer(commishTeam, used)
      const t2 = await proposeInBrowser(mPage, league.leagueId, commishTeam, t2Give, t2Get)
      await openTrades(cPage, league.leagueId)
      expect(await pressTradeOp(cPage, league.leagueId, t2, 'accept'), 'the accept answers 200').toBe(200)
      expect((await readTrade(service, t2)).status).toBe('complete')
      expect(await readHolder(service, league.leagueId, t2Give.player_id)).toBe(commishTeam)
      expect(await readHolder(service, league.leagueId, t2Get.player_id)).toBe(managerTeam)
      await expect((await historyCard(cPage, league.leagueId, t2)).locator('[data-trade-status-label]')).toHaveText('Completed')

      // ---- (3) LEAGUE VOTE: one trade through at the review's end ------------
      await setSetting('trade_review', 'league_vote')
      const t3Give = await takePlayer(managerTeam, used)
      const t3Get = await takePlayer(bot1Team, used)
      const t3 = await proposeInBrowser(mPage, league.leagueId, bot1Team, t3Give, t3Get)
      await botAct(bot1, t3, { op: 'accept' })
      expect((await readTrade(service, t3)).status).toBe('in_review')
      // dev@ votes to veto in the browser; the tally counts it, never who.
      await openTrades(cPage, league.leagueId)
      expect(await pressTradeOp(cPage, league.leagueId, t3, 'vote-veto'), 'the vote answers 200').toBe(200)
      const t3Card = cPage.locator(`[data-trade="${t3}"]`)
      // Three managers can vote (dev@ and two bots — the parties and the
      // placeholder seats cannot), so the league's number (⌈8/2⌉ = 4) is
      // capped at 3 (F430) and the card says so in words.
      await expect(t3Card.locator('[data-trade-tally]')).toHaveAttribute('data-trade-tally', '1/3', { timeout: 30_000 })
      await expect(t3Card.locator('[data-trade-tally-rule]')).toHaveAttribute('data-trade-tally-rule', 'capped')
      await botAct(bot2!, t3, { op: 'vote', vote: 'approve' })
      expect((await readTrade(service, t3)).status, 'one veto of three does not stop it').toBe('in_review')

      // ---- (4) LEAGUE VOTE: one trade vetoed by the vote ---------------------
      const t4Give = await takePlayer(managerTeam, used)
      const t4Get = await takePlayer(bot1Team, used)
      const t4 = await proposeInBrowser(mPage, league.leagueId, bot1Team, t4Give, t4Get)
      await botAct(bot1, t4, { op: 'accept' })
      await openTrades(cPage, league.leagueId)
      expect(await pressTradeOp(cPage, league.leagueId, t4, 'vote-veto')).toBe(200)
      await botAct(bot2!, t4, { op: 'vote', vote: 'veto' })
      expect((await readTrade(service, t4)).status, 'two vetoes of three do not stop it').toBe('in_review')
      await botAct(bot3!, t4, { op: 'vote', vote: 'veto' })
      // The vote that reaches the number vetoes at once (D415(3)).
      const t4Row = await readTrade(service, t4)
      expect(t4Row.status).toBe('vetoed')
      expect(await readHolder(service, league.leagueId, t4Give.player_id), 'a vetoed trade moves nobody').toBe(managerTeam)
      const t4Card = await historyCard(mPage, league.leagueId, t4)
      await expect(t4Card.locator('[data-trade-status-label]')).toHaveText('Vetoed')
      await expect(t4Card.locator('[data-trade-detail]')).toContainText('3 of the 3 managers who can vote voted to veto')

      // The review ends: the tick at the trade's OWN stored deadline + 1 min.
      const t3Row = await readTrade(service, t3)
      expect(t3Row.review_deadline, 'a league-vote trade in review carries its deadline').not.toBeNull()
      const t3At = new Date(Date.parse(t3Row.review_deadline!) + MINUTE_MS).toISOString()
      const t3Tick = await tradeTickAt(service, league.leagueId, t3At)
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(`[transactions] trade_tick @ ${t3At}: ${JSON.stringify(t3Tick.actions)}`)
      expect(Number(t3Tick.executed)).toBe(1)
      expect((await readTrade(service, t3)).status).toBe('complete')
      expect(await readHolder(service, league.leagueId, t3Give.player_id)).toBe(bot1Team)
      expect(await readHolder(service, league.leagueId, t3Get.player_id)).toBe(managerTeam)
      await expect((await historyCard(cPage, league.leagueId, t3)).locator('[data-trade-status-label]')).toHaveText('Completed')
      test.info().annotations.push({
        type: 'review-modes',
        description: `commissioner ${t1} · none ${t2} · league vote ${t3} (complete @ ${t3At}) · league vote ${t4} (vetoed 3/3)`,
      })
    } finally {
      await managerContext.close()
      await commishContext.close()
    }
  })

  test('a deferred trade goes through after the week’s last game; set_lineup refuses a played player (F296)', async ({ browser }) => {
    test.setTimeout(300_000)
    const service = serviceClient()
    const { league, reserved } = fixture()
    const managerTeam = league.managerTeamId!
    const commishTeam = league.commishTeamId
    const used = new Set<string>()
    await setSetting('trade_review', 'none')

    // F296's reserved target and the deferred trade's asset — both dev-pro's.
    const managerRoster = await readTeamRoster(service, league.leagueId, managerTeam)
    const f296 = managerRoster.find((p) => reserved.has(p.player_id))
    if (!f296) throw new Error('F296’s reserved target left dev-pro’s roster')
    expect(await readPoolRow(service, league.leagueId, f296.player_id), 'F296’s premise: no pool row, so no 🔒').toBeNull()
    const played = await takePlayer(managerTeam, used)
    const theirs = await takePlayer(commishTeam, used)

    // ---- Week 1's game kicks off (wall-clock past); its end is recorded ----
    // ONE game row covers both clubs. The recorded end is a 2099 instant, so
    // the lock release (`153:169` — the end, capped by the ceiling) is far
    // ahead of wall time: the live trade-tick cron never finds the parked
    // trade due, only the injected tick below can release it.
    const week1 = await nflWeekInstants(service, 1)
    const lastEnd = new Date(Date.parse(week1.starts_at) + 5 * DAY_MS).toISOString()
    const gameId = await plantGameRow(service, {
      suffix: 'd39-wk1',
      week: 1,
      homeTeam: played.nfl_team!,
      awayTeam: f296.nfl_team === played.nfl_team ? 'ZZX' : f296.nfl_team!,
      kickoffAt: KICKOFF_PAST,
      status: 'final',
    })
    await recordWeekEnd(service, 1, lastEnd)
    fixture().lockedClubs.add(played.nfl_team!)
    if (f296.nfl_team) fixture().lockedClubs.add(f296.nfl_team)
    // eslint-disable-next-line no-console -- the DoD evidence line
    console.log(
      `[transactions] planted ${gameId}: ${played.full_name} (${played.nfl_team}) + F296 ${f296.full_name} ` +
        `(${f296.nfl_team}) kicked off ${KICKOFF_PAST}; week 1 ends ${lastEnd}`,
    )

    const managerContext = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    try {
      const mPage = await managerContext.newPage()
      const cPage = await commishContext.newPage()

      // ---- (5) THE DEFERRED TRADE (Q75 `defer`, the league default) ---------
      const t5 = await proposeInBrowser(mPage, league.leagueId, commishTeam, played, theirs)
      await openTrades(cPage, league.leagueId)
      expect(await pressTradeOp(cPage, league.leagueId, t5, 'accept'), 'the accept answers 200').toBe(200)
      const parked = await readTrade(service, t5)
      expect(parked.status, 'accepted with a played player: parked, not executed').toBe('accepted')
      expect(Date.parse(parked.execute_after!), 'parked until the week’s recorded end').toBe(Date.parse(lastEnd))
      expect(await readHolder(service, league.leagueId, played.player_id)).toBe(managerTeam)
      await cPage.reload()
      const parkedCard = cPage.locator(`[data-trade="${t5}"]`)
      await expect(parkedCard).toHaveAttribute('data-trade-status', 'accepted', { timeout: 60_000 })
      await expect(parkedCard.locator('[data-trade-status-label]')).toHaveText('Waiting for games to end')
      await expect(parkedCard.locator('[data-trade-deferred]')).toBeVisible()

      // One minute BEFORE the release the tick re-parks it (nothing moves) —
      // the boundary's negative side, so the pass below is the release and
      // not any tick at all.
      const early = await tradeTickAt(service, league.leagueId, new Date(Date.parse(lastEnd) - MINUTE_MS).toISOString(), {
        expectAction: false,
      })
      expect(early.reason, `the tick before the release: ${JSON.stringify(early)}`).toBe('nothing_due')
      expect(Number(early.executed)).toBe(0)
      expect((await readTrade(service, t5)).status).toBe('accepted')

      // One minute AFTER the release: it goes through.
      const releaseAt = new Date(Date.parse(lastEnd) + MINUTE_MS).toISOString()
      const release = await tradeTickAt(service, league.leagueId, releaseAt)
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(`[transactions] trade_tick @ ${releaseAt}: ${JSON.stringify(release.actions)}`)
      expect(Number(release.executed)).toBe(1)
      expect((await readTrade(service, t5)).status).toBe('complete')
      expect(await readHolder(service, league.leagueId, played.player_id)).toBe(commishTeam)
      expect(await readHolder(service, league.leagueId, theirs.player_id)).toBe(managerTeam)
      await expect((await historyCard(mPage, league.leagueId, t5)).locator('[data-trade-status-label]')).toHaveText('Completed')

      // ---- (6) F296 — `set_lineup`'s SERVER lock refusal in a browser --------
      // He has no pool row, so the editor shows no 🔒 and lets the move be
      // sent (the client decides nothing — `lineup-editor-ops.ts` reads the
      // pool view only); the server judges his kickoff at the transaction's
      // `now()` and refuses by name.
      const stored = await readTeamLineup(service, managerTeam, 1)
      const storedSlot = Object.entries(stored?.slot_map ?? {}).find(([, pid]) => pid === f296.player_id)?.[0] ?? null
      await mPage.goto(`/app/leagues/${league.leagueId}/team/${managerTeam}`)
      const editor = mPage.locator(`[data-lineup-editor="${managerTeam}"]`)
      await expect(editor).toBeVisible({ timeout: 60_000 })
      const target = editor.locator(`[data-player="${f296.player_id}"]`)
      await expect(target).toBeVisible({ timeout: 30_000 })
      const refused = mPage.waitForResponse(
        (res) => new URL(res.url()).pathname.endsWith('/lineup') && res.request().method() === 'PATCH',
        { timeout: 60_000 },
      )
      // League UX batch 3 (D478): the Move menu, and the move saves itself.
      await editor.locator(`[data-move-menu="${f296.player_id}"]`).click()
      if (storedSlot) {
        // A stored starter: bench him.
        await mPage.locator('[data-move-option="bench"]').click()
      } else {
        // On the bench: seat him in his position's slot.
        const slotKey = `${(f296.position === 'DEF' ? 'DST' : f296.position).toLowerCase()}:0`
        await mPage.locator(`[data-move-option="${slotKey}"]`).click()
      }
      expect((await refused).status(), 'a lineup lock refusal maps to 409').toBe(409)
      const alert = editor.getByRole('alert').filter({ hasText: f296.full_name })
      await expect(alert).toBeVisible({ timeout: 30_000 })
      const refusalText = (await alert.innerText()).replace(/\s+/g, ' ').trim()
      // The STABLE SPINE of the set_lineup lock sentence (step (7), `154`),
      // either arm: a stored starter's slot is locked / a played player
      // cannot enter a slot. Both name him and his kickoff.
      expect(refusalText).toContain(f296.full_name)
      expect(refusalText).toMatch(/kicked off/)
      expect(refusalText).not.toContain('set_lineup:')
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(`[transactions] F296 server refusal (${storedSlot ? 'stored starter' : 'bench → slot'}): ${refusalText}`)
      // Nothing was written.
      expect((await readTeamLineup(service, managerTeam, 1))?.slot_map ?? {}).toEqual(stored?.slot_map ?? {})
      test.info().annotations.push({
        type: 'deferred-and-f296',
        description: `${t5} parked until ${lastEnd}, complete @ ${releaseAt}; F296 refusal on ${f296.player_id}`,
      })
    } finally {
      await managerContext.close()
      await commishContext.close()
    }
  })

  test('the prevented trade states (F492) and the whole waiver order (F494): full rosters pick their drops; past the deadline, no doors', async ({ browser }) => {
    test.setTimeout(300_000)
    const service = serviceClient()
    const { league } = fixture()
    const managerTeam = league.managerTeamId!
    const commishTeam = league.commishTeamId
    const used = new Set<string>()
    await setSetting('trade_review', 'none') // an accept goes through at once

    // Every roster is full (SEASON_ROSTER: 7 seats, 7 rounds, and every step
    // so far swapped one for one) — the premise both drop states stand on.
    for (const team of [managerTeam, commishTeam]) {
      expect((await readTeamRoster(service, league.leagueId, team)).length, `team ${team} is full`).toBe(SEASON_ROUNDS)
    }

    const managerContext = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    try {
      const mPage = await managerContext.newPage()
      const cPage = await commishContext.newPage()

      // ---- (0) F494 — THE WHOLE WAIVER ORDER, on the standings page ----------
      // The order is the one the server STORED (163 at the draft's end, then
      // step 1's run: dev-pro won, so dev-pro went to the back — F422(a)). The
      // league is FAAB with the rolling tiebreak (the default), so the list is
      // titled as the tie order for equal bids.
      const stored = await readWaiverPriorities(service, league.leagueId)
      expect(stored.size).toBe(TEAM_COUNT)
      expect([...stored.values()].sort((a, b) => (a ?? 0) - (b ?? 0)), 'one stored place per team, 1…N').toEqual(
        Array.from({ length: TEAM_COUNT }, (_, i) => i + 1),
      )
      expect(stored.get(managerTeam), 'the claim step’s winner went to the back').toBe(TEAM_COUNT)
      const storedOrder = [...stored.entries()].sort((a, b) => a[1]! - b[1]!).map(([team]) => team)
      await mPage.goto(`/app/leagues/${league.leagueId}/standings`)
      const orderList = mPage.locator('[data-waiver-order="order"]')
      await expect(orderList).toBeVisible({ timeout: 60_000 })
      await expect(orderList.getByRole('heading')).toHaveText('Tie order for equal bids')
      const shownTeams = orderList.locator('[data-waiver-order-team]')
      await expect(shownTeams).toHaveCount(TEAM_COUNT)
      const shown = await shownTeams.evaluateAll((els) =>
        els.map((el) => [el.getAttribute('data-waiver-order-team'), el.getAttribute('data-waiver-priority')]),
      )
      expect(shown, 'the list is the stored order, #1 first').toEqual(storedOrder.map((team) => [team, String(stored.get(team))]))
      await expect(orderList.locator(`[data-waiver-order-team="${managerTeam}"]`)).toHaveAttribute('data-mine', 'true')
      await expect(orderList.locator('[data-mine]')).toHaveCount(1)

      // ---- (1) THE BUILDER: dev-pro's roster would be over → the drop picker -
      // One for two: dev-pro gets two players and gives one, so its full roster
      // would be one over. Send stays off until one drop is picked.
      const give1 = await takePlayer(managerTeam, used)
      const get1 = await takePlayer(commishTeam, used)
      const get2 = await takePlayer(commishTeam, used)
      const drop1 = await takePlayer(managerTeam, used)
      await mPage.goto(`/app/leagues/${league.leagueId}/trades?with=${commishTeam}&player=${get1.player_id}`)
      const builder = mPage.locator('[data-trade-builder="propose"]')
      await expect(builder).toBeVisible({ timeout: 60_000 })
      await expect(builder.locator(`[data-trade-side="get"] [data-trade-pick="${get1.player_id}"]`)).toHaveAttribute('data-picked', 'true', {
        timeout: 30_000,
      })
      await builder.locator(`[data-trade-side="get"] [data-trade-pick="${get2.player_id}"]`).getByRole('checkbox').click()
      await builder.locator(`[data-trade-side="give"] [data-trade-pick="${give1.player_id}"]`).getByRole('checkbox').click()
      const send = builder.locator('[data-trade-send]')
      const gate = builder.locator('[data-trade-gate]')
      await expect(gate).toHaveAttribute('data-trade-gate', 'blocked', { timeout: 30_000 })
      await expect(gate).toHaveText('Pick 1 more player to drop so your roster fits.')
      await expect(builder.locator('[data-trade-drops]')).toHaveAttribute('data-trade-drops', 'open')
      await expect(builder.locator('[data-trade-drops-prompt]')).toHaveAttribute('data-trade-drops-prompt', '1')
      await expect(builder.locator('[data-trade-drops-prompt]')).toContainText('pick 1 more player to drop')
      await expect(send).toBeDisabled()
      await builder.locator(`[data-trade-drops] [data-trade-pick="${drop1.player_id}"]`).getByRole('checkbox').click()
      await expect(gate).toHaveAttribute('data-trade-gate', 'ok', { timeout: 30_000 })
      await expect(send).toBeEnabled()
      const o1 = await sendOffer(mPage, league.leagueId)
      expect((await readTrade(service, o1)).status).toBe('proposed')
      expect(await readTradeDrops(service, o1), 'the drop was stored with the offer').toEqual([{ team_id: managerTeam, player_id: drop1.player_id }])

      // ---- (2) THE CARD: dev@'s roster would be over → he picks on the card --
      // Two for one: dev@ gets two and gives one. The builder says so and sends;
      // on dev@'s card the drop picker is there before anything is pressed and
      // Accept stays off until he picks.
      const give2 = await takePlayer(managerTeam, used)
      const give3 = await takePlayer(managerTeam, used)
      const get3 = await takePlayer(commishTeam, used)
      const drop2 = await takePlayer(commishTeam, used)
      await mPage.goto(`/app/leagues/${league.leagueId}/trades?with=${commishTeam}&player=${get3.player_id}`)
      await expect(builder).toBeVisible({ timeout: 60_000 })
      await expect(builder.locator(`[data-trade-side="get"] [data-trade-pick="${get3.player_id}"]`)).toHaveAttribute('data-picked', 'true', {
        timeout: 30_000,
      })
      await builder.locator(`[data-trade-side="give"] [data-trade-pick="${give2.player_id}"]`).getByRole('checkbox').click()
      await builder.locator(`[data-trade-side="give"] [data-trade-pick="${give3.player_id}"]`).getByRole('checkbox').click()
      await expect(gate).toHaveAttribute('data-trade-gate', 'ok', { timeout: 30_000 })
      await expect(gate).toContainText('would be 1 over, so they’ll pick a player to drop when they accept')
      const o2 = await sendOffer(mPage, league.leagueId)

      await openTrades(cPage, league.leagueId)
      const card2 = cPage.locator(`[data-trade="${o2}"]`)
      await expect(card2).toBeVisible({ timeout: 60_000 })
      const picker2 = card2.locator('[data-accept-drops]')
      await expect(picker2).toHaveAttribute('data-accept-must-drop', '1', { timeout: 30_000 })
      await expect(picker2).toContainText('Your roster would be over its size — pick 1 more player to drop.')
      await expect(card2.locator('[data-accept-with-drops]')).toBeDisabled()
      await expect(card2.locator('[data-trade-op="accept"]')).toHaveCount(0)
      await picker2.locator(`[data-trade-pick="${drop2.player_id}"]`).getByRole('checkbox').click()
      await expect(picker2).toHaveAttribute('data-accept-must-drop', '0', { timeout: 30_000 })
      await expect(card2.locator('[data-accept-with-drops]')).toBeEnabled()
      const accepted = cPage.waitForResponse(
        (res) => new URL(res.url()).pathname === `/api/leagues/${league.leagueId}/trades/${o2}` && res.request().method() === 'PATCH',
        { timeout: 60_000 },
      )
      await card2.locator('[data-accept-with-drops]').click()
      expect((await accepted).status(), 'the accept with the drop answers 200').toBe(200)
      expect((await readTrade(service, o2)).status).toBe('complete')
      expect(await readHolder(service, league.leagueId, give2.player_id)).toBe(commishTeam)
      expect(await readHolder(service, league.leagueId, give3.player_id)).toBe(commishTeam)
      expect(await readHolder(service, league.leagueId, get3.player_id)).toBe(managerTeam)
      expect(await readHolder(service, league.leagueId, drop2.player_id), 'dev@’s pick was dropped').toBeNull()
      expect((await readTeamRoster(service, league.leagueId, commishTeam)).length, 'dev@’s roster fits').toBe(SEASON_ROUNDS)
      await expect((await historyCard(cPage, league.leagueId, o2)).locator('[data-trade-status-label]')).toHaveText('Completed')

      // ---- (3) PAST THE DEADLINE -----------------------------------------------
      // The doors first, with the deadline ahead (the control): a Propose trade
      // door on dev@'s team page; Accept and Counter on the offer dev@ holds.
      await mPage.goto(`/app/leagues/${league.leagueId}/team/${commishTeam}`)
      await expect(mPage.locator('[data-team-waiver-seat]')).toBeVisible({ timeout: 60_000 })
      await expect(mPage.locator('[data-propose-trade]')).toBeVisible({ timeout: 30_000 })
      await openTrades(cPage, league.leagueId)
      const card1 = cPage.locator(`[data-trade="${o1}"]`)
      await expect(card1.locator('[data-trade-op="accept"]')).toBeEnabled({ timeout: 30_000 })
      await expect(card1.locator('[data-trade-op="counter"]')).toBeVisible()

      // THE INJECTION, AT THE NETWORK EDGE. `trade_deadline` judges `passed` at
      // the database's now() — wall time, decades before the synthetic 2099
      // calendar's deadline — and takes no caller clock, so no harness job can
      // move it (PROGRESS D431). The route below fetches the SERVER's real
      // answer and returns what the same read answers one minute past that
      // instant (162's `trade_deadline_view_internal` at p_at = deadline + 1
      // min: passed, no time remaining); the instant, week and label stay the
      // server's. The binding of `passed` to the verbs' own refusal is pgTAP
      // 110 B2 / B3. Every other request goes to the real server.
      const deadlinePath = `/api/leagues/${league.leagueId}/trades/deadline`
      const real: Array<{ passed: boolean; deadline_at: string | null }> = []
      const inject = (context: BrowserContext) =>
        context.route(
          (url) => url.pathname === deadlinePath,
          async (route) => {
            const response = await route.fetch()
            const view = (await response.json()) as { passed: boolean; deadline_at: string | null }
            real.push(view)
            const past = view.deadline_at ? new Date(Date.parse(view.deadline_at) + MINUTE_MS).toISOString() : null
            await route.fulfill({ response, json: { ...view, passed: true, ms_remaining: null, evaluated_at: past } })
          },
        )
      await inject(managerContext)
      await inject(commishContext)

      // dev-pro: no Propose trade on another team's page; on the trade center
      // the door is the closed-for-the-season line, and the ?with= door opens
      // no builder.
      const teamRead = mPage.waitForResponse((res) => new URL(res.url()).pathname === deadlinePath, { timeout: 60_000 })
      await mPage.reload()
      await teamRead
      await expect(mPage.locator('[data-team-waiver-seat]')).toBeVisible({ timeout: 60_000 })
      await expect(mPage.locator('[data-propose-trade]')).toHaveCount(0, { timeout: 30_000 })
      await mPage.goto(`/app/leagues/${league.leagueId}/trades?with=${commishTeam}&player=${get1.player_id}`)
      const closed = mPage.locator('[data-trade-door-closed="deadline"]')
      await expect(closed).toBeVisible({ timeout: 60_000 })
      await expect(closed).toContainText('Offers can’t be made, accepted or countered now')
      await expect(mPage.locator('[data-trade-deadline-passed="true"]')).toBeVisible()
      await expect(mPage.locator('[data-propose-open]')).toHaveCount(0)
      await expect(mPage.locator('[data-trade-builder]')).toHaveCount(0)

      // dev@: the waiting offer says it can't be accepted or countered; no
      // Accept, no Counter, no drop picker — Turn down still works.
      await cPage.reload()
      await expect(cPage.locator('[data-trade-deadline-passed="true"]')).toBeVisible({ timeout: 60_000 })
      const gate1 = card1.locator('[data-accept-gate="blocked"]')
      await expect(gate1).toBeVisible({ timeout: 30_000 })
      await expect(gate1).toContainText('this offer can’t be accepted or countered now')
      await expect(gate1).toContainText('you can still turn it down')
      await expect(card1.locator('[data-trade-op="accept"]')).toHaveCount(0)
      await expect(card1.locator('[data-trade-op="accept-drops"]')).toHaveCount(0)
      await expect(card1.locator('[data-accept-with-drops]')).toHaveCount(0)
      await expect(card1.locator('[data-trade-op="counter"]')).toHaveCount(0)
      expect(await pressTradeOp(cPage, league.leagueId, o1, 'reject'), 'Turn down answers 200').toBe(200)
      expect((await readTrade(service, o1)).status).toBe('rejected')
      expect(await readHolder(service, league.leagueId, give1.player_id), 'a turned-down offer moves nobody').toBe(managerTeam)
      expect(await readHolder(service, league.leagueId, drop1.player_id), 'nor drops anybody').toBe(managerTeam)
      await expect((await historyCard(cPage, league.leagueId, o1)).locator('[data-trade-status-label]')).toHaveText('Turned down')

      // The injection rewrote real answers only: the server's deadline was
      // real and still ahead each time it was read.
      expect(real.length, 'the deadline read was intercepted').toBeGreaterThan(0)
      for (const view of real) {
        expect(view.passed, 'the server’s own answer: not passed').toBe(false)
        expect(view.deadline_at, 'the server’s own answer: a real instant').not.toBeNull()
      }
      test.info().annotations.push({
        type: 'prevented-trade-states',
        description: `builder drop ${o1} (turned down past the deadline) · card drop ${o2} (complete) · waiver order ${storedOrder.join(',')}`,
      })
    } finally {
      await managerContext.close()
      await commishContext.close()
    }
  })
})
