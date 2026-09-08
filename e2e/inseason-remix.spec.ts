import { expect, test } from '@playwright/test'

import { systemPostPreview } from '@/components/leagues/schedule-view-ops'
import type { RemixConfirmResult, RemixPreview } from '@/hooks/use-schedule'

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

    // 110's completion wiring really did generate a season to remix. The
    // per-week BEFORE snapshot the rewrite is judged against is taken later,
    // over the previewed plan's own regenerable weeks (R936) — this is only
    // the door check that week 1 exists at all.
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

      // The pairings of every REGENERABLE week, taken from the authoritative
      // table while the previewed plan is on screen and BEFORE Confirm. Not
      // scoped to week 1: `no_changes === false` only guarantees that SOME
      // regenerable week changed, so a week-1-only diff would be a flake
      // (R936). Weeks 15+ are playoff/frozen and are never in this list.
      const pairings = (
        rows: ReadonlyArray<{ round_type: string; home_team_id: string; away_team_id: string | null }>,
      ): string[] =>
        rows.map((r) => `${r.round_type}|${r.home_team_id}|${r.away_team_id ?? 'BYE'}`).sort()
      const beforeByWeek = new Map<number, string[]>()
      for (const week of plan.weeks_regenerable) {
        beforeByWeek.set(week, pairings(await readWeekMatchups(service, league.leagueId, week)))
      }
      expect(beforeByWeek.size).toBeGreaterThan(0)

      // ---- Confirm — never optimistic; the applied panel is the server's --
      const confirmResponse = page.waitForResponse(
        (res) => res.url().includes('/schedule/confirm') && res.request().method() === 'POST',
        { timeout: 60_000 },
      )
      await confirmButton.click()
      const applied = (await (await confirmResponse).json()) as RemixConfirmResult
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

      // ---- WHAT WAS APPLIED IS WHAT WAS PREVIEWED (R938) -----------------
      // The applied post round-trips four ways below, but until this line
      // none of those four was ever compared to the sentence the
      // commissioner actually read. A confirm that regenerated from a seed
      // OTHER than the previewed one — a dropped `p_seed`, or the modal
      // sending the first of the two seeds StrictMode mints — would hand the
      // user plan B's season after showing plan A, and every other assertion
      // here would stay green (the week list is identical across seeds in
      // this fixture; the only datum that moves lives inside the post).
      // The seed is asserted too, because two seeds can coincide on
      // `change_count` and the post carries only the count.
      expect(applied.system_post).toBe(expectedPreview)
      expect(applied.schedule_seed).toBe(plan.seed)
      expect(applied.weeks_regenerated).toEqual(plan.weeks_regenerable)

      // ---- …AND THE SEASON REALLY WAS REWRITTEN (R936) -------------------
      // D289: confirm regenerates from the previewed seed IN-BODY; a
      // client-sent schedule is never read. Until this block that claim was
      // carried by a `console.log`: every post-confirm assertion read the
      // route's OWN self-report (`matchups_replaced`, `weeks_regenerated`) or
      // a row count that a rewrite persisting the ORIGINAL pairings leaves
      // untouched — and a `schedule_remix_confirm` patched to do exactly that
      // ran the whole spec green. So: read the persisted rows for every
      // regenerated week and assert they are the previewed plan's `proposed`
      // rows, the same way `inseason-week.spec.ts:398` asserts the stored
      // `league_weeks.status` instead of the job's report.
      expect(applied.matchups_replaced).toBeGreaterThan(0)
      expect(applied.weeks_regenerated.length).toBeGreaterThan(0)
      let persistedRows = 0
      const movedWeeks: number[] = []
      for (const week of applied.weeks_regenerated) {
        const proposed = plan.proposed.filter((row) => row.regenerated && row.week === week)
        expect(
          proposed.length,
          `the previewed plan proposed no regenerated row for week ${week}`,
        ).toBeGreaterThan(0)
        const persisted = await readWeekMatchups(service, league.leagueId, week)
        expect(
          pairings(persisted),
          `week ${week}'s STORED pairings are not the ones the preview proposed`,
        ).toEqual(pairings(proposed))
        persistedRows += persisted.length
        if (pairings(persisted).join(' ') !== beforeByWeek.get(week)!.join(' ')) movedWeeks.push(week)
      }
      // The route's self-report, bound to the rows that actually exist.
      expect(persistedRows).toBe(applied.matchups_replaced)
      // The headline, in its most direct form: at least one regenerable week
      // holds different pairings than it did before Confirm. Implied by the
      // equality above plus `no_changes === false`, asserted anyway because
      // it is the sentence the commissioner is being sold.
      expect(
        movedWeeks.length,
        'confirm reported a full replacement but not one regenerated week changed',
      ).toBeGreaterThan(0)
      // eslint-disable-next-line no-console -- the DoD evidence line
      console.log(
        `[inseason-remix] weeks regenerated ${applied.weeks_regenerated.join(',')} · ` +
          `${applied.matchups_replaced} pairings replaced, ${persistedRows} verified against the ` +
          `previewed plan · weeks whose stored pairings changed: ${movedWeeks.join(',')}`,
      )

      // ---- The same post, in the league home's activity feed --------------
      await page.getByRole('button', { name: 'Done' }).click()
      await page.goto(`/app/leagues/${league.leagueId}`)
      const feed = page.locator('[data-activity-feed] [data-feed-items]')
      await expect(feed).toBeVisible({ timeout: 60_000 })
      // `feedLines` renders a system item's text as `item.message` verbatim
      // (`activity-feed-ops.ts:80`). The assertion is on `[data-feed-text]`,
      // the span that holds ONLY that text, so it can be exact equality —
      // the <li> itself also renders the commissioner Badge and a formatted
      // timestamp (`actor_id` is non-null because `111:749` inserts with
      // `auth.uid()`), so an assertion on the item could only be containment,
      // and containment passes against a regression that wraps or prefixes
      // the message (R940).
      const systemItems = feed.locator('[data-feed-item="system"]')
      await expect(systemItems).toHaveCount(1)
      await expect(systemItems.first().locator('[data-feed-text]')).toHaveText(applied.system_post)

      test.info().annotations.push({
        type: 'remix-window',
        description: `FREE (reason-free confirm, '.'-terminated post); OVERRIDE posture untested by design`,
      })
    } finally {
      await commishContext.close()
    }
  })
})
