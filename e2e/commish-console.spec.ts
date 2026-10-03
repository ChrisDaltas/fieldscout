import { randomUUID } from 'node:crypto'

import { expect, test, type BrowserContext, type Page } from '@playwright/test'

import { pointsWords } from '@/components/leagues/corrections-view-ops'
import { commishChangeSetting } from '@/lib/leagues/api/commish-setting-service'
import { TRADE_COMPLETED_POST_PREFIX } from '@/lib/leagues/api/activity-service'
import { actOnTrade, proposeTrade } from '@/lib/leagues/api/trades-service'
import { SEASON_ROUNDS } from '@/lib/leagues/sim/plan'

import {
  advanceWeekAt,
  assertNoForeignSeasonFixtures,
  assertPlayerPoolPresent,
  cleanupSweep,
  driveDraftToCompletion,
  driveScoreBatch,
  injectStatCorrection,
  nflWeekInstants,
  plantGameRow,
  plantStatLines,
  provisionBotUsers,
  readCommishActions,
  readHolder,
  readLeague,
  readLeagueCorrections,
  readLeagueTeams,
  readTeamLineup,
  readTeamRoster,
  readTrade,
  recordWeekEnd,
  serviceClient,
  setInWeekGamesFinal,
  upsertLineupRow,
  type BotSeatUser,
  type RosterEntry,
  type StatLine,
} from './helpers/harness'
import { provisionLeague, signInDev, signInDevPro, type AuthedUser, type ProvisionedLeague } from './helpers/provision'
import { DEV_USER, STORAGE_STATE } from './helpers/local-env'

/**
 * Spec — THE M6 E2E: the Commissioner Console, the audit it leaves, and a
 * stat correction in the league's view (M6 task L.E1.36, tasks-M6 §6 + §9
 * row 1, in the RULED form: Q83 dropped the illegal-lineup report — "this is
 * not a thing" — so there is no report leg; spec §10.1 / §10.3 / §13.3 /
 * §13.4 / §16.1 / §23.4; PROGRESS D457 (the console), D459 (the Activity
 * page), D463 (the 2026-09-30 trade ruling), D453 / D456 (corrections); the
 * owed rows F519 (teardown order — in the harness), F545 and F552).
 *
 * ONE DRAFTED LEAGUE, THREE STEPS, IN ORDER (`serial`):
 *
 *   1. THE CONSOLE → "NEEDS YOU" → A LINEUP FIXED IN OVERRIDE MODE. dev@ (the
 *      commissioner) opens `/commish`. Its "Needs you" lists every team with
 *      no manager and autopilot off (L.E1.32's summary — the only item kind
 *      that leads to a lineup: "Open the team to set its lineup"). Following
 *      that door turns override mode on; the commissioner seats a player for
 *      the unmanaged team and saves the override (`commish_edit_lineup` — one
 *      receipt, acting for that team, D451). dev-pro@ — a second member —
 *      then sees it on League Home's activity (the commissioner log section)
 *      and on the Activity page's Commissioner tab, and the ✸ entry link
 *      (`?entry=`) opens the log AT that entry (F545's third sentence).
 *   2. THE COMMISSIONER'S TRADE CARD AFTER THE 2026-09-30 RULING (F552) AND
 *      THE TRADES TOPIC ON REAL ROWS (F545). With override mode on, dev@'s
 *      card on an offer between two other teams carries no button; once
 *      accepted (in review) it carries Veto and "Force it through", and Force
 *      confirms and lands; the completed trade carries nothing. A second
 *      trade is vetoed by the commissioner, a third by the league vote. On
 *      dev-pro's Activity page the Trades tab holds exactly those three —
 *      the forced trade ONE ✸ line linked to its receipt, both vetoes — and
 *      no "Trade completed:" duplicate on All (F463). (Reverse no longer
 *      exists since 174 — "Remove reverse" — so the Trades topic has no
 *      reversal line to show.)
 *   3. A STAT CORRECTION IN THE VIEW. Week 1 is scored through the real
 *      worker, its games go final and the week closes into its correction
 *      window; a stat fix to dev-pro's starting WR is injected through the
 *      PRODUCTION ingest path (harness job 9's `injectStatCorrection` — the
 *      real `ingestWeek` over a one-line fixture provider; the ingest door
 *      records the event), the worker sends it to the scoring door, and
 *      dev-pro's Activity page → Stat corrections shows the correction in
 *      words with his team's score before → after.
 *
 * WHO DOES WHAT. dev@ and dev-pro@ act in two BROWSER contexts; three seated
 * bot managers (harness job 6) accept and vote through `actOnTrade` under
 * their OWN JWT (what the route runs — D100), and dev-pro's offers go through
 * `proposeTrade` under HIS JWT (the offer is not what step 2 tests; the
 * commissioner's card is). The service key only drives the week jobs, plants
 * the week-1 fixture, injects the correction through the ingest door, and
 * reads the server's word beside the screen.
 *
 * TIME. Client verbs take no caller clock (the transaction's `now()` is wall
 * time, years before the synthetic 2099 season, so nothing has kicked off);
 * the week jobs and the ingest poll run at instants derived from the
 * calendar's stored literals (`nflWeekInstants`).
 */

