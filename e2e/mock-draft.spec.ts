import { expect, test } from '@playwright/test'

import {
  assertPlayerPoolPresent,
  cleanupSweep,
  countLeagueRosters,
  readPickSheet,
  serviceClient,
  snapshotLeagueWrites,
} from './helpers/harness'
import { provisionLeague, signInDev } from './helpers/provision'
import { DEV_USER, STORAGE_STATE } from './helpers/local-env'

/**
 * Spec (c) — the solo mock E2E (M2 task L.B5.1; spec §8.8; M2 exit
 * criterion 4): launch → CPU picks land at humanized timing → finish →
 * recap renders → ZERO league writes, asserted by a DB diff — the pgTAP
 * 025 §F zero-side-effect diff's E2E twin (same table list, same
 * leagues-row byte-identity), never by absence of errors.
 *
 * The CPU opponents ARE the engine (D93 — the mock's picks are
 * `draft_tick` running the real autopick at deterministic think-time), so
 * this spec runs at the live 5s cron's own pace: 'fast' CPU speed ≈ 2s
 * think-time resolved on the next tick pass. "Humanized timing" is
 * asserted two ways — the board fills PROGRESSIVELY in the browser
 * (several distinct counter values over real seconds, never one burst),
 * and the authoritative pick sheet's created_at instants span well past
 * what any batch insert would produce.
 */

const TOTAL_PICKS = 16

test.describe('solo mock draft (launch → CPUs → recap → zero league writes)', () => {
  test.beforeAll(async () => {
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('a practice draft completes against CPUs and leaves the league byte-identical', async ({
    browser,
  }) => {
    test.setTimeout(420_000)
    const service = serviceClient()

    // League in `setup`, full capacity via placeholders (D103(1)) — the
    // launcher's own league, no real draft row, no schedule.
    const commishAuth = await signInDev()
    const league = await provisionLeague({
      nameSuffix: 'mock',
      teamCount: 8,
      rounds: 2,
      clockSeconds: 30,
      commish: commishAuth,
      stayInSetup: true,
      orderMode: 'random', // the mock snapshots config at launch (D95/§8.8)
    })

    // ---- BEFORE: everything league-scoped, before any mock exists -------
    // (The §4.3 break probe was run here once and reverted: a service-role
    // leagues-row name write between the snapshots turned the deep-equal
    // RED naming the exact field — the diff detects real writes, it is not
    // a tautology. Evidence in the L.B5.1 PR body.)
    const before = await snapshotLeagueWrites(service, league.leagueId, [DEV_USER.id])

    const context = await browser.newContext({ storageState: STORAGE_STATE.dev })
    try {
      const page = await context.newPage()

      // ---- Launch (§16.2 mock-draft-launcher at ?practice=1) -------------
      await page.goto(`/app/leagues/${league.leagueId}/draft?practice=1`)
      await expect(page.getByText('Practice this draft').first()).toBeVisible()
      // Fast CPUs (~2s think-time) keep the spec at cron pace, not clock
      // pace. The CPU-speed control is a Segment (aria-pressed buttons).
      await page.getByRole('button', { name: 'Fast', exact: true }).click()
      await page.getByRole('button', { name: 'Start practice draft' }).click()
      await page.waitForURL(/\?draft=[0-9a-f-]{36}/, { timeout: 60_000 })
      const mockDraftId = new URL(page.url()).searchParams.get('draft')!

      // The room is unmistakably a practice room (§16.5.2's MOCK banner).
      await expect(
        page.getByText('Practice draft — nothing here touches your league.'),
      ).toBeVisible()

      // ---- Draft to completion: human picks on the clock, CPUs tick in --
      const completeText = page.getByText('Practice draft complete')
      const progress: Array<{ at: number; picks: number }> = []
      const stopBy = Date.now() + 330_000
      while (Date.now() < stopBy) {
        if (await completeText.isVisible()) break
        if (await page.getByText("You're on the clock").first().isVisible()) {
          const draftButton = page.getByRole('button', { name: 'Draft', exact: true }).first()
          if (await draftButton.isVisible()) {
            await draftButton.click().catch(() => undefined) // a tick may beat us — the loop re-checks
          }
        }
        const counter = await page
          .getByText(new RegExp(`\\d+ of ${TOTAL_PICKS} picks made`))
          .textContent()
          .catch(() => null)
        const picks = Number(counter?.match(/^(\d+)/)?.[1])
        if (
          Number.isFinite(picks) &&
          (progress.length === 0 || progress[progress.length - 1]!.picks !== picks)
        ) {
          progress.push({ at: Date.now(), picks })
        }
        await page.waitForTimeout(400)
      }
      await expect(completeText).toBeVisible({ timeout: 10_000 })

      // ---- Humanized timing (§8.8) — progressive, never a burst ----------
      const distinctCounts = new Set(progress.map((p) => p.picks)).size
      expect(distinctCounts, 'board filled through several observed states').toBeGreaterThanOrEqual(5)
      const observedSpanMs = progress[progress.length - 1]!.at - progress[0]!.at
      expect(observedSpanMs, 'CPU picks arrived over real time, not as one burst').toBeGreaterThan(
        15_000,
      )
      const sheet = await readPickSheet(service, mockDraftId)
      expect(sheet.length).toBe(TOTAL_PICKS)
      const instants = sheet
        .map((p) => (p.created_at ? Date.parse(p.created_at) : NaN))
        .filter((t) => Number.isFinite(t))
      expect(instants.length).toBe(TOTAL_PICKS)
      const sheetSpanMs = Math.max(...instants) - Math.min(...instants)
      expect(sheetSpanMs, 'authoritative pick instants span real seconds').toBeGreaterThan(15_000)
      // Every CPU pick is engine-made; only the human's two are manual.
      expect(sheet.filter((p) => p.is_auto).length).toBe(TOTAL_PICKS - 2)
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(
        `[mock-draft] ${TOTAL_PICKS} picks over ${(sheetSpanMs / 1000).toFixed(1)}s ` +
          `(${distinctCounts} observed board states across ${(observedSpanMs / 1000).toFixed(1)}s)`,
      )

      // ---- The recap (mock variant: launcher anchor + delete) ------------
      await page.getByRole('link', { name: 'View the recap' }).click()
      await page.waitForURL('**/draft/recap**')
      await expect(page.getByText('Final board')).toBeVisible()
      await expect(page.getByText('Your roster vs the CPUs')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Delete recap' })).toBeVisible()

      // ---- ZERO league writes: the DB diff (the 025 §F twin) -------------
      const after = await snapshotLeagueWrites(
        service,
        league.leagueId,
        [DEV_USER.id],
        mockDraftId,
      )
      expect(after, 'everything league-scoped is byte-identical').toEqual(before)
      // Named explicitly beside the deep-equal (the 025 cells this twins):
      expect(await countLeagueRosters(service, league.leagueId)).toBe(0)
      expect(after.realDraftCount).toBe(0)
    } finally {
      await context.close()
    }
  })
})
