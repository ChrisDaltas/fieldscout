/**
 * run-node — the four §22.6 scenario bodies on Node instead of k6 (M7
 * L.F2.1). The SAME VU code k6 runs (`load/k6/scenarios/*`), over
 * `node-transport.ts`, with every VU an async task in one process.
 *
 *   npx tsx scripts/load/run-node.ts s1 --target local --profile smoke
 *   npx tsx scripts/load/run-node.ts s2 --target local --profile smoke
 *   npx tsx scripts/load/run-node.ts s3 --target local --profile smoke --recording <rec> --speed <x> [--clip-minutes N|all] [--poll-sec S] [--worker self|external]
 *   npx tsx scripts/load/run-node.ts s4 --target local --profile smoke
 *
 * WHAT THIS IS FOR. Exercising the harness end to end where no k6 binary is
 * installed (this task's local proof), and a quick check before a k6 run.
 * One Node process is a weaker load generator than k6 — §22.6 numbers come
 * from k6 runs on the hosted test project (`scripts/load/k6.ts`), never from
 * this driver. It prints the same asserts either way, under the size banner.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

import type { Database } from '@/types/database'

import { realtimeSocketUrl, resolveProfile, seatsPerDraft, sizeBanner, soakConnections } from '../../load/k6/config'
import { allPass, renderAsserts, type AssertLine } from '../../load/k6/lib/checks'
import { parseManifest, type LoadManifest, type SeedScenario } from '../../load/k6/lib/manifest'
import { rpc, signIn, type Endpoint } from '../../load/k6/lib/supa'
import { auctionAsserts, auctionVerify, auctionVu } from '../../load/k6/scenarios/auction-storm'
import { soakAsserts, soakLeakProbe, soakVu, sundayViewerVu } from '../../load/k6/scenarios/league-viewers'
import { snakeAsserts, snakeVerify, snakeVu } from '../../load/k6/scenarios/snake-draft'
import { nodeTransport } from './node-transport'
import { manifestPath } from './seed-staging'
import { loadRecording, replayAsserts, runSundayReplay } from './sunday-replay'
import { resolveTarget } from './target'

const SCENARIO_SEED: Record<string, SeedScenario> = { s1: 'snake', s2: 'auction', s3: 'leagues', s4: 'leagues' }

function flags(argv: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]!
    if (!k.startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument '${k}'`)
    out.set(k, argv[i + 1]!)
  }
  return out
}

async function main(): Promise<void> {
  const [scenario, ...rest] = process.argv.slice(2)
  const seedScenario = scenario ? SCENARIO_SEED[scenario] : undefined
  if (!seedScenario) throw new Error('usage: run-node.ts s1|s2|s3|s4 --target local|test --profile smoke|y2026|ga')
  const f = flags(rest)
  const known = new Set(['--target', '--profile', '--recording', '--speed', '--clip-minutes', '--poll-sec', '--worker'])
  for (const k of f.keys()) if (!known.has(k)) throw new Error(`unknown argument '${k}' (refused, never ignored)`)
  const target = resolveTarget(f.get('--target'))
  const profile = resolveProfile(f.get('--profile'))
  const manifest: LoadManifest = parseManifest(readFileSync(manifestPath(seedScenario), 'utf8'))
  if (manifest.profile !== profile.name || manifest.target !== target.kind) {
    throw new Error(`the ${seedScenario} manifest was seeded for ${manifest.profile}/${manifest.target}, not ${profile.name}/${target.kind}`)
  }
  const t = nodeTransport()
  const ep: Endpoint = { url: target.url, anonKey: target.anonKey }
  const socketUrl = realtimeSocketUrl(target.url, target.anonKey)
  const tokens = new Map<number, string>()
  for (const bot of manifest.bots) tokens.set(bot.index, await signIn(t, ep, bot.email, bot.password))
  const startDrafts = async (): Promise<void> => {
    for (const d of manifest.drafts) {
      const res = await rpc(t, ep, tokens.get(d.commissioner)!, 'draft_start', { p_league_id: d.leagueId })
      if (!res.ok) throw new Error(`draft_start failed (${res.status}): ${res.message ?? ''}`)
    }
  }
  const started = t.nowMs()
  let lines: AssertLine[]
  let title: string

  if (scenario === 's1') {
    const seats = seatsPerDraft(profile)
    const timeoutMs = profile.rounds * seats * (profile.clockSec + 5) * 1000
    await startDrafts()
    await Promise.all(
      manifest.drafts.flatMap((d) =>
        d.seats.map((s) =>
          snakeVu({ t, ep, socketUrl, token: tokens.get(s.bot)!, draftId: d.draftId, teamId: s.teamId, pool: manifest.pool, pickDelayMs: profile.pickDelayMs, timeoutMs }),
        ),
      ),
    )
    const verify = await snakeVerify({ t, ep, serviceKey: target.serviceKey, draftIds: manifest.drafts.map((d) => d.draftId) })
    title = `SCENARIO 1 — ${manifest.drafts.length} snake draft(s) × ${seats} bots, ${profile.clockSec} s clock`
    lines = snakeAsserts(t.metrics.samples('pick_to_broadcast_ms'), verify, t.metrics.total('pick_broadcast_missing'))
  } else if (scenario === 's2') {
    const d = manifest.drafts[0]!
    const timeoutMs = profile.storms * (profile.clockSec * 3 + 30) * 1000
    await startDrafts()
    await Promise.all(
      d.seats.map((s, seat) =>
        auctionVu({
          t,
          ep,
          socketUrl,
          token: tokens.get(s.bot)!,
          draftId: d.draftId,
          teamId: s.teamId,
          seat,
          seatTeams: d.seats.map((x) => x.teamId),
          pool: manifest.pool,
          bidsPerStorm: profile.bidsPerStorm,
          stormWindowMs: profile.stormWindowMs,
          storms: profile.storms,
          timeoutMs,
        }),
      ),
    )
    const verify = await auctionVerify(t, ep, target.serviceKey, d.draftId)
    title = `SCENARIO 2 — auction bid storm: ${profile.bidsPerStorm} bids in ${profile.stormWindowMs} ms × ${profile.storms} nomination(s), ${d.seats.length} seats`
    lines = auctionAsserts(
      verify,
      {
        sent: t.metrics.total('bids_sent'),
        accepted: t.metrics.total('bids_accepted'),
        refused: t.metrics.total('bids_refused'),
        failed: t.metrics.total('bids_failed'),
      },
      t.metrics.samples('bid_to_broadcast_ms'),
      profile.storms,
    )
  } else if (scenario === 's3') {
    const recording = f.get('--recording')
    if (!recording) throw new Error('s3 needs --recording <fixture.jsonl.gz>')
    const speed = Number(f.get('--speed') ?? 'NaN')
    if (!(speed > 0)) throw new Error('s3 needs --speed <x>')
    const service = createClient<Database>(target.url, target.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const leagueIds = manifest.leagues.map((l) => l.leagueId)
    const replayPromise = runSundayReplay({
      service,
      profile,
      recording: loadRecording(recording),
      speed,
      leagueIds,
      // `external` leaves scoring to the target's own scheduled worker; on a
      // stack with none, nothing scores — the lag assert's own break probe.
      worker: f.get('--worker') === 'external' ? 'external' : 'self',
      clipMinutes: !f.has('--clip-minutes') ? undefined : f.get('--clip-minutes') === 'all' ? null : Number(f.get('--clip-minutes')),
      pollSec: f.has('--poll-sec') ? Number(f.get('--poll-sec')) : undefined,
      wallClock: { now: () => new Date() },
      sleep: (ms) => t.sleep(ms),
      log: (line) => console.log(line),
    })
    // Viewers hold their channels until the replay resolves.
    let replayDone = false
    const viewers = Promise.all(
      manifest.leagues.flatMap((league, li) =>
        league.members.slice(0, profile.viewersPerLeague).map((bot, vi) =>
          sundayViewerVu({
            t,
            socketUrl,
            token: tokens.get(bot)!,
            leagueId: league.leagueId,
            presenceKey: `viewer-${li}-${vi}`,
            durationMs: 24 * 3_600_000,
            reportSilence: vi === 0,
            stop: () => replayDone,
          }),
        ),
      ),
    )
    const replay = await replayPromise.finally(() => {
      replayDone = true
    })
    await viewers
    title = `SCENARIO 3 — Sunday replay at ${speed}× across ${leagueIds.length} league(s), ${profile.viewersPerLeague} viewer(s) each`
    lines = [
      ...replayAsserts(replay, speed, leagueIds.length),
      {
        name: 'viewers: score broadcasts heard · leagues whose viewer heard none (F311 class)',
        pass: true,
        info: true,
        detail: `${t.metrics.total('score_broadcasts')} heard · ${t.metrics.total('leagues_silent')} silent league(s) · ${t.metrics.total('realtime_join_refused')} join(s) refused`,
      },
    ]
  } else {
    const connections = Math.min(soakConnections(profile), manifest.leagues.length * profile.viewersPerLeague)
    const durationMs = profile.soakHours * 3_600_000
    await Promise.all(
      Array.from({ length: connections }, (_, v) => {
        const league = manifest.leagues[Math.floor(v / profile.viewersPerLeague) % manifest.leagues.length]!
        const bot = league.members[v % profile.viewersPerLeague]!
        return soakVu({ t, socketUrl, token: tokens.get(bot)!, leagueId: league.leagueId, vuId: String(v), durationMs, holdSec: profile.churnHoldSec })
      }),
    )
    await t.sleep(10_000)
    const probe = await soakLeakProbe(t, socketUrl, tokens.get(manifest.leagues[0]!.members[0]!)!, manifest.leagues.map((l) => l.leagueId))
    title = `SCENARIO 4 — soak with churn: ${connections} connection(s) for ${Math.round(durationMs / 60_000)} min`
    lines = soakAsserts({
      joins: t.metrics.total('realtime_joins'),
      refused: t.metrics.total('realtime_join_refused'),
      quota: t.metrics.total('realtime_quota_violations'),
      unexpected: t.metrics.total('realtime_unexpected_closes'),
      leaked: probe.leaked,
      probed: probe.probed,
      leagues: manifest.leagues.length,
      joinMs: t.metrics.samples('realtime_join_ms'),
    })
  }

  const header = `${title} · ${sizeBanner(profile)} · target ${target.kind} · Node driver · ${Math.round((t.nowMs() - started) / 1000)} s`
  for (const line of renderAsserts(header, lines)) console.log(line)
  process.exit(allPass(lines) ? 0 : 1)
}

main().catch((e) => {
  console.error(`run-node: ${(e as Error).message}`)
  process.exit(1)
})