const TEAM_COUNT = 8
const WEEK = 1
const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/** SEASON_ROSTER's six starting seats (`plan.ts`), in slot-key form. */
const SEASON_SLOTS: ReadonlyArray<{ key: string; position: string }> = [
  { key: 'qb:0', position: 'QB' },
  { key: 'rb:0', position: 'RB' },
  { key: 'wr:0', position: 'WR' },
  { key: 'te:0', position: 'TE' },
  { key: 'k:0', position: 'K' },
  { key: 'dst:0', position: 'DST' },
]

const normalize = (position: string): string => (position === 'DEF' ? 'DST' : position)

function seatingPlan(roster: readonly RosterEntry[]): Record<string, string> {
  const used = new Set<string>()
  const plan: Record<string, string> = {}
  for (const slot of SEASON_SLOTS) {
    const pick = roster.find((p) => !used.has(p.player_id) && normalize(p.position) === slot.position)
    if (pick) {
      used.add(pick.player_id)
      plan[slot.key] = pick.player_id
    }
  }
  return plan
}

/** `inseason-week.spec.ts`'s position-shaped lines: every seated starter has a
 *  delivered row (the Q42 safe construction), a D/ST line delivers its yards
 *  allowed (F471). The point values are the league's frozen snapshot's. */
function statLineFor(playerId: string, position: string, teamIndex: number): StatLine {
  const p = normalize(position)
  const bump = teamIndex + 1
  if (p === 'QB') return { player_id: playerId, pass_yards: 200 + bump * 10, pass_tds: 1 + (teamIndex % 3) }
  if (p === 'RB') return { player_id: playerId, rush_yards: 50 + bump * 7, rush_tds: teamIndex % 2 }
  if (p === 'WR') return { player_id: playerId, receptions: 3, receiving_yards: 40 + bump * 5, receiving_tds: (teamIndex + 1) % 2 }
  if (p === 'TE') return { player_id: playerId, receptions: 2, receiving_yards: 20 + bump * 3 }
  if (p === 'DST') return { player_id: playerId, def_yards_allowed: 350 }
  return { player_id: playerId }
}

interface Fixture {
  league: ProvisionedLeague
  commish: AuthedUser
  manager: AuthedUser
  bots: BotSeatUser[]
  botTeams: string[]
  /** Step 1's receipt — the override lineup. */
  lineupReceiptId: string | null
}

let fx: Fixture | null = null
const fixture = (): Fixture => {
  if (!fx) throw new Error('the league fixture was not provisioned (beforeAll failed)')
  return fx
}

async function assertOk(what: string, result: { status: number; body: unknown }): Promise<void> {
  expect(result.status, `${what} answered ${result.status}: ${JSON.stringify(result.body).slice(0, 400)}`).toBe(200)
}

/** The trade center, with override mode on. League UX batch 1: the mode is
 *  switched on from the console (or League settings) only — the console's
 *  "Trade center" door turns it on as it is followed (a client-side
 *  navigation, so the in-memory mode survives), and the league header then
 *  shows the indicator. */
async function openTradesInOverride(page: Page, leagueId: string): Promise<void> {
  await page.goto(`/app/leagues/${leagueId}/commish`)
  const door = page.locator(`[data-tool-door="trades"][href="/app/leagues/${leagueId}/trades"]`)
  await expect(door).toBeVisible({ timeout: 60_000 })
  await expect(door).toHaveAttribute('data-override-door', 'on')
  await door.click()
  await page.waitForURL(`**/app/leagues/${leagueId}/trades`, { timeout: 60_000 })
  await expect(page.locator('[data-trade-center]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-league-header] [data-override-indicator]')).toBeVisible({ timeout: 15_000 })
}

test.describe.configure({ mode: 'serial' })

