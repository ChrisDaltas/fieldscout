import type { SupabaseClient } from '@supabase/supabase-js'

import type { TimeProvider } from '@/lib/leagues/time/time-provider'

import { buildIndex, matchPlayers, type MatchPlayer, type MatchRule } from './match'
import { type NewsItem, parseBluesky, parseRss } from './parse'
import { BLUESKY_APPVIEW, NEWS_SOURCES, type NewsSource } from './sources'

/**
 * The player-news ingest (F575; D550). Fetches every source at once (plain
 * fetch; 15 s per source, 45 s for the whole run, bodies capped at 5 MB —
 * R1590/R1592), keeps only items that match a player by the ruled rules, and stores them
 * idempotently: `player_news` is unique on (source_key, external_id) and
 * `player_news_players` on (news_id, player_id), so a re-run inserts nothing
 * new. One failing source is reported, never fatal to the others.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface IngestDeps {
  db: SupabaseClient
  time: TimeProvider
  fetch?: FetchLike
  sources?: readonly NewsSource[]
  /** Total fetch budget for ALL sources together (default 45 s — fits the
   *  route's maxDuration 60 and the 55 s pg_net ping, R1590). */
  budgetMs?: number
}

export interface IngestReport {
  sources: Array<{ key: string; fetched: number; matched: number; error?: string }>
  players: number
  itemsUpserted: number
  linksInserted: number
  ok: boolean
}

const UA = 'FieldScoutBot/0.1 (+https://fieldscout.gg)'
const TIMEOUT_MS = 15_000
const MAX_BYTES = 5_000_000

const FETCH_BUDGET_MS = 45_000

/** Read at most MAX_BYTES of the body: a declared length over the cap is
 *  refused before reading, and a stream is cut off at the cap (R1592). */
export async function readCapped(res: Response, max = MAX_BYTES): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) throw new Error('response too large')
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      throw new Error('response too large')
    }
    chunks.push(value)
  }
  const buf = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.byteLength
  }
  return new TextDecoder().decode(buf)
}

async function readSource(source: NewsSource, f: FetchLike, budget: AbortSignal): Promise<NewsItem[]> {
  const url =
    source.kind === 'rss'
      ? source.url
      : `${BLUESKY_APPVIEW}?actor=${encodeURIComponent(source.handle)}&limit=30&filter=posts_no_replies`
  const res = await f(url, {
    headers: {
      'user-agent': UA,
      accept: source.kind === 'rss' ? 'application/rss+xml, application/xml, text/xml' : 'application/json',
    },
    // Per-source timeout AND the shared run budget; the signal also covers the body read.
    signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), budget]),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await readCapped(res)
  if (source.kind === 'rss') return parseRss(body, source)
  return parseBluesky(JSON.parse(body) as unknown, source)
}

function errorText(err: unknown): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timed out'
  return err instanceof Error ? err.message : String(err)
}

/** Every rostered, non-team-defense player, paged past PostgREST's 1000 cap. */
export async function loadMatchPlayers(db: SupabaseClient): Promise<MatchPlayer[]> {
  const out: MatchPlayer[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('players')
      .select('id, full_name, team')
      .not('team', 'is', null)
      .neq('position', 'DEF')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`players read failed: ${error.message}`)
    out.push(...((data ?? []) as MatchPlayer[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

export async function ingestPlayerNews(deps: IngestDeps): Promise<IngestReport> {
  const f = deps.fetch ?? ((u, i) => fetch(u, i))
  const players = await loadMatchPlayers(deps.db)
  // Zero players means the read is wrong, not that there is no news.
  if (players.length === 0) throw new Error('no players to match against — refusing to report an empty ingest as success')
  const index = buildIndex(players)
  const fetchedAt = deps.time.now().toISOString()

  const report: IngestReport = { sources: [], players: players.length, itemsUpserted: 0, linksInserted: 0, ok: true }
  // R1590: every source is fetched at once under ONE budget; the writes
  // below stay sequential.
  const sources = deps.sources ?? NEWS_SOURCES
  const budget = AbortSignal.timeout(deps.budgetMs ?? FETCH_BUDGET_MS)
  const settled = await Promise.allSettled(sources.map((s) => readSource(s, f, budget)))
  for (const [i, source] of sources.entries()) {
    const result = settled[i]
    if (result.status === 'rejected') {
      report.ok = false
      report.sources.push({ key: source.key, fetched: 0, matched: 0, error: errorText(result.reason) })
      continue
    }
    const items = result.value
    // A feed repeating one id would make the upsert touch a row twice (21000).
    const seen = new Set<string>()
    const unique = items.filter((i) => !seen.has(i.external_id) && seen.add(i.external_id))
    const matched = unique
      .map((item) => ({ item, players: matchPlayers(item.match_text, index) }))
      .filter((m) => m.players.length > 0)
    report.sources.push({ key: source.key, fetched: items.length, matched: matched.length })
    if (matched.length === 0) continue

    const rows = matched.map(({ item }) => ({
      source_key: item.source_key,
      source_label: item.source_label,
      external_id: item.external_id,
      url: item.url,
      headline: item.headline,
      published_at: item.published_at ?? fetchedAt,
      fetched_at: fetchedAt,
    }))
    const { data: stored, error } = await deps.db
      .from('player_news')
      .upsert(rows, { onConflict: 'source_key,external_id' })
      .select('id, external_id')
    if (error) {
      report.ok = false
      report.sources[report.sources.length - 1].error = `store failed: ${error.message}`
      continue
    }
    report.itemsUpserted += stored?.length ?? 0
    const idOf = new Map((stored ?? []).map((r: { id: string; external_id: string }) => [r.external_id, r.id]))
    const links: Array<{ news_id: string; player_id: string; rule: MatchRule }> = []
    for (const { item, players: ps } of matched) {
      const newsId = idOf.get(item.external_id)
      if (!newsId) continue
      for (const p of ps) links.push({ news_id: newsId, player_id: p.player_id, rule: p.rule })
    }
    const { data: inserted, error: linkErr } = await deps.db
      .from('player_news_players')
      .upsert(links, { onConflict: 'news_id,player_id', ignoreDuplicates: true })
      .select('news_id')
    if (linkErr) {
      report.ok = false
      report.sources[report.sources.length - 1].error = `link failed: ${linkErr.message}`
      continue
    }
    report.linksInserted += inserted?.length ?? 0
  }
  return report
}
