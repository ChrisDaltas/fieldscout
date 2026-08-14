import { expect, test, type Page } from '@playwright/test'

import {
  assertPlayerPoolPresent,
  cleanupSweep,
  countLeagueRosters,
  readLeagueStatus,
  readPickSheet,
  rewindDeadline,
  serviceClient,
  tickOnce,
} from './helpers/harness'
import { provisionLeague, signInDev, signInDevPro } from './helpers/provision'
import { LOCAL_URL, STORAGE_STATE } from './helpers/local-env'

/**
 * Spec (a) — full short-clock snake draft to COMPLETION, two browser
 * contexts (M2 task L.B5.1; spec §18 Phase B gate; exit criterion 1).
 *
 * The board: 8 teams × 2 rounds = 16 picks. The two humans (commissioner
 * dev@ at seat 1, manager dev-pro@ at seat 2) make picks 1, 2 and — snake
 * round 2 reversed — 15, 16 through the real room UI; the six placeholder
 * seats resolve through the REAL engine path (deadline rewind + direct
 * `draft_tick()` — the harness's sanctioned virtual-time move, D100), each
 * autopick arriving in both browsers as a broadcast.
 *
 * Asserted along the way: picks broadcast cross-client (each human's pick
 * appears in the OTHER browser with no reload), the board converges
 * (recap "Final board" innerText identical across clients + the
 * authoritative pick sheet complete), cross-client clock skew < 1s sampled
 * mid-draft (E14's drift substance at the client boundary), completion
 * routes to the REAL recap (no delete affordance — D121(1)), and the
 * league lands `in_season` with `league_rosters` populated (D88).
 */

const TOTAL_PICKS = 16

/** The first pool row's player name (via the queue button's aria-label —
 *  the one place the row prints its full name machine-readably). */
async function firstAvailableName(page: Page): Promise<string> {
  const label = await page
    .getByRole('button', { name: /^Queue / })
    .first()
    .getAttribute('aria-label')
  if (!label) throw new Error('no queue button found in the pool')
  return label.replace(/^Queue /, '')
}

/** Click the first enabled Draft button (rendered only on your turn). */
async function draftFirstAvailable(page: Page): Promise<string> {
  const name = await firstAvailableName(page)
  await page.getByRole('button', { name: 'Draft', exact: true }).first().click()
  return name
}

async function expectPickCount(page: Page, n: number, timeout = 20_000): Promise<void> {
  await expect(page.getByText(`${n} of ${TOTAL_PICKS} picks made`)).toBeVisible({ timeout })
}

/**
 * Estimate this page's rendered-clock deadline (epoch ms) by sampling the
 * countdown text at 40ms and keying on display flips: at a flip to k the
 * true remaining is exactly k seconds (formatClockMs ceils), so
 * `flipTime + k*1000` estimates the deadline with only the re-render lag
 * (< ~540ms) as positive bias; the min over several flips tightens it.
 * Both pages run this CONCURRENTLY on the same machine clock, so the
 * difference of the two estimates is the cross-client skew.
 */
async function sampleClockDeadline(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const readClock = (): string | null => {
      for (const s of Array.from(document.querySelectorAll('span.fs-num'))) {
        const t = s.textContent?.trim() ?? ''
        if (/^\d+:\d{2}$/.test(t)) return t
      }
      return null
    }
    const flips: number[] = []
    let last: string | null = null
    const start = Date.now()
    while (Date.now() - start < 4_500) {
      const t = readClock()
      if (t !== null) {
        if (last !== null && t !== last) {
          const [m, s] = t.split(':').map(Number)
          flips.push(Date.now() + ((m ?? 0) * 60 + (s ?? 0)) * 1000)
        }
        last = t
      }
      await new Promise((r) => setTimeout(r, 40))
    }
    if (flips.length === 0) {
      throw new Error('the pick clock never ticked during the sample window')
    }
    return Math.min(...flips)
  })
}

/** The recap "Final board" card's rendered text (anchor styling is
 *  fill-only, so this is viewer-independent — the convergence surface). */
async function readFinalBoardText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const title = Array.from(document.querySelectorAll('div')).find(
      (el) => el.childElementCount === 0 && el.textContent?.trim() === 'Final board',
    )
    const card = title?.parentElement?.parentElement
    if (!card) throw new Error('no Final board card on this page')
    return (card as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
  })
}