test.describe('M6 — the console, its audit, and a correction in the view (real browser)', () => {
  test.beforeAll(async () => {
    test.setTimeout(420_000)
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
    await assertNoForeignSeasonFixtures(service)

    const commish = await signInDev()
    const manager = await signInDevPro()
    // Three seated bots: a league-vote trade between dev-pro@ and bot 1 leaves
    // dev@ + two bots as the managers who can vote (D415(1)); three seats stay
    // placeholders — the "needs you" teams.
    const bots = await provisionBotUsers(service, 3)
    const league = await provisionLeague({
      nameSuffix: 'commish console',
      teamCount: TEAM_COUNT,
      rounds: SEASON_ROUNDS,
      season: true,
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
    console.log(`[commish-console] ${TEAM_COUNT * SEASON_ROUNDS} picks in ${drive.steps} engine steps → ${drive.status}`)
    fx = { league, commish, manager, bots, botTeams: league.extraTeamIds, lineupReceiptId: null }
  })

  test.afterAll(async () => {
    // F519: this league holds receipts acting FOR a team (step 1's override
    // lineup, D451) — the sweep's detach → league → teams order is what lets
    // it go.
    await cleanupSweep(serviceClient())
  })

  test('the console’s “needs you” → a lineup fixed in override mode → a second member sees it on League Home and the Activity page', async ({ browser }) => {
    test.setTimeout(300_000)
    const service = serviceClient()
    const { league } = fixture()
    const unmanaged = league.placeholderTeamIds
    expect(unmanaged.length, 'three seats stay placeholders').toBe(TEAM_COUNT - 5)
    const target = unmanaged[0]!
    const receiptsBefore = await readCommishActions(service, league.leagueId)

    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    const managerContext = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    try {
      const cPage = await commishContext.newPage()

      // ---- (1) THE CONSOLE — "Needs you" ------------------------------------
      await cPage.goto(`/app/leagues/${league.leagueId}/commish`)
      await expect(cPage.locator('[data-commish-console="in_season"]')).toBeVisible({ timeout: 60_000 })
      const needs = cPage.locator('[data-commish-needs] [data-needs-item="unmanaged"]')
      // Every team with no manager (and autopilot off — 139's default), one item each.
      await expect(needs).toHaveCount(unmanaged.length, { timeout: 60_000 })
      const offered = await cPage.locator('[data-needs-door="unmanaged"]').evaluateAll((els) => els.map((el) => el.getAttribute('href')))
      expect(offered.sort()).toEqual(unmanaged.map((id) => `/app/leagues/${league.leagueId}/team/${id}`).sort())
      await expect(cPage.locator('[data-override-toggle]').first()).toHaveAttribute('data-override-toggle', 'off')
      const door = cPage.locator(`[data-needs-door="unmanaged"][href="/app/leagues/${league.leagueId}/team/${target}"]`)
      await expect(door).toHaveAttribute('data-override-door', 'on')
      await expect(door.locator('xpath=ancestor::li[1]')).toContainText('has no manager, and autopilot is off.')
      await door.click()

      // ---- (2) THE TEAM PAGE — override mode is on (the door turned it on) ---
      await cPage.waitForURL(`**/app/leagues/${league.leagueId}/team/${target}`, { timeout: 60_000 })
      await expect(cPage.locator('[data-league-header] [data-override-indicator]')).toBeVisible({ timeout: 60_000 })
      const editor = cPage.locator(`[data-lineup-editor="${target}"]`)
      await expect(editor).toBeVisible({ timeout: 60_000 })
      await expect(editor).toHaveAttribute('data-override-mode', 'on')

      // The fix: seat a player the stored week-1 lineup does not start.
      const roster = await readTeamRoster(service, league.leagueId, target)
      const stored = await readTeamLineup(service, target, WEEK)
      const starting = new Set(Object.values(stored?.slot_map ?? {}))
      const mover = roster.find((p) => !starting.has(p.player_id) && SEASON_SLOTS.some((s) => s.position === normalize(p.position)))
      if (!mover) throw new Error(`team ${target} has no benched player with a starting slot — roster ${JSON.stringify(roster)}`)
      const slotKey = `${normalize(mover.position).toLowerCase()}:0`
      const saved = cPage.waitForResponse(
        (res) => new URL(res.url()).pathname === `/api/leagues/${league.leagueId}/commish/lineup` && res.request().method() !== 'GET',
        { timeout: 60_000 },
      )
      // League UX batch 3 (D478): no Save button — the Move menu's seat
      // saves itself, through the override route while the mode is on.
      await expect(editor.locator('[data-save-lineup]')).toHaveCount(0)
      await editor.locator(`[data-move-menu="${mover.player_id}"]`).click()
      await cPage.locator(`[data-move-option="${slotKey}"]`).click()
      expect((await saved).status(), 'the override save answers 200').toBe(200)

      // The server's word: the lineup moved, and ONE receipt acting for the team.
      const after = await readTeamLineup(service, target, WEEK)
      expect(after?.slot_map?.[slotKey], 'the override seated the player').toBe(mover.player_id)
      const receipts = (await readCommishActions(service, league.leagueId)).filter((r) => !receiptsBefore.some((b) => b.id === r.id))
      expect(receipts.map((r) => [r.action_type, r.acting_as_team_id])).toEqual([['edit_lineup', target]])

      // R1468 (Chris 2026-10-03, re-ruled): override moves save INSTANTLY —
      // two more moves (to the bench, then back) are two more receipts, and
      // the log and the feed show the whole fix as ONE line each.
      const oneMove = async (option: string) => {
        const res = cPage.waitForResponse(
          (r) => new URL(r.url()).pathname === `/api/leagues/${league.leagueId}/commish/lineup` && r.request().method() !== 'GET',
          { timeout: 60_000 },
        )
        await editor.locator(`[data-move-menu="${mover.player_id}"]`).click()
        await cPage.locator(`[data-move-option="${option}"]`).click()
        expect((await res).status()).toBe(200)
        await expect(editor.locator('[data-save-state="saved"]')).toBeVisible({ timeout: 60_000 })
      }
      await oneMove('bench')
      await oneMove(slotKey)
      const fix = (await readCommishActions(service, league.leagueId)).filter((r) => !receiptsBefore.some((b) => b.id === r.id))
      expect(fix.map((r) => [r.action_type, r.acting_as_team_id]), 'three instant moves → three receipts').toEqual([
        ['edit_lineup', target],
        ['edit_lineup', target],
        ['edit_lineup', target],
      ])
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(`[commish-console] R1468: commissioner_actions rows for a 3-move override fix = ${fix.length}`)
      // The grouped line is headed by (and its ✸ opens) the LATEST receipt.
      const receiptId = fix.at(-1)!.id // readCommishActions orders by created_at
      fixture().lineupReceiptId = receiptId
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(`[commish-console] override lineup: ${mover.full_name} → ${slotKey} for team ${target}; receipt ${receiptId}`)

      // ---- (3) A SECOND MEMBER — League Home's activity --------------------
      const mPage = await managerContext.newPage()
      await mPage.goto(`/app/leagues/${league.leagueId}`)
      const feed = mPage.locator('[data-activity-feed]')
      await expect(feed).toBeVisible({ timeout: 60_000 })
      const homeEntry = feed.locator(`[data-commish-log] [data-commish-log-item="${receiptId}"]`)
      await expect(homeEntry).toBeVisible({ timeout: 60_000 })
      // TD12's words for the receipt: who, which team, which week.
      const targetName = (await readLeagueTeams(service, league.leagueId)).find((t) => t.id === target)!.name
      const homeText = (await homeEntry.locator('[data-commish-log-text]').innerText()).replace(/\s+/g, ' ').trim()
      expect(homeText).toBe(`${DEV_USER.username} set ${targetName}’s Week ${WEEK} lineup (3 changes)`)
      await expect(homeEntry).toHaveAttribute('data-commish-log-group', '3')
      await expect(feed.locator('[data-commish-log] [data-commish-log-item]').filter({ hasText: `${targetName}’s Week ${WEEK} lineup` })).toHaveCount(1)
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(`[commish-console] League Home (dev-pro): "${homeText}"`)
      // The override's league post (§10.3 — it cannot be disabled) is a ✸ line
      // in the same card, linked to its receipt (F233(d)).
      const postLine = feed.locator('[data-feed-item]').filter({ has: mPage.locator('[data-commissioner]') }).filter({ hasText: `lineup for ${targetName}` })
      await expect(postLine).toHaveCount(1, { timeout: 60_000 })
      await expect(postLine.locator('[data-feed-text]')).toHaveText(`Week ${WEEK} lineup for ${targetName} edited by ${DEV_USER.username} (commissioner override, 3 changes)`)
      await expect(postLine).toHaveAttribute('data-feed-group', '3')
      await expect(postLine.locator('[data-commissioner-entry]')).toHaveAttribute('data-commissioner-entry', receiptId)

      // ---- (4) …and the Activity page's Commissioner tab ------------------
      await feed.locator('[data-see-all-activity]').click()
      await mPage.waitForURL(`**/app/leagues/${league.leagueId}/activity`, { timeout: 60_000 })
      await mPage.locator('[data-tab="commissioner"]').click()
      const tabEntry = mPage.locator(`[data-tab-panel="commissioner"] [data-commish-log-item="${receiptId}"]`)
      await expect(tabEntry).toBeVisible({ timeout: 60_000 })
      await expect(tabEntry.locator('[data-commish-log-text]')).toHaveText(homeText)

      // ---- (5) F545 — `?entry=` opens the log AT the entry ----------------
      // League Home's ✸ door, followed as a member would (`commishEntryHref`).
      await mPage.goto(`/app/leagues/${league.leagueId}`)
      await feed.locator(`[data-commissioner-entry="${receiptId}"]`).click()
      await mPage.waitForURL((url) => url.pathname.endsWith('/activity') && url.searchParams.get('entry') === receiptId, { timeout: 60_000 })
      const opened = mPage.locator('[data-tab-panel="commissioner"] [data-commish-log-item]').first()
      await expect(opened).toHaveAttribute('data-commish-log-item', receiptId, { timeout: 60_000 })
      await expect(opened).toHaveAttribute('data-highlighted', '')
      await expect(mPage.locator('[data-commish-entry-note]')).toBeVisible()
      test.info().annotations.push({ type: 'override-lineup', description: `receipt ${receiptId} (edit_lineup for ${target})` })
    } finally {
      await commishContext.close()
      await managerContext.close()
    }
  })

  test('the commissioner’s trade card (F552) and the Trades tab on real rows (F545): no button on an offer, Veto + Force once accepted, nothing once complete', async ({ browser }) => {
    test.setTimeout(300_000)
    const service = serviceClient()
    const { league, commish, manager, bots, botTeams } = fixture()
    const managerTeam = league.managerTeamId!
    const [bot1, bot2, bot3] = bots
    const bot1Team = botTeams[0]!
    const used = new Set<string>()

    // dev-pro keeps his WR (step 3 corrects him); anyone else may move.
    const take = async (teamId: string, keepWr: boolean): Promise<RosterEntry> => {
      const roster = await readTeamRoster(service, league.leagueId, teamId)
      const pick = roster.find((p) => !used.has(p.player_id) && p.nfl_team !== null && !(keepWr && normalize(p.position) === 'WR'))
      if (!pick) throw new Error(`team ${teamId} has no unused player — ${JSON.stringify(roster.map((p) => p.player_id))}`)
      used.add(pick.player_id)
      return pick
    }
    const offer = async (): Promise<{ id: string; give: RosterEntry; get: RosterEntry }> => {
      const give = await take(managerTeam, true)
      const get = await take(bot1Team, false)
      const res = await proposeTrade(manager.client, league.leagueId, {
        from_team_id: managerTeam,
        to_team_id: bot1Team,
        items: [
          { player_id: give.player_id, from_team_id: managerTeam },
          { player_id: get.player_id, from_team_id: bot1Team },
        ],
        action_id: randomUUID(),
      })
      await assertOk('dev-pro’s offer', res)
      const id = (res.body as { trade?: { id?: string } }).trade?.id
      if (!id) throw new Error(`the offer's answer carried no trade id: ${JSON.stringify(res.body)}`)
      return { id, give, get }
    }
    const bot = async (who: BotSeatUser, tradeId: string, body: Record<string, unknown>) =>
      assertOk(`bot ${who.username} ${JSON.stringify(body)}`, await actOnTrade(who.client, league.leagueId, tradeId, { ...body, action_id: randomUUID() }))

    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    const managerContext = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    try {
      const cPage = await commishContext.newPage()

      // ---- (1) AN OFFER BETWEEN TWO OTHER TEAMS: no button -----------------
      const forced = await offer()
      await openTradesInOverride(cPage, league.leagueId)
      const forcedCard = cPage.locator(`[data-trade="${forced.id}"]`)
      await expect(forcedCard).toHaveAttribute('data-trade-status', 'proposed', { timeout: 60_000 })
      await expect(forcedCard.locator('[data-trade-op]')).toHaveCount(0)
      await expect(forcedCard.locator('[data-trade-override]')).toHaveCount(0)

      // ---- (2) ACCEPTED (in review): Veto and "Force it through" -----------
      await bot(bot1!, forced.id, { op: 'accept' })
      expect((await readTrade(service, forced.id)).status).toBe('in_review')
      await openTradesInOverride(cPage, league.leagueId)
      await expect(forcedCard).toHaveAttribute('data-trade-status', 'in_review', { timeout: 60_000 })
      await expect(forcedCard.locator('[data-trade-op="veto"]').first()).toBeVisible()
      const force = forcedCard.locator('[data-trade-override] [data-trade-op="force"]')
      await expect(force).toHaveText('Force it through')
      await force.click()
      // §10.4: Force confirms with the before → after first.
      const confirm = cPage.getByRole('dialog').locator('[data-commish-confirm="force"]')
      await expect(confirm).toBeVisible({ timeout: 30_000 })
      // R1422: the before → after lines themselves — each player, from the
      // team that holds him now to the team he goes to (`commishConfirmLines`).
      const teamName = new Map((await readLeagueTeams(service, league.leagueId)).map((t) => [t.id, t.name]))
      // (The read's item order is not the offer's, so the lines compare as a set.)
      await expect(confirm.locator('li')).toHaveCount(2)
      expect((await confirm.locator('li').allTextContents()).sort()).toEqual(
        [
          `${forced.give.full_name}: ${teamName.get(managerTeam)} → ${teamName.get(bot1Team)}`,
          `${forced.get.full_name}: ${teamName.get(bot1Team)} → ${teamName.get(managerTeam)}`,
        ].sort(),
      )
      const forcedPost = cPage.waitForResponse(
        (res) => new URL(res.url()).pathname === `/api/leagues/${league.leagueId}/commish/trade` && res.request().method() === 'POST',
        { timeout: 60_000 },
      )
      await confirm.locator('[data-commish-confirm-go]').click()
      expect((await forcedPost).status(), 'Force answers 200').toBe(200)
      expect((await readTrade(service, forced.id)).status).toBe('complete')
      expect(await readHolder(service, league.leagueId, forced.give.player_id), 'it landed: dev-pro’s player is bot 1’s').toBe(bot1Team)
      expect(await readHolder(service, league.leagueId, forced.get.player_id)).toBe(managerTeam)

      // ---- (3) COMPLETED: nothing, even with override mode still on --------
      await cPage.locator('[data-tab="history"]').click()
      const historyCard = cPage.locator(`[data-trades="history"] [data-trade="${forced.id}"]`)
      await expect(historyCard).toBeVisible({ timeout: 60_000 })
      await expect(cPage.locator('[data-league-header] [data-override-indicator]')).toBeVisible()
      await expect(historyCard.locator('[data-trade-status-label]')).toHaveText('Completed')
      await expect(historyCard.locator('[data-trade-op]')).toHaveCount(0)
      await expect(historyCard.locator('[data-trade-override]')).toHaveCount(0)

      // ---- (4) A COMMISSIONER VETO (commissioner review, in the browser) ----
      const vetoed = await offer()
      await bot(bot1!, vetoed.id, { op: 'accept' })
      await openTradesInOverride(cPage, league.leagueId)
      const vetoCard = cPage.locator(`[data-trade="${vetoed.id}"]`)
      await expect(vetoCard).toHaveAttribute('data-trade-status', 'in_review', { timeout: 60_000 })
      const vetoPost = cPage.waitForResponse(
        (res) => new URL(res.url()).pathname === `/api/leagues/${league.leagueId}/commish/trade` && res.request().method() === 'POST',
        { timeout: 60_000 },
      )
      await vetoCard.locator('[data-trade-actions] [data-trade-op="veto"]').click()
      expect((await vetoPost).status(), 'Veto answers 200').toBe(200)
      expect((await readTrade(service, vetoed.id)).status).toBe('vetoed')

      // ---- (5) A LEAGUE-VOTE VETO (dev@ + two bots — capped at 3, F430) ----
      await assertOk(
        'trade_review=league_vote',
        await commishChangeSetting(commish.client, league.leagueId, { key: 'trade_review', value: 'league_vote', action_id: randomUUID() }),
      )
      const voted = await offer()
      await bot(bot1!, voted.id, { op: 'accept' })
      await assertOk('dev@’s veto vote', await actOnTrade(commish.client, league.leagueId, voted.id, { op: 'vote', vote: 'veto', action_id: randomUUID() }))
      await bot(bot2!, voted.id, { op: 'vote', vote: 'veto' })
      await bot(bot3!, voted.id, { op: 'vote', vote: 'veto' })
      expect((await readTrade(service, voted.id)).status).toBe('vetoed')

      const receipts = await readCommishActions(service, league.leagueId)
      const forceReceipt = receipts.filter((r) => r.action_type === 'force_trade' && r.target_id === forced.id)
      const vetoReceipt = receipts.filter((r) => r.action_type === 'veto_trade' && r.target_id === vetoed.id)
      expect(forceReceipt.length, 'one force receipt').toBe(1)
      expect(vetoReceipt.length, 'one veto receipt').toBe(1)
      expect(receipts.filter((r) => r.target_id === voted.id), 'the league vote writes no commissioner receipt').toEqual([])
      const forceId = forceReceipt[0]!.id
      const vetoId = vetoReceipt[0]!.id

      // ---- (6) F545 — THE TRADES TAB, as dev-pro, on these real rows -------
      const mPage = await managerContext.newPage()
      await mPage.goto(`/app/leagues/${league.leagueId}/activity?tab=trades`)
      const trades = mPage.locator('[data-tab-panel="trades"] [data-feed-item]')
      await expect(trades).toHaveCount(3, { timeout: 60_000 })
      const tradeLines = await mPage
        .locator('[data-tab-panel="trades"] [data-feed-item]')
        .evaluateAll((els) =>
          els.map((el) => ({
            text: (el.querySelector('[data-feed-text]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
            entry: el.querySelector('[data-commissioner-entry]')?.getAttribute('data-commissioner-entry') ?? null,
            commissioner: el.querySelector('[data-commissioner]') !== null,
          })),
        )
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(`[commish-console] Trades tab (dev-pro): ${JSON.stringify(tradeLines)}`)
      // Newest first: the league vote's veto (a system line — no ✸, nobody's
      // act), the commissioner's veto (read from its receipt — ✸, linked), the
      // forced trade (ONE ✸ line, linked to its receipt). Nothing else: an
      // offer, an accept, a vote and a settings change are not Trades lines.
      expect(tradeLines.map((l) => [l.commissioner, l.entry])).toEqual([
        [false, null],
        [true, vetoId],
        [true, forceId],
      ])
      expect(tradeLines[0]!.text).toMatch(/^Trade vetoed by league vote: /)
      expect(tradeLines[1]!.text).toMatch(new RegExp(`^${DEV_USER.username} \\(commissioner\\) vetoed a trade: `))
      expect(tradeLines[2]!.text).toMatch(/^completed a trade \(forced through by the commissioner\): /)
      expect(tradeLines[2]!.text).toContain(forced.give.full_name)
      // All: the executed trade ONCE — its line, not a "Trade completed:" post too (F463).
      await mPage.locator('[data-tab="all"]').click()
      const all = mPage.locator('[data-tab-panel="all"] [data-feed-item]')
      await expect(all.first()).toBeVisible({ timeout: 60_000 })
      await expect(mPage.locator(`[data-tab-panel="all"] [data-commissioner-entry="${forceId}"]`)).toHaveCount(1)
      const allTexts = await mPage.locator('[data-tab-panel="all"] [data-feed-text]').allInnerTexts()
      expect(allTexts.filter((t) => t.trim().startsWith(TRADE_COMPLETED_POST_PREFIX.trim())), 'no "Trade completed:" duplicate').toEqual([])
      // The ✸ door lands on the receipt (`?entry=`).
      await mPage.locator(`[data-tab-panel="all"] [data-commissioner-entry="${forceId}"]`).click()
      await mPage.waitForURL((url) => url.searchParams.get('entry') === forceId, { timeout: 60_000 })
      const opened = mPage.locator('[data-tab-panel="commissioner"] [data-commish-log-item]').first()
      await expect(opened).toHaveAttribute('data-commish-log-item', forceId, { timeout: 60_000 })
      await expect(opened).toHaveAttribute('data-highlighted', '')
      test.info().annotations.push({
        type: 'trade-card',
        description: `forced ${forced.id} (receipt ${forceId}) · commissioner veto ${vetoed.id} (receipt ${vetoId}) · league-vote veto ${voted.id}`,
      })
    } finally {
      await commishContext.close()
      await managerContext.close()
    }
  })

  test('an in-window stat correction appears in the Stat corrections tab with both scores', async ({ browser }) => {
    test.setTimeout(300_000)
    const service = serviceClient()
    const { league } = fixture()
    const managerTeam = league.managerTeamId!
    const week = await nflWeekInstants(service, WEEK)

    // ---- Week 1: every team seated, the game planted, the week opened ------
    const teamIds = (await readLeagueTeams(service, league.leagueId)).map((t) => t.id)
    expect(teamIds.length).toBe(TEAM_COUNT)
    const plans = new Map<string, Record<string, string>>()
    for (const teamId of teamIds) {
      const plan = seatingPlan(await readTeamRoster(service, league.leagueId, teamId))
      plans.set(teamId, plan)
      await upsertLineupRow(service, teamId, WEEK, plan)
    }
    const wr = plans.get(managerTeam)!['wr:0']
    if (!wr) throw new Error('dev-pro has no WR to start — step 2 was told to keep him')
    await plantGameRow(service, {
      suffix: 'e136-wk1',
      week: WEEK,
      homeTeam: 'ZZC',
      awayTeam: 'ZZD',
      kickoffAt: new Date(Date.parse(week.starts_at) + 4 * DAY_MS).toISOString(),
      status: 'scheduled',
    })
    const opened = await advanceWeekAt(service, league.leagueId, new Date(Date.parse(week.starts_at) + MINUTE_MS).toISOString())
    expect(Number(opened.first.opened)).toBeGreaterThan(0)

    // ---- Scored through the real worker ---------------------------------
    const lines: StatLine[] = teamIds.flatMap((teamId, index) =>
      Object.entries(plans.get(teamId)!).map(([slotKey, playerId]) =>
        statLineFor(playerId, SEASON_SLOTS.find((s) => s.key === slotKey)!.position, index),
      ),
    )
    await plantStatLines(service, WEEK, lines)
    const scored = await driveScoreBatch(service, league.leagueId)
    expect(scored.written).toBeGreaterThan(0)

    // ---- The games end; the week closes into its correction window -------
    await setInWeekGamesFinal(service, WEEK)
    const lastEnd = new Date(Date.parse(week.starts_at) + 5 * DAY_MS).toISOString()
    await recordWeekEnd(service, WEEK, lastEnd)
    const closed = await advanceWeekAt(service, league.leagueId, new Date(Date.parse(lastEnd) + MINUTE_MS).toISOString())
    expect(Number(closed.first.closed)).toBeGreaterThan(0)

    // ---- THE CORRECTION, in the window (the harness's enumerated job 9) ----
    const wrLine = lines.find((l) => l.player_id === wr)!
    const oldYards = wrLine.receiving_yards!
    const newYards = oldYards - 6
    const at = new Date(Date.parse(lastEnd) + DAY_MS).toISOString()
    expect(Date.parse(at), 'the fix lands inside the week’s correction window').toBeLessThan(Date.parse(week.correction_window_ends_at))
    const injected = await injectStatCorrection(service, { week: WEEK, playerId: wr, changes: { receiving_yards: newYards }, pNow: at })
    expect(injected.events.map((e) => [e.stat_key, e.old_value, e.new_value, e.week_state])).toEqual([['receiving_yards', oldYards, newYards, 'open']])
    const rescored = await driveScoreBatch(service, league.leagueId)
    const leagueReport = rescored.leagues.find((l) => l.league_id === league.leagueId)
    expect(leagueReport?.corrections, `the scoring door recorded it — ${JSON.stringify(leagueReport?.corrections_note)}`).toBe('recorded')

    const records = await readLeagueCorrections(service, league.leagueId)
    expect(records.map((r) => [r.team_id, r.player_id, r.week])).toEqual([[managerTeam, wr, WEEK]])
    const record = records[0]!
    expect(record.team_score_before).not.toBeNull()
    expect(record.team_score_after).not.toBeNull()
    expect(record.team_score_after!, 'six fewer yards, fewer points').toBeLessThan(record.team_score_before!)
    // eslint-disable-next-line no-console -- the DoD evidence line
    console.log(
      `[commish-console] correction @ ${at}: ${wr} receiving_yards ${oldYards} → ${newYards}; ` +
        `team score ${record.team_score_before} → ${record.team_score_after}; note ${JSON.stringify(leagueReport?.corrections_note)}`,
    )

    // ---- dev-pro sees it: Activity → Stat corrections ------------------------
    const managerContext: BrowserContext = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    try {
      const mPage = await managerContext.newPage()
      await mPage.goto(`/app/leagues/${league.leagueId}/activity?tab=corrections`)
      const card = mPage.locator(`[data-tab-panel="corrections"] [data-correction="${record.id}"]`)
      await expect(card).toBeVisible({ timeout: 60_000 })
      await expect(mPage.locator('[data-tab-panel="corrections"] [data-correction]')).toHaveCount(1)
      await expect(card.locator('[data-correction-stats]')).toContainText(`${oldYards} → ${newYards}`)
      await expect(card.locator('[data-correction-stats]')).toContainText(/receiving yards/i)
      await expect(card.locator('[data-correction-team-score]')).toHaveText(
        `Team score ${pointsWords(record.team_score_before)} → ${pointsWords(record.team_score_after)}`,
      )
      await expect(card.locator('[data-correction-player-points]')).toHaveText(
        `His points ${pointsWords(record.player_points_before)} → ${pointsWords(record.player_points_after)}`,
      )
      test.info().annotations.push({
        type: 'correction',
        description: `record ${record.id}: team score ${record.team_score_before} → ${record.team_score_after}`,
      })
    } finally {
      await managerContext.close()
    }
  })
})
