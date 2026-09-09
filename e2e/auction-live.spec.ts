import { expect, test, type Page, type TestInfo } from '@playwright/test'

import {
  assertPlayerPoolPresent,
  cleanupSweep,
  collectAuctionAudit,
  countLeagueRosters,
  readAuctionMarket,
  readBidLedger,
  readLeague,
  readPlayerFullName,
  rewindDeadline,
  serviceClient,
  tickOnce,
  type Supabase,
} from './helpers/harness'
import {
  attachSocketLedger,
  captureDraftFailureEvidence,
  createSocketLedger,
  type SocketLedger,
} from './helpers/evidence'
import { openDockPlayers } from './helpers/dock'
import { provisionLeague, signInDev, signInDevPro } from './helpers/provision'
import { STORAGE_STATE } from './helpers/local-env'
import { sweepAuctionAudit } from '@/lib/leagues/sim/invariants'

/**
 * L.C5.1 spec (a) — full short-clock AUCTION to completion, two browser
 * contexts (tasks-M3 §6; spec §19.3 "full auction"; M3 exit criterion 3's
 * completion half; §8.6; E26).
 *
 * The board: 8 teams × 2 slots = 16 nominations. Nomination rotation =
 * draft order (default `same_as_draft_order`): commissioner (dev@) seat 1,
 * manager (dev-pro@) seat 2, six placeholder seats behind them. The humans
 * nominate and raise through the REAL room UI; every placeholder lot
 * resolves through the REAL engine (deadline rewind + direct `draft_tick()`
 * — the harness's sanctioned virtual-time move, D100): nomination expiry ⇒
 * system nomination (D129(2)), bid expiry with no raise ⇒ award to the
 * nominator at the opening bid (D130/E26).
 *
 * Asserted along the way: nominations and raises broadcast cross-client
 * (each human action appears in the OTHER browser with no reload), the
 * budgets rail converges (the "Team budgets and rosters" region renders
 * identically in both clients), reconnect-during-bidding (folded per the
 * task text: the manager's context goes dark across a raise, and restore
 * brings the nomination + high bid back < 2s via refetch-then-resubscribe),
 * completion flips both rooms in place, the recap carries PRICES, the
 * league lands `in_season` — and the FINAL BOARD'S ARITHMETIC RECONCILES
 * via the L.C4.1 invariant helpers run VERBATIM (`sweepAuctionAudit` over
 * the same audit shape the sim collects; reused, never re-derived).
 */

const TEAM_COUNT = 8
const ROUNDS = 2
const TOTAL_LOTS = TEAM_COUNT * ROUNDS

/**
 * How long the nomination READ-BACK waits for the server to hold the
 * nomination it was just asked for. Generous relative to a local RPC and far
 * short of the 60s nomination clock this spec provisions, so a lapse here is
 * a failed submit and never an impatient reader.
 */
const NOMINATION_READBACK_MS = 15_000

/**
 * F308's separator. The commissioner's nomination and the manager's render of
 * it are TWO facts, and before this they failed as ONE red: `:213` timing out
 * meant either *the server never got a nomination* (a submit-path bug, whose
 * correct manager render is exactly "Waiting on the nominating team") or *the
 * server has it and this client never saw it* (a delivery/reconciliation bug).
 * The gate's 2,644 s run could not tell them apart, and the sweep had removed
 * the draft before anyone could ask.
 *
 * So the helper now ASKS, server-side, before the spec waits on any browser:
 * the nomination must exist AND be for the player whose row was clicked. A
 * submit that never landed now fails HERE, by name, one step from its cause —
 * and a `:213` red past this point is, by construction, the OTHER bug.
 */