test.describe('full snake draft to completion (two live clients)', () => {
  test.beforeAll(async () => {
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('lobby start → live picks broadcast both ways → skew < 1s → completion → real recap → in_season', async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const service = serviceClient()

    // ---- Provision through the real service path (D100) -----------------
    const commishAuth = await signInDev()
    const managerAuth = await signInDevPro()
    const league = await provisionLeague({
      nameSuffix: 'live draft',
      teamCount: 8,
      rounds: 2,
      clockSeconds: 30,
      commish: commishAuth,
      manager: managerAuth,
      order: 'commish-first',
      createDraftRow: true,
    })
    const draftId = league.draftId!
    const roomPath = `/app/leagues/${league.leagueId}/draft`

    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    const managerContext = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    try {
      const commish = await commishContext.newPage()
      const manager = await managerContext.newPage()

      // Env-override network evidence at the SPEC level too (beside
      // auth.setup's): the room's own authoritative fetch must hit the
      // local stack.
      const managerDraftsFetch = manager.waitForRequest(
        (req) => req.url().includes('/rest/v1/drafts'),
        { timeout: 60_000 },
      )

      // ---- Lobby → Start (L.B3.4's surface) ------------------------------
      await commish.goto(roomPath)
      await manager.goto(roomPath)
      await expect(commish.getByText('Draft lobby').first()).toBeVisible()

      const draftsReq = await managerDraftsFetch
      expect(
        draftsReq.url().startsWith(`${LOCAL_URL}/rest/v1/drafts`),
        `room data must come from the local stack — saw ${draftsReq.url()}`,
      ).toBe(true)

      await commish.getByRole('button', { name: 'Start draft now' }).click()

      // Both rooms flip live IN PLACE — the manager's flip is the drafts
      // UPDATE broadcast, no reload happens in this spec.
      await expect(commish.getByText("You're on the clock").first()).toBeVisible({
        timeout: 30_000,
      })
      await expect(manager.getByText('Live').first()).toBeVisible({ timeout: 30_000 })

      // ---- Pick 1: commissioner, via the pool UI -------------------------
      const pick1Name = await draftFirstAvailable(commish)
      await expectPickCount(commish, 1)
      await expectPickCount(manager, 1)
      // Cross-client: the manager's board shows the commissioner's pick
      // (board cells render "F. Lastname" — assert on the last name).
      const pick1LastName = pick1Name.split(' ').slice(-1)[0]!
      await expect(manager.getByText(new RegExp(pick1LastName)).first()).toBeVisible()

      // ---- Pick 2 is the manager's: sample cross-client clock skew -------
      await expect(manager.getByText("You're on the clock").first()).toBeVisible({
        timeout: 30_000,
      })
      const [commishDeadline, managerDeadline] = await Promise.all([
        sampleClockDeadline(commish),
        sampleClockDeadline(manager),
      ])
      const skewMs = Math.abs(commishDeadline - managerDeadline)
      test.info().annotations.push({
        type: 'clock-skew',
        description: `cross-client skew ${skewMs}ms (commish ${commishDeadline}, manager ${managerDeadline})`,
      })
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(`[draft-live] cross-client clock skew: ${skewMs}ms`)
      expect(skewMs, 'cross-client clock skew (E14 substance)').toBeLessThan(1_000)

      const pick2Name = await draftFirstAvailable(manager)
      await expectPickCount(manager, 2)
      await expectPickCount(commish, 2)
      const pick2LastName = pick2Name.split(' ').slice(-1)[0]!
      await expect(commish.getByText(new RegExp(pick2LastName)).first()).toBeVisible()

      // ---- Picks 3–14: the six placeholder seats, twice (snake) ----------
      // Each resolves through the REAL engine (rewind the server-written
      // deadline, run a tick pass — §8.5.4 autopick-at-deadline for no-user
      // seats); each lands in the browsers as a draft_picks broadcast.
      for (let pickNumber = 3; pickNumber <= 14; pickNumber++) {
        await rewindDeadline(service, draftId)
        await tickOnce(service)
        await expectPickCount(manager, pickNumber)
      }
      await expectPickCount(commish, 14)

      // ---- Picks 15 & 16: the humans close it out (round 2 is reversed) --
      await expect(manager.getByText("You're on the clock").first()).toBeVisible({
        timeout: 30_000,
      })
      await draftFirstAvailable(manager)
      await expect(commish.getByText("You're on the clock").first()).toBeVisible({
        timeout: 30_000,
      })
      await draftFirstAvailable(commish)

      // ---- Completion: the room's own state machine flips in place -------
      await expect(commish.getByText('This draft is complete')).toBeVisible({
        timeout: 30_000,
      })
      await expect(manager.getByText('This draft is complete')).toBeVisible({
        timeout: 30_000,
      })

      // ---- The REAL recap (D121: viewer anchor, no delete affordance) ----
      await commish.getByRole('link', { name: 'View the recap' }).click()
      await commish.waitForURL('**/draft/recap**')
      await expect(commish.getByText('Final board')).toBeVisible()
      await expect(commish.getByText('Rosters', { exact: true })).toBeVisible()
      await expect(commish.getByRole('button', { name: 'Delete recap' })).toHaveCount(0)

      // ---- Board convergence: both clients' recap boards are identical ---
      await manager.getByRole('link', { name: 'View the recap' }).click()
      await manager.waitForURL('**/draft/recap**')
      await expect(manager.getByText('Final board')).toBeVisible()
      const [commishBoard, managerBoard] = await Promise.all([
        readFinalBoardText(commish),
        readFinalBoardText(manager),
      ])
      expect(commishBoard).toBe(managerBoard)
      expect(commishBoard).toContain(`${TOTAL_PICKS} picks`)

      // ---- Authoritative completion state (harness reads — job 4) --------
      const picks = await readPickSheet(service, draftId)
      expect(picks.length).toBe(TOTAL_PICKS)
      expect(new Set(picks.map((p) => p.player_id)).size).toBe(TOTAL_PICKS)
      expect(new Set(picks.map((p) => p.pick_number)).size).toBe(TOTAL_PICKS)
      expect(await readLeagueStatus(service, league.leagueId)).toBe('in_season')
      expect(await countLeagueRosters(service, league.leagueId)).toBe(TOTAL_PICKS)

      // The home hero agrees (F46's placeholder is the honest M2 state).
      await commish.goto(`/app/leagues/${league.leagueId}`)
      await expect(commish.getByText('In season').first()).toBeVisible()
    } finally {
      await commishContext.close()
      await managerContext.close()
    }
  })
})
