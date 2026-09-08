import { expect, test } from '@playwright/test'

import { LOCKED_ADD_TITLE } from '@/components/leagues/players-page-ops'

import {
  assertNoForeignSeasonFixtures,
  assertPlayerPoolPresent,
  cleanupSweep,
  driveDraftToCompletion,
  findUndraftedClubmate,
  lockTickAt,
  plantGameRow,
  readLeague,
  readPoolRow,
  readTeamRoster,
  serviceClient,
} from './helpers/harness'
import { provisionLeague, signInDev, signInDevPro } from './helpers/provision'
import { STORAGE_STATE } from './helpers/local-env'

/**
 * Spec — an E32 game-day lock refusal on the free-agent page (M4 task
 * L.D6.2, tasks-M4 §6 item 1; spec §13.1/E32, §12.19, §16.2
 * `free-agents-table`; migration 115 Q34(B)/Q35(a); PROGRESS D294, D315(5),
 * F227(f), F241(d)).
 *
 * WHY A PAST WALL-CLOCK KICKOFF AND NOT AN INJECTED `p_now`.
 * `roster_add_drop`'s public wrapper passes the TRANSACTION's own `now()`
 * (`113:912`) — it accepts no caller clock, which is exactly why the season
 * simulator records in-file that it cannot observe a lock refusal
 * (`season-runner.ts:44-52`). The ONLY mechanism that produces one is an
 * `nfl_games.kickoff_at` that is past against the wall clock, on the
 * league's current week — the dev seeder's own trick
 * (`dev-seed-inseason-league.ts:109`). This spec plants exactly one such
 * row, carrying the suite's fixture prefix so job 10 sweeps it.
 *
 * TWO SURFACES, TWO ARMS — and they are not interchangeable (§6.2's ruling).
 *   ARM A (the decider): a free agent with NO `league_player_pool` row shows
 *     no 🔒 at all — `lineup_lock_tick` refreshes EXISTING rows only
 *     (`119:775-780`) — so his Add button is LIVE and the refusal on screen
 *     is 113's own kickoff evaluation at transaction time, rendered
 *     VERBATIM in `[data-move-refusal]`. E32's spec row is explicit that
 *     `locked_until` is the job's VIEW and never the decider, so THIS is the
 *     assertion the task means.
 *   ARM B (the view): a player who DOES hold a pool row the tick has locked
 *     renders `[data-locked]` and a disabled Add carrying `LOCKED_ADD_TITLE`.
 *     Asserted BESIDE arm A, never in place of it.
 *
 * THE CRON RACE, AND WHY THERE ISN'T ONE HERE. `lineup-lock` runs every
 * minute at real `now()` on the local stack (`116:1339`). It cannot flip arm
 * A's surface mid-spec, because it never INSERTS a pool row — arm A's target
 * is chosen precisely for having none (`findUndraftedClubmate` asserts that
 * before returning him). It can only reach arm B's target, where it would do
 * the same thing this spec's own `lockTickAt` does. The mitigation is
 * structural, not a timing bet.
 *
 * FALSIFIABILITY (D272(20)/D146): the refusal fixture has a sibling proving
 * the guarded path still SUCCEEDS one unit away — the drop that runs first,
 * through the same panel, before any kickoff exists, and lands
 * `[data-move-result]`.
 */

/** Wall-clock past, on the synthetic season's week 1 — the same literal the
 *  dev seeder uses (`dev-seed-inseason-league.ts:109`). */
const KICKOFF_PAST = '2001-09-09T17:00:00.000Z'

