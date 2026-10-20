/**
 * The k6 entries' shared init + setup (M7 L.F2.1). k6-only (uses `__ENV`,
 * `open`, blocking http in setup).
 *
 * Environment (the wrapper `scripts/load/k6.ts` sets all of it; running
 * `k6 run` by hand needs the same):
 *   FS_LOAD_TARGET       local | test
 *   FS_LOAD_URL          the Supabase API base URL
 *   FS_LOAD_ANON_KEY     the target's anon key
 *   FS_LOAD_SERVICE_KEY  the target's service-role key (verify reads only)
 *   FS_LOAD_DENY         comma list naming PRODUCTION (read by the wrapper
 *                        from the repo's link file — never typed, never
 *                        committed); empty ⇒ a test target is refused
 *   FS_LOAD_PROFILE      smoke | y2026 | ga
 *   FS_LOAD_MANIFEST     the seeder's manifest path
 * The guard runs in the INIT context, so a refused target never sends a
 * single request.
 */
import { assertSafeTarget, realtimeSocketUrl, resolveProfile, type LoadProfile, type TargetKind } from '../config'
import { parseManifest, type LoadManifest, type SeedScenario } from './manifest'
import { k6Json } from './k6-transport'
import type { Endpoint } from './supa'

export interface K6Context {
  ep: Endpoint
  serviceKey: string
  socketUrl: string
  profile: LoadProfile
  manifest: LoadManifest
}

function env(name: string): string {
  const v = __ENV[name]
  if (v === undefined || v.length === 0) throw new Error(`${name} is not set (run through scripts/load/k6.ts)`)
  return v
}

export function loadK6Context(expected: SeedScenario): K6Context {
  const kind = env('FS_LOAD_TARGET') as TargetKind
  const url = assertSafeTarget({
    kind,
    url: env('FS_LOAD_URL'),
    deny: (__ENV.FS_LOAD_DENY ?? '').split(','),
  })
  const profile = resolveProfile(__ENV.FS_LOAD_PROFILE)
  const manifest = parseManifest(open(env('FS_LOAD_MANIFEST')))
  if (manifest.scenario !== expected) {
    throw new Error(`manifest is for '${manifest.scenario}', this script needs '${expected}' (re-seed)`)
  }
  if (manifest.profile !== profile.name) {
    throw new Error(`manifest was seeded at profile '${manifest.profile}', the run asked for '${profile.name}'`)
  }
  if (manifest.target !== kind) throw new Error(`manifest was seeded on a '${manifest.target}' target, not '${kind}'`)
  const anonKey = env('FS_LOAD_ANON_KEY')
  return {
    ep: { url, anonKey },
    serviceKey: env('FS_LOAD_SERVICE_KEY'),
    socketUrl: realtimeSocketUrl(url, anonKey),
    profile,
    manifest,
  }
}

/** Sign every bot in (blocking — setup context). Index → access token. */
export function signInAll(ctx: K6Context, botIndexes?: readonly number[]): Record<number, string> {
  const tokens: Record<number, string> = {}
  const want = botIndexes ?? ctx.manifest.bots.map((b) => b.index)
  for (const index of want) {
    const bot = ctx.manifest.bots.find((b) => b.index === index)
    if (!bot) throw new Error(`manifest has no bot ${index}`)
    const res = k6Json('POST', `${ctx.ep.url}/auth/v1/token?grant_type=password`, { email: bot.email, password: bot.password }, { apikey: ctx.ep.anonKey })
    const token = (res.json as { access_token?: unknown } | null)?.access_token
    if (res.status !== 200 || typeof token !== 'string') throw new Error(`bot ${index} sign-in failed (${res.status})`)
    tokens[index] = token
  }
  return tokens
}

/** The commissioner of each seeded draft starts it (`draft_start`). */
export function startDrafts(ctx: K6Context, tokens: Record<number, string>): void {
  for (const d of ctx.manifest.drafts) {
    const res = k6Json('POST', `${ctx.ep.url}/rest/v1/rpc/draft_start`, { p_league_id: d.leagueId }, {
      apikey: ctx.ep.anonKey,
      authorization: `Bearer ${tokens[d.commissioner]}`,
    })
    if (res.status !== 200) throw new Error(`draft_start failed for a seeded league (${res.status}): ${JSON.stringify(res.json)}`)
  }
}
