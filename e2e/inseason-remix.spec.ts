import { expect, test } from '@playwright/test'

import { systemPostPreview } from '@/components/leagues/schedule-view-ops'
import type { RemixPreview } from '@/hooks/use-schedule'

import {
  assertNoForeignSeasonFixtures,
  assertPlayerPoolPresent,
  cleanupSweep,
  driveDraftToCompletion,
  readLeague,
  readSystemPosts,
  readWeekMatchups,
  serviceClient,
} from './helpers/harness'
import { provisionLeague, signInDev, signInDevPro } from './helpers/provision'
import { DEV_USER, STORAGE_STATE } from './helpers/local-env'

/**
 * Spec — the Remix preview/confirm flow in a real browser, including the
 * D97 system post (M4 task L.D6.2, tasks-M4 §6 item 1; delivery plan §4.1's
 * E2E row: "a scored week, Remix preview/confirm"; spec §11.7, §16.2
 * `schedule-remix-modal`, D289/D290/D307).
 *
 * WHICH E41 POSTURE THIS WALKS — and what that deliberately leaves untested.
 * `schedule_window_internal` reads `min(nfl_games.kickoff_at)` for the
 * league's FIRST week (`111:262-266`), and E32 needs a wall-clock-PAST
 * kickoff on that same week — so ONE league cannot carry both a lock
 * refusal and a FREE Remix window. This spec takes its own league and walks
 * the **FREE** window: no game row is planted, so `plan.window.free` is true,
 * `[data-remix-reason]` is not rendered, `confirmGate` admits an empty
 * reason, and 111 terminates the system post with `'.'` rather than the
 * override clause (`111:746-747`). **The OVERRIDE posture (reason REQUIRED,
 * week 1 frozen) is therefore NOT exercised by this task** — a deliberate
 * scope statement, recorded here and in the PR body, not an oversight. The
 * override branch has its db-level coverage in the L.D1.3 suites; what is
 * missing is a BROWSER walk of it, filed as its own row.
 *
 * The league arrives `in_season` through 110's real completion wiring
 * (`driveDraftToCompletion` → `draft_complete_internal` → `league_generate_schedule`
 * in one transaction), never a service-role status write (D100).
 *
 * Selection is `data-*`-first (a convention change for this lane, stated in
 * the PR body): R399's lesson is that a bare `getByText` matches the
 * fixture's OWN name — every league here is called "E2E L.B5.1 …" — so a
 * text assertion is presumed vacuous where an attribute exists.
 */

/** The commissioner is dev@; the modal names the actor from his profile
 *  (`schedule-view.tsx:195` — `profile?.username ?? 'you'`). */
const ACTOR_NAME = DEV_USER.username