test.describe('e32 game-day lock refused on the free-agent page (real browser)', () => {
  test.beforeAll(async () => {
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
    await assertNoForeignSeasonFixtures(service)
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('drop succeeds while the week is quiet → kickoff passes → the server refuses the add, verbatim', async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const service = serviceClient()

    const commishAuth = await signInDev()
    const managerAuth = await signInDevPro()
    const league = await provisionLeague({
      nameSuffix: 'inseason lock',
      teamCount: 8,
      rounds: 2,
      clockSeconds: 30,
      commish: commishAuth,
      manager: managerAuth,
      order: 'commish-first',
      createDraftRow: true,
      start: true,
    })
    const drive = await driveDraftToCompletion(service, league.draftId!, { maxSteps: 60 })
    expect(await readLeague(service, league.leagueId)).toMatchObject({ status: 'in_season' })
    // eslint-disable-next-line no-console -- the DoD evidence line
    console.log(`[inseason-lock] board complete in ${drive.steps} engine steps → ${drive.status}`)

    // The board drafted the REAL local pool by ADP, so which clubs it
    // consumed is not knowable in advance (R286) — read the roster back and
    // build the fixture around what is actually there.
    const roster = await readTeamRoster(service, league.leagueId, league.commishTeamId)
    const dropTarget = roster.find((p) => p.nfl_team !== null)
    if (!dropTarget) {
      throw new Error(`no rostered player with an NFL club on team ${league.commishTeamId}`)
    }
    const club = dropTarget.nfl_team!
    const addTarget = await findUndraftedClubmate(service, league.leagueId, club)
    // eslint-disable-next-line no-console -- the DoD evidence line
    console.log(
      `[inseason-lock] club ${club} · drop ${dropTarget.full_name} (${dropTarget.player_id}) · ` +
        `add ${addTarget.full_name} (${addTarget.player_id})`,
    )

    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    try {
      const page = await commishContext.newPage()
      await page.goto(`/app/leagues/${league.leagueId}/players`)
      await expect(page.locator('[data-move-panel]')).toBeVisible({ timeout: 60_000 })

      // ---- The SIBLING that proves the guarded path runs (D146) -----------
      // No game row exists yet, so the club is not locked and the drop is
      // admitted. This also mints the pool row arm B needs.
      await page.locator('[data-move-drop]').click()
      await page
        .getByRole('option', { name: `${dropTarget.position} · ${dropTarget.full_name}` })
        .click()
      const dropResponse = page.waitForResponse(
        (res) => res.url().includes('/transactions') && res.request().method() === 'POST',
        { timeout: 60_000 },
      )
      await page.locator('[data-move-submit]').click()
      expect((await dropResponse).status(), 'the add/drop route answers 200 (transactions-service.ts:164)').toBe(200)
      await expect(page.locator('[data-move-result]')).toBeVisible({ timeout: 60_000 })
      const droppedPool = await readPoolRow(service, league.leagueId, dropTarget.player_id)
      expect(droppedPool, 'the drop must mint a pool row — arm B reads it').not.toBeNull()
      await page.getByRole('button', { name: 'Done' }).click()

      // ---- The kickoff passes (wall-clock past, week 1) -------------------
      const gameId = await plantGameRow(service, {
        suffix: 'lock-wk1',
        week: 1,
        homeTeam: club,
        awayTeam: 'ZZX',
        kickoffAt: KICKOFF_PAST,
        status: 'final',
      })
      // The tick refreshes the VIEW on rows that exist — arm B's row gets its
      // `locked_until`; arm A's target still has no row to refresh, which is
      // the whole point. `p_now` is injected (D291/Q43) and deliberately set
      // to the wall clock, because 113 will evaluate the add at transaction
      // time and the two readings must agree.
      const tick = await lockTickAt(service, league.leagueId, new Date().toISOString())
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(
        `[inseason-lock] planted ${gameId}; lineup_lock_tick pool_rows=${tick.pool_rows} ` +
          `pool_updates=${tick.pool_updates} lineups=${tick.lineups}`,
      )
      const lockedRow = await readPoolRow(service, league.leagueId, dropTarget.player_id)
      expect(lockedRow?.locked_until, 'the tick must have written the lock VIEW').not.toBeNull()
      expect(await readPoolRow(service, league.leagueId, addTarget.player_id)).toBeNull()

      // ---- ARM A: the SERVER's refusal --------------------------------
      await page.reload()
      await expect(page.locator('[data-move-panel]')).toBeVisible({ timeout: 60_000 })
      await page.getByLabel('Search players').fill(addTarget.full_name)
      const addRow = page.locator(`[data-pool-row="${addTarget.player_id}"]`)
      await expect(addRow).toBeVisible({ timeout: 60_000 })
      // He is a free agent with NO pool row: no 🔒, and the button is live —
      // the client decided nothing (players-page.tsx:71-78).
      await expect(addRow).toHaveAttribute('data-availability', 'free_agent')
      await expect(addRow).not.toHaveAttribute('data-locked', /.*/)
      const addButton = addRow.locator('[data-action="add"]')
      await expect(addButton).toBeEnabled()
      await addButton.click()

      const refusalResponse = page.waitForResponse(
        (res) => res.url().includes('/transactions') && res.request().method() === 'POST',
        { timeout: 60_000 },
      )
      await page.locator('[data-move-submit]').click()
      expect((await refusalResponse).status(), 'E32 maps to 409 (inseason-errors.ts:50-73)').toBe(409)

      const refusal = page.locator('[data-move-refusal]')
      await expect(refusal).toBeVisible({ timeout: 60_000 })
      const refusalText = await refusal.innerText()
      // The STABLE SPINE of 115's sentence (`115:604-610`), rendered verbatim
      // minus the `roster_add_drop: ` prefix `userFacingMessage` strips
      // (`client-fetch.ts:40-45`; E32's tail is `: no in-game pickups`, so no
      // trailing §-citation is stripped). The "clears at" slot is NOT
      // asserted — with `last_game_ends_at` NULL it renders the
      // not-yet-recorded arm, which is fixture state, not the rule.
      expect(refusalText).toContain('That move was refused.')
      expect(refusalText).toContain(`${addTarget.full_name} (${addTarget.player_id}) is locked for adds`)
      expect(refusalText).toContain('no in-game pickups')
      expect(refusalText).not.toContain('roster_add_drop:')
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(`[inseason-lock] server refusal: ${refusalText.replace(/\s+/g, ' ').trim()}`)

      // Nothing was written: the refusal is a refusal (§15.6 never optimistic).
      expect(await readPoolRow(service, league.leagueId, addTarget.player_id)).toBeNull()

      // ---- ARM B: the VIEW's disabled button ------------------------------
      await page.getByRole('button', { name: 'Dismiss' }).click()
      await page.getByLabel('Search players').fill(dropTarget.full_name)
      const lockedPoolRow = page.locator(`[data-pool-row="${dropTarget.player_id}"]`)
      await expect(lockedPoolRow).toBeVisible({ timeout: 60_000 })
      await expect(lockedPoolRow).toHaveAttribute('data-locked', 'true')
      const lockedAdd = lockedPoolRow.locator('[data-action="add"]')
      await expect(lockedAdd).toBeDisabled()
      await expect(lockedAdd).toHaveAttribute('title', LOCKED_ADD_TITLE)

      test.info().annotations.push({
        type: 'e32-arms',
        description: `server refusal on ${addTarget.player_id} (no pool row) + disabled view on ${dropTarget.player_id} (tick-locked row)`,
      })
    } finally {
      await commishContext.close()
    }
  })
})
