import { expect, test, type Page } from '@playwright/test'

import {
  assertPlayerPoolPresent,
  cleanupSweep,
  countLeagueRosters,
  readAuctionMarket,
  readBidLedger,
  serviceClient,
  snapshotLeagueWrites,
} from './helpers/harness'
import { openDockPlayers } from './helpers/dock'
import { provisionLeague, signInDev } from './helpers/provision'
import { DEV_USER, STORAGE_STATE } from './helpers/local-env'

/**
 * L.C5.1 spec (c) — the MOCK AUCTION E2E (tasks-M3 §6 item 3; spec §8.8;
 * E62; E60; the §8.8 zero-side-effect contract): launch a practice auction
 * from `?practice=1` on an auction league → CPU nominations + raises land
 * at humanized timing (the reactive AP.3 ladder — a provoked response
 * commits WITH the provoking bid, 091) → the human wins one player against
 * a CPU bid-up (E62 visible: CPU raises exist on the lot and every one
 * passed the max-bid validator to be written at all) → the draft finishes →
 * the MOCK DRAFT REPORT carries prices (MP.8/D230 superseded the task
 * text's "recap" for mocks — the report IS the mock's recap) → ZERO league
 * writes, by the DB diff
 * (`snapshotLeagueWrites` — the pgTAP 025 §F twin), with every `draft_bids`
 * row in the mock-allowed set (the mock's own draft_id).
 *
 * F132's mechanism is designed in, not tolerated blind: after a human bid
 * answers 200, the response market can ALREADY show a CPU on top (the
 * in-transaction provoked answer). The war loop therefore asserts on the
 * CONVERGED market (service reads), re-raising until the CPUs' value
 * ceiling is passed — the named terminal states are "human on top" and
 * "CPU answered inside the commit", nothing else.
 */

const TEAM_COUNT = 8
const ROUNDS = 2
const TOTAL_LOTS = TEAM_COUNT * ROUNDS
/** War-loop rails: jump +$10 per re-raise, hard stop far below the $199
 *  max bid (a run past this is a value-model surprise — loud, not looped). */
const WAR_RAISE = 10
const WAR_CAP = 150
const WAR_MAX_ROUNDS = 14

async function nominateNthAvailable(page: Page, index: number): Promise<void> {
  await page.getByRole('button', { name: 'Nominate', exact: true }).nth(index).click()
  await page.getByRole('button', { name: /^Nominate at \$1$/ }).click()
}

/** The war-lot nominee, derived from the same facts 091's candidate scan
 *  reads: GLOBAL ADP rank (order adp, id — the scan's own tie-break) in
 *  9..14, position WR (the roster's one starting slot), still undrafted in
 *  THIS mock. Loud when none remains — that would mean the top of the pool
 *  emptied before the human's first turn, which an 8-team board cannot do. */
async function pickWarNominee(
  service: ReturnType<typeof serviceClient>,
  mockDraftId: string,
): Promise<{ id: string; full_name: string }> {
  const { data: pool, error: poolError } = await service
    .from('players')
    .select('id, full_name, position, adp')
    .not('adp', 'is', null)
    .order('adp', { ascending: true })
    .order('id', { ascending: true })
    .limit(20)
  if (poolError) throw new Error(`war nominee pool read failed: ${poolError.message}`)
  const { data: drafted, error: draftedError } = await service
    .from('draft_picks')
    .select('player_id')
    .eq('draft_id', mockDraftId)
  if (draftedError) throw new Error(`war nominee drafted read failed: ${draftedError.message}`)
  const gone = new Set((drafted ?? []).map((p) => p.player_id))
  const nominee = (pool ?? []).find(
    (p, i) => i + 1 >= 9 && i + 1 <= 14 && p.position === 'WR' && !gone.has(p.id),
  )
  if (!nominee) {
    throw new Error('war lot: no undrafted WR in global ADP ranks 9..14 — fixture surprise, refusing to guess')
  }
  return { id: nominee.id, full_name: nominee.full_name }
}