test.describe('remix preview and confirm, free window (real browser)', () => {
  test.beforeAll(async () => {
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
    await assertNoForeignSeasonFixtures(service)
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('preview on mount → free window, no reason → confirm → applied post → the same post in the league feed', async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const service = serviceClient()

    const commishAuth = await signInDev()
    const managerAuth = await signInDevPro()
    const league = await provisionLeague({
      nameSuffix: 'inseason remix',
      teamCount: 8,
      // A SHORT board: this spec asserts nothing about rosters, and 16 picks
      // reach `in_season` in a fraction of a season board's time.
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
    console.log(`[inseason-remix] board complete in ${drive.steps} engine steps → ${drive.status}`)

    // The pairings BEFORE, straight from the authoritative table — the
    // "regenerated" claim is checked against these, not against the diff the
    // modal drew (which is the thing under test).
    const before = await readWeekMatchups(service, league.leagueId, 1)
    expect(before.length).toBeGreaterThan(0)

    const commishContext = await browser.newContext({ storageState: STORAGE_STATE.dev })
    try {
      const page = await commishContext.newPage()
      await page.goto(`/app/leagues/${league.leagueId}/schedule`)

      // The commissioner-only door (`schedule-view.tsx:151`).
      const open = page.locator('[data-remix-open]')
      await expect(open).toBeVisible({ timeout: 60_000 })

      // The modal PREVIEWS ON MOUNT (`useEffect(() => preview.preview(), [])`,
      // schedule-remix-modal.tsx:115-118) — there is no Preview button to
      // click. Capture the server's plans off the wire so the post preview can
      // be compared to `systemPostPreview` EXACTLY rather than by shape.
      //
      // WHY BY SEED AND NOT "the first response". Next's App Router runs with
      // React StrictMode on in dev, so that mount effect fires TWICE and two
      // previews are minted with two different seeds; only the LATER one
      // renders. Taking the first response made this assertion intermittently
      // compare the wrong plan (measured: 108 vs 112 pairings changed, 2 of 6
      // runs). The seed the panel is SHOWING is the key, so the comparison is
      // exact and race-free.
      const plans = new Map<number, RemixPreview>()
      page.on('response', (res) => {
        if (!res.url().includes('/schedule/remix') || res.request().method() !== 'POST') return
        void res
          .json()
          .then((body: RemixPreview) => plans.set(body.seed, body))
          .catch(() => undefined)
      })

      const renderedPlan = async (): Promise<RemixPreview> => {
        await expect(page.locator('[data-side-by-side]')).toBeVisible({ timeout: 60_000 })
        const seedText = await page.locator('[data-remix-seed]').getAttribute('data-remix-seed')
        if (seedText === null) throw new Error('the preview panel rendered no seed')
        const shown = plans.get(Number(seedText))
        if (!shown) {
          throw new Error(
            `the panel is showing seed ${seedText} but no preview response with that seed was ` +
              `captured (saw ${[...plans.keys()].join(', ')})`,
          )
        }
        return shown
      }

      await open.click()
      await expect(page.locator('[data-remix-modal]')).toBeVisible()
      let plan = await renderedPlan()

      // A seed can reproduce the current season exactly; Confirm is then
      // gated shut BY DESIGN (`confirmGate` → NO_CHANGES_COPY). Roll until a
      // seed changes something, loudly rather than silently skipping.
      const confirmButton = page.locator('[data-confirm-remix]')
      for (let roll = 1; plan.no_changes && roll <= 4; roll++) {
        const previousSeed = String(plan.seed)
        await page.locator('[data-remix-roll]').click()
        // A roll is one gesture and mints exactly one seed, so "the panel
        // shows a different seed" is the settle condition — not a button
        // state, which a second no-changes plan would leave untouched.
        await expect(page.locator('[data-remix-seed]')).not.toHaveAttribute(
          'data-remix-seed',
          previousSeed,
          { timeout: 60_000 },
        )
        plan = await renderedPlan()
      }
      expect(plan.no_changes, 'four seeds all reproduced the current season — not a remix to confirm').toBe(false)

      // ---- E41's FREE arm, as the server decided it (D290) ---------------
      await expect(page.locator('[data-window="free"]')).toHaveCount(1)
      await expect(page.locator('[data-window="override"]')).toHaveCount(0)
      // The reason field is rendered only when the plan says it is required
      // (`schedule-remix-modal.tsx:342`); free ⇒ absent, and Confirm is live
      // with the field never touched.
      await expect(page.locator('[data-remix-reason]')).toHaveCount(0)
      await expect(page.locator('[data-confirm-gate]')).toHaveCount(0)
      await expect(confirmButton).toBeEnabled()

      // ---- The system-post PREVIEW is the shared pure function ------------
      // (`schedule-view-ops.ts:359`) applied to the server's own plan, with
      // an empty reason: the free arm's `'.'`-terminated sentence.
      const expectedPreview = systemPostPreview(plan, '', ACTOR_NAME)
      await expect(page.locator('[data-system-post-preview]')).toHaveText(expectedPreview)
      expect(expectedPreview.endsWith('.')).toBe(true)
      expect(expectedPreview).not.toContain('commissioner override')

      // ---- Confirm — never optimistic; the applied panel is the server's --
      const confirmResponse = page.waitForResponse(
        (res) => res.url().includes('/schedule/confirm') && res.request().method() === 'POST',
        { timeout: 60_000 },
      )
      await confirmButton.click()
      const applied = (await (await confirmResponse).json()) as {
        system_post: string
        weeks_regenerated: number[]
        matchups_replaced: number
      }
      await expect(page.locator('[data-remix-applied]')).toBeVisible({ timeout: 60_000 })
      const shownPost = await page.locator('[data-remix-applied] [data-system-post]').innerText()
      expect(shownPost).toBe(applied.system_post)

      // The SERVER's own copy of the post (`league_chat`, 111:748-749) — the
      // screen is checked against the database, not against itself.
      const posts = await readSystemPosts(service, league.leagueId)
      expect(posts.map((p) => p.message)).toContain(applied.system_post)
      // The free arm's terminator, from the SQL side too.
      expect(applied.system_post.endsWith('.')).toBe(true)
      expect(applied.system_post).toContain(`Schedule remixed by ${ACTOR_NAME}: `)

      // …and the season really was rewritten (D289: confirm regenerates from
      // the previewed seed IN-BODY; a client-sent schedule is never read).
      const after = await readWeekMatchups(service, league.leagueId, 1)
      const pairing = (rows: typeof after) =>
        rows.map((r) => `${r.home_team_id}|${r.away_team_id}`).sort().join(' ')
      expect(applied.matchups_replaced).toBeGreaterThan(0)
      expect(applied.weeks_regenerated.length).toBeGreaterThan(0)
      expect(after.length).toBe(before.length)
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(
        `[inseason-remix] weeks regenerated ${applied.weeks_regenerated.join(',')} · ` +
          `${applied.matchups_replaced} pairings replaced · week-1 pairings changed: ` +
          `${pairing(before) !== pairing(after)}`,
      )

      // ---- The same post, in the league home's activity feed --------------
      await page.getByRole('button', { name: 'Done' }).click()
      await page.goto(`/app/leagues/${league.leagueId}`)
      const feed = page.locator('[data-activity-feed] [data-feed-items]')
      await expect(feed).toBeVisible({ timeout: 60_000 })
      // `feedLines` renders a system item's text as `item.message` verbatim
      // (`activity-feed-ops.ts:80`), so this is an exact-equality assertion,
      // not a substring one.
      const systemItems = feed.locator('[data-feed-item="system"]')
      await expect(systemItems).toHaveCount(1)
      await expect(systemItems.first()).toContainText(applied.system_post)

      test.info().annotations.push({
        type: 'remix-window',
        description: `FREE (reason-free confirm, '.'-terminated post); OVERRIDE posture untested by design`,
      })
    } finally {
      await commishContext.close()
    }
  })
})