async function confirmNominationLanded(
  server: { service: Supabase; draftId: string; actor: string },
  playerName: string,
): Promise<number> {
  const startedAt = Date.now()
  const deadline = startedAt + NOMINATION_READBACK_MS
  for (;;) {
    const market = await readAuctionMarket(server.service, server.draftId)
    if (market.nomination !== null) {
      const nominated = await readPlayerFullName(server.service, market.nomination.player_id)
      if (nominated !== playerName) {
        throw new Error(
          `[nomination read-back] ${server.actor} nominated ${playerName}, but the server holds a ` +
            `nomination for ${nominated ?? market.nomination.player_id} (lot ` +
            `${market.currentPickNumber}). The click did not produce THIS nomination — a client ` +
            'rendering the other player would be CORRECT, so do not read a later broadcast ' +
            'timeout as a delivery fault.',
        )
      }
      return Date.now() - startedAt
    }
    if (Date.now() > deadline) {
      throw new Error(
        `[nomination read-back] ${server.actor} clicked "Nominate at $1" for ${playerName}, and ` +
          `drafts.current_nomination is STILL NULL ${NOMINATION_READBACK_MS}ms later ` +
          `(status=${market.status}, current_pick_number=${market.currentPickNumber}, ` +
          `on_clock_team_id=${market.onClockTeamId}, current_deadline=${market.currentDeadline}). ` +
          'THE NOMINATION WAS NEVER ISSUED: this is a submit-path failure, not a missed ' +
          'broadcast — no client can render a nomination the server does not hold. (F308)',
      )
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}

/** Open the dock's Players panel and nominate the first available row at
 *  the $1 floor through the block's composer. Returns the player's name
 *  (read from the row's Add-to-Targets aria-label before clicking). The
 *  nomination is READ BACK from the server before this returns — see
 *  `confirmNominationLanded`. */
async function nominateFirstAvailable(
  page: Page,
  server: { service: Supabase; draftId: string; actor: string },
): Promise<string> {
  await openDockPlayers(page)
  const label = await page
    .getByRole('button', { name: /^Add .+ to Targets$/ })
    .first()
    .getAttribute('aria-label')
  if (!label) throw new Error('no pool row found to nominate')
  const name = label.replace(/^Add /, '').replace(/ to Targets$/, '')
  await page.getByRole('button', { name: 'Nominate', exact: true }).first().click()
  // The row action selects the nominee and closes the dock; the composer
  // submits the opening bid (default = the §8.6.2 floor, $1 here).
  await page.getByRole('button', { name: /^Nominate at \$1$/ }).click()
  const settledMs = await confirmNominationLanded(server, name)
  // eslint-disable-next-line no-console -- the F308 evidence line: every run
  // now states, in the gate's own log, that the nomination reached the server
  // and how fast — so a later broadcast timeout is unambiguous.
  console.log(
    `[auction-live] ${server.actor} nomination for ${name} live server-side in ${settledMs}ms`,
  )
  return name
}

/** Poll the authoritative live-pick count (service read — job 4). */
async function waitForLotCount(
  service: ReturnType<typeof serviceClient>,
  draftId: string,
  n: number,
  opts: { drive: boolean; timeoutMs?: number },
): Promise<void> {
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000)
  for (;;) {
    const { count, error } = await service
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId)
      .eq('is_undone', false)
    if (error) throw new Error(`lot-count read failed: ${error.message}`)
    if ((count ?? 0) >= n) return
    if (Date.now() > deadline) throw new Error(`draft never reached ${n} lots (at ${count})`)
    if (opts.drive) {
      // Placeholder lots: rewind whatever clock is running and tick — a
      // nominating phase system-nominates, a bidding phase awards (E26).
      await rewindDeadline(service, draftId)
      await tickOnce(service)
      // PACED, deliberately (~1.2s per engine step): the browsers follow
      // this draft over realtime, and an unpaced rewind+tick loop is a
      // broadcast burst the rooms may never heal from if the FINAL events
      // are the ones that drop (gap⇒refetch needs a successor event to
      // notice the gap — the F56 family). The storm spec owns burst
      // behaviour; this spec's job is the full draft.
      await new Promise((r) => setTimeout(r, 900))
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}

/** Poll until the given lot's BIDDING phase is live (the nomination has
 *  settled server-side) — a rewind fired before that would hit the
 *  nominator's own nomination clock instead of the bid clock. */
async function waitForBiddingPhase(
  service: ReturnType<typeof serviceClient>,
  draftId: string,
  seq: number,
): Promise<void> {
  const deadline = Date.now() + 20_000
  for (;;) {
    const market = await readAuctionMarket(service, draftId)
    if (market.currentPickNumber === seq && market.nomination !== null) return
    if (Date.now() > deadline) {
      throw new Error(`lot ${seq} never reached the bidding phase (at ${market.currentPickNumber})`)
    }
    await new Promise((r) => setTimeout(r, 250))
  }
}

/** The budgets rail's rendered text (the cross-client convergence surface).
 *  The one DELIBERATELY viewer-relative mark — the "You" chip on the
 *  viewer's own column (§16.4's at-a-glance marks) — is stripped before
 *  comparison; everything else (budgets, max bids, spots, buys) must be
 *  byte-identical across clients. */
async function readBudgetsRail(page: Page): Promise<string> {
  return (await page.getByRole('region', { name: 'Team budgets and rosters' }).innerText())
    .replace(/\s+/g, ' ')
    .replace(/\bYou\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

test.describe('full auction draft to completion (two live clients)', () => {
  /**
   * F308/R952 — THE CAPTURE STATE LIVES AT DESCRIBE SCOPE, and the reason is
   * measured rather than stylistic.
   *
   * Anchoring the capture to the test body's own `catch` covers the ASSERTION
   * path and nothing else. A Playwright TEST-LEVEL timeout abandons the body
   * (`workerProcessEntry.js:405` races the body against the timeout and never
   * returns to it), so neither `catch` nor `finally` runs: a timeout probe on
   * THIS spec produced zero `[evidence:` lines and no evidence directory,
   * with a live room and a confirmed server-side nomination sitting there
   * uncaptured — precisely everything this instrument adds, lost on the
   * failure shape where the room hung longest. And it is reachable without
   * any bug: the per-assertion budgets below already sum past the 420 s test
   * budget, so a slow-but-not-stuck contended run times out rather than
   * failing an assertion.
   *
   * `afterEach` runs on a timeout, on a fresh slot of
   * `max(project.timeout, test.timeout)`, and STRICTLY BEFORE `afterAll`
   * (`:1661` vs `:1674`) — so it is still ahead of `cleanupSweep`, which is
   * the whole point. Nothing auto-closes a hand-built context before then.
   */
  let evidenceTarget:
    | {
        service: Supabase
        draftId: string
        pages: Array<{ label: string; page: Page }>
        ledgers: SocketLedger[]
      }
    | null = null
  /** Per-test once-flag. The assertion path captures from the body — ahead of
   *  the `finally` that closes both contexts, so the screenshots have LIVE
   *  pages; the timeout path captures from `afterEach`. Never both, and reset
   *  per test because `--repeat-each` reuses this module. */
  let evidenceCaptured = false

  async function captureOnce(testInfo: TestInfo, error: unknown): Promise<void> {
    if (evidenceCaptured || evidenceTarget === null) return
    evidenceCaptured = true
    await captureDraftFailureEvidence({
      testInfo,
      label: 'auction-live',
      service: evidenceTarget.service,
      draftId: evidenceTarget.draftId,
      error,
      pages: evidenceTarget.pages,
      ledgers: evidenceTarget.ledgers,
    })
  }

  test.beforeAll(async () => {
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
  })

  test.beforeEach(() => {
    evidenceTarget = null
    evidenceCaptured = false
  })

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return
    // `testInfo.error` is a plain `{message, stack, value}` payload, not an
    // Error — compose the message rather than stringifying an object.
    const reason = testInfo.error?.message ?? testInfo.error?.value
    await captureOnce(
      testInfo,
      new Error(`[${testInfo.status ?? 'unknown'}] ${reason ?? '(no error attached)'}`),
    )
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('lobby start → nominations/raises broadcast → reconnect mid-bidding → completion → recap with prices → in_season', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(420_000)
    const service = serviceClient()

    const commishAuth = await signInDev()
    const managerAuth = await signInDevPro()
    const league = await provisionLeague({
      nameSuffix: 'auction live',
      teamCount: TEAM_COUNT,
      rounds: ROUNDS,
      clockSeconds: 30,
      commish: commishAuth,
      manager: managerAuth,
      order: 'commish-first',
      draftType: 'auction',
      // Long clocks de-race the human interactions — every deadline this
      // spec waits on is rewound, so the length costs no wall-clock.
      auction: { budget: 200, nominationSeconds: 60, bidSeconds: 60, antiSnipeSeconds: 10 },
      createDraftRow: true,
    })
    const draftId = league.draftId!
    const roomPath = `/app/leagues/${league.leagueId}/draft`

    const commishServer = { service, draftId, actor: 'commissioner' }
    const managerServer = { service, draftId, actor: 'manager' }

    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    const managerContext = await browser.newContext({ storageState: STORAGE_STATE.devPro })
    // NOTE (F308/D334, measured — the record said otherwise and was wrong):
    // these hand-built contexts ARE traced. Playwright's `_setupArtifacts`
    // auto-fixture hooks `didCreateBrowserContext` for every context created
    // during a test, so `trace: 'retain-on-failure'` reaches them; an explicit
    // `tracing.start()` here fails with "Tracing has been already started".
    // What killed F308's evidence was DESTRUCTION — `test-results/` is emptied
    // by the next playwright run and no gate script preserves it. The capture
    // below therefore writes somewhere playwright does not own, and to stdout.
    const commish = await commishContext.newPage()
    const manager = await managerContext.newPage()

    // F308: what each browser ACTUALLY received on the realtime socket.
    // Passive (`page.on('websocket')` observes through CDP; it forwards
    // nothing and delays nothing) and attached BEFORE either page navigates,
    // so the room's own first join is on the record. This is the instrument
    // that separates a DEAF CHANNEL (no frames at all after the join) from a
    // LOST BROADCAST (beats arrive, the `drafts` frame does not) from a
    // CLIENT-SIDE defect (the frame arrived and the page still rendered the
    // old state).
    // The commissioner's socket is unproxied, so one passive CDP observer is
    // the whole story there. The MANAGER needs TWO ledgers, and the reason is
    // measured rather than assumed: its socket sits behind the
    // `routeWebSocket` passthrough below, and `page.on('websocket')` there
    // observes the SERVER → HARNESS leg — a probe that dropped every frame
    // inside the passthrough still saw all 15 of them on the CDP ledger. So
    // `manager-upstream` says what the server sent and `manager-delivered`
    // says what the browser actually got, and the pair is the only thing that
    // can indict or exonerate the harness's own Node hop — which F56's cell
    // keeps on the record as a live competing explanation for this family.
    const commishLedger = attachSocketLedger(commish, 'commissioner')
    const managerUpstream = attachSocketLedger(manager, 'manager-upstream')
    const managerDelivered = createSocketLedger('manager-delivered')
    // From here on there is something worth capturing, so BOTH entry points
    // (the body's `catch` and the `afterEach`) can see it. Before this point
    // there are no pages and no ledgers — nothing to capture, and the
    // `browser` fixture's own teardown reclaims what exists.
    evidenceTarget = {
      service,
      draftId,
      pages: [
        { label: 'commissioner', page: commish },
        { label: 'manager', page: manager },
      ],
      ledgers: [commishLedger, managerUpstream, managerDelivered],
    }

    try {
      // Realtime-socket proxy on the manager (registered BEFORE the room
      // opens its channel) — the draft-reconnect.spec pattern: passthrough
      // that can sever the live socket and refuse newborns while "offline".
      let socketsDark = false
      const liveSockets: Array<{ close: () => Promise<void> }> = []
      await manager.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
        if (socketsDark) {
          void ws.close()
          return
        }
        const server = ws.connectToServer()
        managerDelivered.noteSocket('open', ws.url())
        // Recorded one statement before each hop, never around it: `record`
        // swallows its own errors by construction, so the instrument cannot
        // change what the passthrough delivers.
        ws.onMessage((message) => {
          managerDelivered.record('out', message)
          server.send(message)
        })
        server.onMessage((message) => {
          managerDelivered.record('in', message)
          ws.send(message)
        })
        ws.onClose(() => {
          managerDelivered.noteSocket('close', 'browser side')
          void server.close()
        })
        server.onClose(() => {
          managerDelivered.noteSocket('close', 'server side')
          void ws.close()
        })
        liveSockets.push(ws)
      })

      await commish.goto(roomPath)
      await manager.goto(roomPath)
      await expect(commish.getByText('Draft night').first()).toBeVisible()
      await commish.getByRole('button', { name: 'Start draft now' }).click()

      // Both rooms flip live in place; the commissioner is the first
      // nominator (draft order = nomination order, commish-first).
      await expect(commish.getByText("You're on the clock").first()).toBeVisible({
        timeout: 30_000,
      })
      await expect(
        manager.locator('header[aria-label="Draft command bar"]').getByText(/^Draft live$/),
      ).toBeVisible({ timeout: 30_000 })

      // ---- Lot 1: commissioner nominates via the UI; manager raises ------
      const lot1Name = await nominateFirstAvailable(commish, commishServer)
      const lot1LastName = lot1Name.split(' ').slice(-1)[0]!
      // The nomination broadcast: the manager's block shows the player and
      // the bid composer with no reload.
      await expect(manager.getByText(new RegExp(lot1LastName)).first()).toBeVisible({
        timeout: 20_000,
      })
      await expect(manager.getByRole('button', { name: /^Bid \$2$/ })).toBeVisible({
        timeout: 20_000,
      })
      await manager.getByRole('button', { name: /^Bid \$2$/ }).click()
      // The raise broadcast: the commissioner's block shows $2 as the high
      // bid (the composer's min raise moves to $3).
      await expect(commish.getByRole('button', { name: /^Bid \$3$/ })).toBeVisible({
        timeout: 20_000,
      })
      // No-raise expiry through the real engine: award to the high bidder.
      await rewindDeadline(service, draftId)
      await tickOnce(service)
      await waitForLotCount(service, draftId, 1, { drive: false })

      // ---- Lot 2: manager nominates; RECONNECT ACROSS THE RAISE ----------
      await expect(manager.getByText("You're on the clock").first()).toBeVisible({
        timeout: 30_000,
      })
      const lot2Name = await nominateFirstAvailable(manager, managerServer)
      const lot2LastName = lot2Name.split(' ').slice(-1)[0]!
      await expect(commish.getByText(new RegExp(lot2LastName)).first()).toBeVisible({
        timeout: 20_000,
      })

      // The manager goes dark (REST plane + established realtime socket).
      const banner = manager.getByText(/Reconnecting — syncing the room/)
      socketsDark = true
      await managerContext.setOffline(true)
      for (const ws of liveSockets.splice(0)) {
        await ws.close()
      }
      await expect(banner).toBeVisible({ timeout: 30_000 })

      // The missed broadcast: the commissioner raises to $2 while the
      // manager is dark.
      await expect(commish.getByRole('button', { name: /^Bid \$2$/ })).toBeVisible({
        timeout: 20_000,
      })
      await commish.getByRole('button', { name: /^Bid \$2$/ }).click()
      // The bid SETTLED (never optimistic — §15.6): the commissioner's own
      // room shows the hold state off the response/broadcast, and only then
      // is the authoritative market read.
      await expect(commish.getByText('You hold the high bid — wait to be outbid.')).toBeVisible({
        timeout: 15_000,
      })
      const market = await readAuctionMarket(service, draftId)
      expect(market.nomination?.high_bid).toBe(2)
      expect(market.nomination?.high_bidder_team_id).toBe(league.commishTeamId)

      // Restore: nomination + high bid back < 2s (refetch-then-resubscribe).
      const restoreAt = Date.now()
      socketsDark = false
      await managerContext.setOffline(false)
      await expect(manager.getByRole('button', { name: /^Bid \$3$/ })).toBeVisible({
        timeout: 10_000,
      })
      const restoredMs = Date.now() - restoreAt
      expect(restoredMs, 'nomination + high bid restored after reconnect (< 2s)').toBeLessThan(
        2_000,
      )
      await expect(banner).toBeHidden({ timeout: 15_000 })
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(`[auction-live] reconnect restored the auction market in ${restoredMs}ms`)

      await rewindDeadline(service, draftId)
      await tickOnce(service)
      await waitForLotCount(service, draftId, 2, { drive: false })

      // ---- Lots 3–8: the placeholder seats, all-engine (D129(2)/E26) -----
      await waitForLotCount(service, draftId, 8, { drive: true, timeoutMs: 120_000 })

      // The budgets rail converges cross-client after round 1.
      await expect
        .poll(
          async () => {
            const [a, b] = await Promise.all([readBudgetsRail(commish), readBudgetsRail(manager)])
            return a === b && a.length > 0 ? 'converged' : `commish: ${a}\nmanager: ${b}`
          },
          { timeout: 20_000 },
        )
        .toBe('converged')

      // ---- Lot 9: commissioner nominates, NOBODY raises (E26) ------------
      await expect(commish.getByText("You're on the clock").first()).toBeVisible({
        timeout: 60_000,
      })
      await nominateFirstAvailable(commish, commishServer)
      await waitForBiddingPhase(service, draftId, 9)
      await rewindDeadline(service, draftId)
      await tickOnce(service)
      await waitForLotCount(service, draftId, 9, { drive: false })
      // E26: the no-raise lot went to the nominator at the opening bid.
      const lot9 = await readBidLedger(service, draftId, 9)
      expect(lot9.length).toBe(1)
      expect(lot9[0]!.team_id).toBe(league.commishTeamId)
      expect(lot9[0]!.amount).toBe(1)

      // ---- Lot 10: the manager's, same shape ------------------------------
      await expect(manager.getByText("You're on the clock").first()).toBeVisible({
        timeout: 60_000,
      })
      await nominateFirstAvailable(manager, managerServer)
      await waitForBiddingPhase(service, draftId, 10)
      await rewindDeadline(service, draftId)
      await tickOnce(service)
      await waitForLotCount(service, draftId, 10, { drive: false })

      // ---- Lots 11–16: the placeholders close out round 2 ----------------
      await waitForLotCount(service, draftId, TOTAL_LOTS, { drive: true, timeoutMs: 120_000 })
      // The completion transition itself can ride the NEXT tick pass after
      // the 16th award — keep driving until the drafts row says complete
      // (the rewind is `.eq('status','live')`-guarded, so it goes inert the
      // moment the engine finishes).
      {
        const completeBy = Date.now() + 60_000
        for (;;) {
          const { data } = await service.from('drafts').select('status').eq('id', draftId).single()
          if (data?.status === 'complete') break
          if (Date.now() > completeBy) throw new Error(`draft never completed (status ${data?.status})`)
          await rewindDeadline(service, draftId)
          await tickOnce(service)
          await new Promise((r) => setTimeout(r, 300))
        }
      }

      // ---- Completion: both rooms flip in place --------------------------
      await expect(commish.getByText('This draft is complete')).toBeVisible({ timeout: 30_000 })
      await expect(manager.getByText('This draft is complete')).toBeVisible({ timeout: 30_000 })

      // ---- The recap carries PRICES --------------------------------------
      await commish.getByRole('link', { name: 'View the recap' }).click()
      await commish.waitForURL('**/draft/recap**')
      await expect(commish.getByText('Final board')).toBeVisible()
      await expect(commish.getByText('$2').first()).toBeVisible() // lot 1's price, rendered

      // ---- The final board's arithmetic reconciles (L.C4.1 helpers, ------
      // reused verbatim — never re-derived) --------------------------------
      const audit = await collectAuctionAudit(service, {
        label: 'auction-live e2e',
        leagueId: league.leagueId,
        draftId,
        teamCount: TEAM_COUNT,
        totalRounds: ROUNDS,
      })
      const failures = sweepAuctionAudit(audit)
      expect(failures, JSON.stringify(failures, null, 2)).toEqual([])

      // Spot facts the sweep composes over: the two contested lots.
      const live = audit.picks.filter((p) => !p.is_undone)
      expect(live.length).toBe(TOTAL_LOTS)
      const lot1Pick = live.find((p) => p.pick_number === 1)!
      expect(lot1Pick.team_id).toBe(league.managerTeamId) // manager won lot 1…
      expect(lot1Pick.price).toBe(2) // …at the $2 raise
      const lot2Pick = live.find((p) => p.pick_number === 2)!
      expect(lot2Pick.team_id).toBe(league.commishTeamId)
      expect(lot2Pick.price).toBe(2)

      expect((await readLeague(service, league.leagueId)).status).toBe('in_season')
      expect(await countLeagueRosters(service, league.leagueId)).toBe(TOTAL_LOTS)

      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(
        `[auction-live] ${TOTAL_LOTS} lots complete; sweepAuctionAudit clean (` +
          `${audit.bids.length} bids, budgets parity-checked for ${audit.sqlBudgets.length} teams)`,
      )
    } catch (error) {
      // The ASSERTION path, captured here rather than in `afterEach` for one
      // reason: the `finally` below closes both contexts, so this is the last
      // moment the screenshots and the rendered bodies come from LIVE pages.
      // Still before any teardown — `test.afterAll`'s `cleanupSweep` deletes
      // the draft, which is exactly why F308 could not be diagnosed
      // (`0 rows`). The once-flag stops `afterEach` capturing it again.
      await captureOnce(testInfo, error)
      throw error
    } finally {
      await commishContext.close()
      await managerContext.close()
    }
  })
})