test.describe('mock auction (launch → CPU ladder → human win vs bid-up → recap → zero league writes)', () => {
  test.beforeAll(async () => {
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('a practice auction completes against CPUs and leaves the league byte-identical', async ({
    browser,
  }) => {
    test.setTimeout(540_000)
    const service = serviceClient()

    // An AUCTION league in `setup` — the mock snapshots this config at
    // launch (D95/§8.8): short bid clock keeps the lots at cron pace, the
    // anti-snipe floor keeps the human's war from being cut short mid-raise.
    const commishAuth = await signInDev()
    const league = await provisionLeague({
      nameSuffix: 'mock auction',
      teamCount: TEAM_COUNT,
      rounds: ROUNDS,
      clockSeconds: 30,
      commish: commishAuth,
      stayInSetup: true,
      orderMode: 'random',
      draftType: 'auction',
      auction: { budget: 200, nominationSeconds: 30, bidSeconds: 10, antiSnipeSeconds: 10 },
    })
    const humanTeamId = league.commishTeamId

    // ---- BEFORE: everything league-scoped, before any mock exists --------
    const before = await snapshotLeagueWrites(service, league.leagueId, [DEV_USER.id])

    const context = await browser.newContext({ storageState: STORAGE_STATE.dev })
    try {
      const page = await context.newPage()

      // ---- Launch (§16.2 mock-draft-launcher at ?practice=1) -------------
      await page.goto(`/app/leagues/${league.leagueId}/draft?practice=1`)
      await expect(page.getByText('Run mock draft').first()).toBeVisible()
      await page.getByRole('button', { name: 'Fast', exact: true }).click()
      await page.getByRole('button', { name: 'Start practice draft' }).click()
      await page.waitForURL(/\?draft=[0-9a-f-]{36}/, { timeout: 60_000 })
      const mockDraftId = new URL(page.url()).searchParams.get('draft')!

      const bar = page.locator('header[aria-label="Draft command bar"]')
      await expect(bar.getByText('Mock', { exact: true })).toBeVisible()
      await expect(bar.getByText(/^Practice (live|paused)$/)).toBeVisible()

      // The pool stays summoned for the whole loop (turn detection reads the
      // row-level Nominate affordance, which only exists on my turn).
      await openDockPlayers(page)

      // ---- Drive to completion --------------------------------------------
      const completeText = page.getByText('Practice draft complete')
      const progress: Array<{ at: number; lots: number }> = []
      let warLotSeq: number | null = null
      let warTopAmount = 0
      const stopBy = Date.now() + 480_000
      while (Date.now() < stopBy) {
        if (await completeText.isVisible()) break

        // Authoritative lot counter — the humanized-timing sample.
        const { count } = await service
          .from('draft_picks')
          .select('id', { count: 'exact', head: true })
          .eq('draft_id', mockDraftId)
          .eq('is_undone', false)
        const lots = count ?? 0
        if (progress.length === 0 || progress[progress.length - 1]!.lots !== lots) {
          progress.push({ at: Date.now(), lots })
        }

        // My nomination turn?
        const myTurn = await page
          .getByRole('button', { name: 'Nominate', exact: true })
          .first()
          .isVisible()
          .catch(() => false)
        if (myTurn) {
          if (warLotSeq === null) {
            // THE WAR LOT — chosen from the ENGINE'S OWN value model, not a
            // row index (a row index is run-specific: the human's slot is
            // random, and 091's value horizon is GLOBAL ADP rank ≤
            // slots × teams = 16 — a late slot pushed the 10th row past it
            // and produced a 0-CPU-bid lot, measured). The nominee is a
            // remaining WR (the 1-starter roster's only 1.0-need position;
            // a WR also stays ≥ 0.5 for a CPU whose WR seat is filled)
            // whose GLOBAL ADP rank sits in 9..14: value ≈ $2–$40 across
            // the ±15% noise band — ALWAYS worth a CPU raise over $1,
            // always under the war rails.
            const nominee = await pickWarNominee(service, mockDraftId)
            await page
              .locator('input[aria-label="Search available players"]')
              .fill(nominee.full_name)
            // The search is debounced + server-narrowed — wait for the
            // nominee's OWN row, then click ITS Nominate (never an index
            // into a list that may not have narrowed yet).
            const nomineeRow = page
              .getByRole('row')
              .filter({ has: page.getByRole('button', { name: `Add ${nominee.full_name} to Targets` }) })
            await expect(nomineeRow.getByRole('button', { name: 'Nominate', exact: true })).toBeVisible({
              timeout: 10_000,
            })
            await nomineeRow.getByRole('button', { name: 'Nominate', exact: true }).click()
            await page.getByRole('button', { name: /^Nominate at \$1$/ }).click()
            // Wait for the nomination to SETTLE server-side (never
            // optimistic — §15.6); the settled market already carries the
            // provoked ladder (091 — the response commits with the
            // provoking action).
            let market = await readAuctionMarket(service, mockDraftId)
            {
              const openBy = Date.now() + 15_000
              while (market.nomination === null) {
                if (Date.now() > openBy) throw new Error('war lot: the nomination never opened')
                await page.waitForTimeout(300)
                market = await readAuctionMarket(service, mockDraftId)
              }
            }
            warLotSeq = market.currentPickNumber
            // Re-raise until the CPUs stop: jump +$10 over the standing
            // high through the room's own composer.
            for (let round = 0; round < WAR_MAX_ROUNDS; round++) {
              market = await readAuctionMarket(service, mockDraftId)
              if (market.nomination === null) break // awarded mid-war (lost the lot)
              if (market.currentPickNumber !== warLotSeq) break
              if (market.nomination.high_bidder_team_id === humanTeamId) {
                warTopAmount = market.nomination.high_bid
                break
              }
              const next = market.nomination.high_bid + WAR_RAISE
              if (next > WAR_CAP) {
                throw new Error(
                  `war lot: CPUs still bidding past $${WAR_CAP} — value-model surprise, refusing to chase`,
                )
              }
              await page.locator('input[aria-label="Your bid"]').fill(String(next))
              // The click races the provoked ladder — a refusal ("outbid at
              // $N") is a NAMED outcome; the loop re-reads and re-raises.
              await page
                .getByRole('button', { name: /^Bid \$\d+$/ })
                .click({ timeout: 3_000 })
                .catch(() => undefined)
              await page.waitForTimeout(400)
            }
            if (warTopAmount === 0) {
              throw new Error('war lot: the human never reached the top — E62 lot unprovable')
            }
          } else {
            // Any later turn: open a lot at $1 and let the CPUs have it
            // (or, in the endgame, take the uncontestable instant award).
            await nominateNthAvailable(page, 0)
          }
          // Nominating closed the dock — summon it back for turn detection.
          // The ENDGAME exception: the last lot can instant-award
          // (§8.6.9 — no rival has an open slot) and flip the room to the
          // completion card, which has no dock to summon.
          if (!(await completeText.isVisible())) {
            await openDockPlayers(page).catch(() => undefined)
          }
        }
        await page.waitForTimeout(500)
      }
      await expect(completeText).toBeVisible({ timeout: 15_000 })

      // ---- The war lot: human won it against a REAL CPU bid-up (E62) -----
      expect(warLotSeq, 'the human got a nomination turn').not.toBeNull()
      const warBids = await readBidLedger(service, mockDraftId, warLotSeq!)
      const cpuWarBids = warBids.filter((b) => b.team_id !== humanTeamId)
      expect(cpuWarBids.length, 'the CPUs bid the lot up (E62 visible)').toBeGreaterThanOrEqual(1)
      const { data: warPick, error: warPickError } = await service
        .from('draft_picks')
        .select('team_id, price')
        .eq('draft_id', mockDraftId)
        .eq('pick_number', warLotSeq!)
        .eq('is_undone', false)
        .single()
      if (warPickError) throw new Error(`war-pick read failed: ${warPickError.message}`)
      expect(warPick!.team_id, 'the human WON the war lot').toBe(humanTeamId)
      expect(warPick!.price).toBe(warTopAmount)
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(
        `[mock-auction] war lot ${warLotSeq}: human won at $${warTopAmount} over ` +
          `${cpuWarBids.length} CPU raise(s) (${warBids.length} bids on the lot)`,
      )

      // ---- Humanized timing (§8.8) — progressive, never a burst ----------
      const distinct = new Set(progress.map((p) => p.lots)).size
      expect(distinct, 'the board filled through several observed states').toBeGreaterThanOrEqual(5)
      const spanMs = progress[progress.length - 1]!.at - progress[0]!.at
      expect(spanMs, 'lots resolved over real time, not as one burst').toBeGreaterThan(15_000)
      const allBids = await readBidLedger(service, mockDraftId)
      const bidInstants = allBids.map((b) => Date.parse(b.created_at))
      expect(Math.max(...bidInstants) - Math.min(...bidInstants)).toBeGreaterThan(15_000)
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(
        `[mock-auction] ${TOTAL_LOTS} lots / ${allBids.length} bids over ` +
          `${((Math.max(...bidInstants) - Math.min(...bidInstants)) / 1000).toFixed(1)}s ` +
          `(${distinct} observed board states)`,
      )

      // ---- The report (MP.8/D230: a finished mock goes to its REPORT — the
      // mock's recap — launcher-keyed delete + PRICES) ----------------------
      await page.getByRole('link', { name: 'View the report' }).click()
      await page.waitForURL('**/mocks/**/report**')
      await expect(page.getByText('Mock draft report').first()).toBeVisible()
      await expect(page.getByText(`$${warTopAmount}`).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Delete report' }).first()).toBeVisible()

      // ---- ZERO league writes: the DB diff (the 025 §F twin) -------------
      const after = await snapshotLeagueWrites(
        service,
        league.leagueId,
        [DEV_USER.id],
        mockDraftId,
      )
      expect(after, 'everything league-scoped is byte-identical').toEqual(before)
      expect(await countLeagueRosters(service, league.leagueId)).toBe(0)
      expect(after.realDraftCount).toBe(0)
      // Every bid row in this league belongs to the mock — the mock-allowed
      // set, asserted from the bids side too (the task text's own clause).
      const { data: leagueBidDrafts, error: bidsError } = await service
        .from('draft_bids')
        .select('draft_id')
        .eq('league_id', league.leagueId)
      if (bidsError) throw new Error(`league bid sweep failed: ${bidsError.message}`)
      expect(new Set((leagueBidDrafts ?? []).map((b) => b.draft_id))).toEqual(
        new Set([mockDraftId]),
      )
    } finally {
      await context.close()
    }
  })
})
