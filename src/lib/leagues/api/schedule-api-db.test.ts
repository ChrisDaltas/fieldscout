/**
 * schedule-api-db.test.ts — L.D4.2 items 1 & 3 at the SERVICE layer: the
 * Remix pair (`POST …/schedule/remix` → preview, `POST …/schedule/confirm` →
 * apply) against the LOCAL Supabase stack through PostgREST, with real
 * signed-in clients (the `members-api-db.test.ts` shape).
 *
 * pgTAP 059 covers 111's LAW DB-side (the E41 window at kickoff ±1s, the
 * per-week freeze classification, the byte-identical replay, every named
 * refusal). What THIS suite proves is the layer above it, and one claim in
 * particular — **the DoD's break-probe target**:
 *
 *   **THE APPLIED SCHEDULE IS THE ONE THE SERVER GENERATED.** The round trip
 *   posts a SEED and nothing else; the rows that land in `matchups` are then
 *   compared, pairing by pairing, against the `proposed` set the PREVIEW
 *   returned for that same seed. A confirm that honoured a client-supplied
 *   body — or that applied anything other than its own in-body regeneration
 *   — cannot satisfy that comparison. The negative half is here too: a body
 *   carrying `matchups`/`proposed` is REFUSED (400), not ignored.
 *
 * Plus: the auth matrix (a member who is not the commissioner, and an
 * outsider, share one no-leak 403), the `action_id` round trip (a replay of
 * the same submit is byte-identical; a REUSE for a different seed is refused
 * rather than answered 200 with someone else's schedule), the P0001 → 409
 * mapping with the RPC's copy verbatim, and the D97 system post the confirm
 * writes showing up in the activity feed (§13.4's other half).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5) precedent; FAILS loudly when the stack is down, never skips (§4.3).
 *
 * CALENDAR (F215/F226): `SYNTHETIC_SEASON` (2099) with its `nfl_weeks` rows
 * seeded idempotently and NO `nfl_games` — so E41's datum chain falls back to
 * the week datum, every kickoff is ahead, and the league sits inside the FREE
 * window where no `reason` is required. The post-kickoff reason law is 059's
 * subject (it moves the kickoff; `now()` is frozen in-transaction and 111
 * deliberately takes no caller instant — D307).
 *
 * Determinism: FIXED emails/usernames/action_ids/seeds + cleanup-first (the
 * D3/D17 ESLint bans cover `src/lib/leagues/**`). Action-id prefix `af8` —
 * this suite owns it (the D108(14) registry: af0–af7 taken, af8 measured
 * free 2026-09-03).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { readActivity } from './activity-service'
import {
  SCHEDULE_ACTION_ID_REUSED_MESSAGE,
  SCHEDULE_FORBIDDEN_MESSAGE,
  confirmRemix,
  previewRemix,
} from './schedule-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-schedule-api-league'
const TEAM_COUNT = 8

/** Fixed seeds — the whole point is that the same seed is reproducible. */
const REMIX_SEED = 20990117
const OTHER_SEED = 20990222

const COMMISH = {
  email: 'schedule-api-commish@fieldscout.test',
  password: 'pgtap-sched-api-pass-1',
  username: 'sc_commish_one',
}
const MEMBER = {
  email: 'schedule-api-member@fieldscout.test',
  password: 'pgtap-sched-api-pass-2',
  username: 'sc_member_two',
}
const OUTSIDER = {
  email: 'schedule-api-outsider@fieldscout.test',
  password: 'pgtap-sched-api-pass-3',
  username: 'sc_outsider_three',
}

const ACTION = {
  league: 'af800000-0000-4000-8000-000000000001',
  confirm: 'af800000-0000-4000-8000-000000000011',
  confirmAgain: 'af800000-0000-4000-8000-000000000012',
  reuse: 'af800000-0000-4000-8000-000000000011', // deliberately ACTION.confirm
  member: 'af800000-0000-4000-8000-000000000013',
  outsider: 'af800000-0000-4000-8000-000000000014',
  forged: 'af800000-0000-4000-8000-000000000015',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

interface Refusal {
  error: string
}
interface ProposedRow {
  week: number
  round_type: string
  home_team_id: string
  away_team_id: string | null
  regenerated: boolean
}
interface Preview {
  seed: number
  current_seed: number | null
  first_week: number
  change_count: number
  no_changes: boolean
  weeks_regenerable: number[]
  proposed: ProposedRow[]
  window: { free: boolean; reason_required: boolean }
}

let commishClient: SupabaseClient<Database>
let memberClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let leagueId: string

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    for (const table of [
      'transactions',
      'league_player_pool',
      'league_chat',
      'matchups',
      'league_weeks',
      'league_rosters',
      'league_members',
    ] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { error: actionsError } = await service.from('schedule_actions').delete().in('league_id', ids)
    if (actionsError) throw new Error(`cleanup schedule_actions: ${actionsError.message}`)
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
  for (const u of [COMMISH, MEMBER, OUTSIDER]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: { email: string; password: string; username: string }): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** The written pairing grid, in the same shape and order 111's `proposed`
 *  uses — so the two can be compared as data rather than eyeballed. */
async function writtenGrid(): Promise<Array<Omit<ProposedRow, 'regenerated'>>> {
  const { data, error } = await service
    .from('matchups')
    .select('week, round_type, home_team_id, away_team_id')
    .eq('league_id', leagueId)
  if (error) throw new Error(`matchups read: ${error.message}`)
  return (data ?? [])
    .map((row) => ({
      week: row.week,
      round_type: row.round_type,
      home_team_id: row.home_team_id,
      away_team_id: row.away_team_id,
    }))
    .sort(
      (a, b) =>
        a.week - b.week ||
        a.round_type.localeCompare(b.round_type) ||
        a.home_team_id.localeCompare(b.home_team_id),
    )
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  const commishId = await createUser(COMMISH)
  const memberId = await createUser(MEMBER)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  memberClient = await signIn(MEMBER)
  outsiderClient = await signIn(OUTSIDER)

  const settings = defaultsForTeamCount(TEAM_COUNT)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient
    .from('scoring_systems')
    .select('id, rules')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  const { data: created, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: SYNTHETIC_SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'Commish Team',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  // Fill the remaining seats — the engine refuses a half-seated league.
  const { data: seats, error: seatError } = await service
    .from('teams')
    .insert(
      Array.from({ length: TEAM_COUNT - 1 }, (_, i) => ({
        owner_id: commishId,
        name: `SC Team ${i + 2}`,
        league_id: leagueId,
      })),
    )
    .select('id')
  if (seatError) throw new Error(`teams insert: ${seatError.message}`)

  // One ordinary MEMBER (not the commissioner) on one of those franchises —
  // the auth matrix's middle case.
  const { error: memberError } = await service
    .from('league_members')
    .insert({ league_id: leagueId, user_id: memberId, team_id: seats![0].id, role: 'manager' })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)

  const { error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)

  // The season the Remix will re-cut. `league_generate_schedule` is REVOKEd
  // from `authenticated` (110:812) — it is the completion path's, driven
  // here by the service client, exactly as `schedule-property-db.test.ts`
  // drives it.
  const { error: genError } = await service.rpc('league_generate_schedule', {
    p_league_id: leagueId,
  })
  if (genError) throw new Error(`league_generate_schedule: ${genError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

// ---------------------------------------------------------------------------
// 1. Preview — write-free, and the E41 window says what it says
// ---------------------------------------------------------------------------

describe('POST …/schedule/remix — the write-free preview', () => {
  it('returns a plan for the seed and CHANGES NOTHING', async () => {
    const before = await writtenGrid()
    const result = await previewRemix(commishClient, leagueId, { seed: REMIX_SEED })
    expect(result.status).toBe(200)
    const plan = result.body as unknown as Preview

    expect(plan.seed).toBe(REMIX_SEED)
    expect(plan.first_week).toBe(1)
    expect(plan.weeks_regenerable.length).toBeGreaterThan(0)
    expect(plan.change_count).toBeGreaterThan(0)
    expect(plan.no_changes).toBe(false)
    expect(plan.proposed.length).toBe(before.length)
    // E41: 2099 has no kickoff behind us, so the window is FREE and no
    // reason is required — the RPC's evaluation, not this suite's.
    expect(plan.window).toMatchObject({ free: true, reason_required: false })

    expect(await writtenGrid()).toEqual(before)
  })

  it('the same seed previews the same plan twice (the generator is deterministic)', async () => {
    // Everything EXCEPT `window.evaluated_at`, which is the transaction's own
    // `now()` and is SUPPOSED to move: E41 is evaluated at transaction time,
    // never from a caller-supplied instant (D307), so two previews a
    // millisecond apart carry two instants and one identical plan.
    const strip = (result: { body: unknown }) => {
      const plan = { ...(result.body as Record<string, unknown>) }
      plan.window = { ...(plan.window as Record<string, unknown>), evaluated_at: '<transaction now()>' }
      return JSON.stringify(plan)
    }
    const a = await previewRemix(commishClient, leagueId, { seed: REMIX_SEED })
    const b = await previewRemix(commishClient, leagueId, { seed: REMIX_SEED })
    expect(strip(a)).toBe(strip(b))
    // …and the instant really did move, so the pin above is not vacuous.
    expect(JSON.stringify(a.body)).not.toBe(JSON.stringify(b.body))
  })

  it('a different seed proposes a different season', async () => {
    const a = (await previewRemix(commishClient, leagueId, { seed: REMIX_SEED }))
      .body as unknown as Preview
    const b = (await previewRemix(commishClient, leagueId, { seed: OTHER_SEED }))
      .body as unknown as Preview
    expect(JSON.stringify(a.proposed)).not.toBe(JSON.stringify(b.proposed))
  })
})

// ---------------------------------------------------------------------------
// 2. THE DoD PIN — confirm applies the SERVER's regeneration of the seed
// ---------------------------------------------------------------------------

describe('POST …/schedule/confirm — regenerate-in-body (§11.7/D289)', () => {
  let preview: Preview

  it('applies exactly the pairings the PREVIEW of that seed proposed', async () => {
    preview = (await previewRemix(commishClient, leagueId, { seed: REMIX_SEED }))
      .body as unknown as Preview

    const result = await confirmRemix(commishClient, leagueId, {
      seed: REMIX_SEED,
      action_id: ACTION.confirm,
    })
    expect(result.status).toBe(200)
    const applied = result.body as unknown as {
      schedule_seed: number
      previous_seed: number | null
      matchups_replaced: number
      change_count: number
      system_post: string
      weeks_regenerated: number[]
    }
    expect(applied.schedule_seed).toBe(REMIX_SEED)
    expect(applied.change_count).toBe(preview.change_count)

    // THE CLAIM. The rows in the database are the ones the SERVER generated
    // from this seed — compared as data, pairing by pairing. Nothing the
    // client sent could produce this equality: the client sent one integer.
    const expected = preview.proposed
      .map(({ week, round_type, home_team_id, away_team_id }) => ({
        week,
        round_type,
        home_team_id,
        away_team_id,
      }))
      .sort(
        (a, b) =>
          a.week - b.week ||
          a.round_type.localeCompare(b.round_type) ||
          a.home_team_id.localeCompare(b.home_team_id),
      )
    expect(await writtenGrid()).toEqual(expected)

    // …and the seed was written back, so the league's stored setting now
    // reproduces what is on the board.
    const { data: league } = await service
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single()
    expect((league!.settings as Record<string, unknown>).schedule_seed).toBe(REMIX_SEED)
  })

  it('a client-supplied SCHEDULE body is REFUSED, not ignored (400)', async () => {
    // The forged body names a pairing the engine would never produce. A
    // route that dropped unknown keys silently would answer 200 here and
    // teach a client that sending schedules "works".
    const forged = await confirmRemix(commishClient, leagueId, {
      seed: OTHER_SEED,
      action_id: ACTION.forged,
      matchups: [{ week: 1, home_team_id: 'x', away_team_id: 'y' }],
    })
    expect(forged.status).toBe(400)
    expect(JSON.stringify(forged.body)).toContain('matchups')

    // Nothing was applied, and the id was NOT consumed.
    const { count } = await service
      .from('schedule_actions')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('action_id', ACTION.forged)
    expect(count).toBe(0)
  })

  it('the same rejection covers `proposed`, `diff` and `weeks` bodies', async () => {
    for (const key of ['proposed', 'diff', 'weeks_regenerable']) {
      const result = await confirmRemix(commishClient, leagueId, {
        seed: OTHER_SEED,
        action_id: ACTION.forged,
        [key]: [],
      })
      expect(result.status, key).toBe(400)
    }
  })

  it('a seed outside §11.7\'s space never reaches the RPC', async () => {
    for (const seed of [-1, 2_147_483_648, 1.5]) {
      const result = await confirmRemix(commishClient, leagueId, {
        seed,
        action_id: ACTION.forged,
      })
      expect(result.status, String(seed)).toBe(400)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. The action_id round trip
// ---------------------------------------------------------------------------

describe('the confirm\'s action_id — replay vs reuse', () => {
  it('replays the SAME submit byte-identically', async () => {
    const first = await service
      .from('schedule_actions')
      .select('result')
      .eq('league_id', leagueId)
      .eq('action_id', ACTION.confirm)
      .single()
    const replay = await confirmRemix(commishClient, leagueId, {
      seed: REMIX_SEED,
      action_id: ACTION.confirm,
    })
    expect(replay.status).toBe(200)
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(first.data!.result))

    // One ledger row, one system post — a replay writes neither again.
    const { count } = await service
      .from('schedule_actions')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
    expect(count).toBe(1)
  })

  it('REFUSES the id reused for a DIFFERENT seed rather than returning the first confirm\'s schedule', async () => {
    const result = await confirmRemix(commishClient, leagueId, {
      seed: OTHER_SEED,
      action_id: ACTION.reuse,
    })
    expect(result.status).toBe(409)
    expect((result.body as unknown as Refusal).error).toBe(SCHEDULE_ACTION_ID_REUSED_MESSAGE)
    // The board is untouched: still the REMIX_SEED season.
    const { data: league } = await service
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single()
    expect((league!.settings as Record<string, unknown>).schedule_seed).toBe(REMIX_SEED)
  })

  it('re-confirming the SAME seed with a FRESH id refuses by name (P0001 → 409, copy verbatim)', async () => {
    // The seed is already the league's, so the regeneration changes nothing
    // — 111 refuses rather than rewriting the season into itself (R731).
    const result = await confirmRemix(commishClient, leagueId, {
      seed: REMIX_SEED,
      action_id: ACTION.confirmAgain,
    })
    expect(result.status).toBe(409)
    const message = (result.body as unknown as Refusal).error
    expect(message).toContain('schedule_remix_confirm:')
    expect(message.length).toBeGreaterThan(30) // it is a sentence, not a code
  })
})

// ---------------------------------------------------------------------------
// 4. The auth matrix — 42501 → 403, no-leak
// ---------------------------------------------------------------------------

describe('the auth matrix — only the commissioner remixes (§11.7)', () => {
  it('an ordinary MEMBER cannot preview or confirm', async () => {
    const preview = await previewRemix(memberClient, leagueId, { seed: OTHER_SEED })
    expect(preview.status).toBe(403)
    expect((preview.body as unknown as Refusal).error).toBe(SCHEDULE_FORBIDDEN_MESSAGE)

    const confirm = await confirmRemix(memberClient, leagueId, {
      seed: OTHER_SEED,
      action_id: ACTION.member,
    })
    expect(confirm.status).toBe(403)
  })

  it('an OUTSIDER gets the identical answer — the copy distinguishes nothing', async () => {
    const preview = await previewRemix(outsiderClient, leagueId, { seed: OTHER_SEED })
    expect(preview.status).toBe(403)
    expect((preview.body as unknown as Refusal).error).toBe(SCHEDULE_FORBIDDEN_MESSAGE)

    const confirm = await confirmRemix(outsiderClient, leagueId, {
      seed: OTHER_SEED,
      action_id: ACTION.outsider,
    })
    expect(confirm.status).toBe(403)
  })

  it('neither wrote a ledger row', async () => {
    for (const actionId of [ACTION.member, ACTION.outsider]) {
      const { count } = await service
        .from('schedule_actions')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('action_id', actionId)
      expect(count, actionId).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. The confirm's D97 system post reaches the activity feed (§13.4)
// ---------------------------------------------------------------------------

describe('the Remix shows up in the activity feed', () => {
  it('the confirm\'s in-transaction system post is a `system` item carrying its text', async () => {
    const result = await readActivity(commishClient, leagueId, { kind: 'system' })
    expect(result.status).toBe(200)
    const feed = result.body as unknown as {
      items: Array<{ kind: string; context: string; message: string }>
    }
    expect(feed.items).toHaveLength(1)
    expect(feed.items[0].kind).toBe('system')
    expect(feed.items[0].context).toBe('league')
    expect(feed.items[0].message).toContain('Schedule remixed by')
    expect(feed.items[0].message).toContain('regular-season weeks regenerated')
  })

  it('an ORDINARY MEMBER reads it too — the feed is the league\'s record, not the commissioner\'s', async () => {
    const result = await readActivity(memberClient, leagueId, {})
    expect((result.body as unknown as { items: unknown[] }).items).toHaveLength(1)
  })

  it('an OUTSIDER reads nothing', async () => {
    const result = await readActivity(outsiderClient, leagueId, {})
    expect((result.body as unknown as { items: unknown[] }).items).toHaveLength(0)
  })
})
