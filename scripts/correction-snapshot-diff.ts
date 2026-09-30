/**
 * correction-snapshot-diff — the diff between two recorded snapshots of one
 * NFL week (M6 L.E2.5, tasks-M6 §6; spec §23.4; PROGRESS D458). PURE: no fs,
 * no network, no clock — the CLIs (`scripts/diff-fixture-snapshots.ts`,
 * `scripts/record-fixtures.ts --snapshot`) own the IO.
 *
 * Input: two fixtures of the SAME (provider, season, week) in the L.A0.4
 * format (D6 / D27) — snapshot 1 taken once the week's last game is final,
 * snapshot 2 at / after its correction window's end — plus, optionally, each
 * snapshot's line sidecar (the player's name, team, game date and Sleeper's
 * own last-modified stamp, all from the same public endpoint) and
 * production's first-seen-final instants (`nfl_games.updated_at`, exported
 * read-only by `scripts/export-correction-events.ts`).
 *
 * Output: EVERY change to a line whose game was already final at snapshot 1
 * (TD2 / D434's test, the ingest's own: `toStatRow` + `movedStatKeys`, so
 * "absent ≡ 0 except a NULL_IS_PENDING column" is the ingest's equality,
 * byte for byte — never a second definition), each named — player, key,
 * old → new, game — with F528's measurement: the minutes between the game
 * being first seen final and the change, bounded honestly (the change
 * happened after snapshot 1 saw the old value and no later than snapshot 2
 * or Sleeper's stamp of the line's last modification).
 *
 * THE DIFF NEVER INVENTS A CHANGE. It reads only the two recorded bodies; a
 * snapshot that lacks a successful read of the week's lines, or two
 * snapshots that disagree on what they are, THROW — a missing read is never
 * an empty diff (CLAUDE.md "nothing happened ≠ it worked"). A change on a
 * game that was not final at snapshot 1 is listed apart (an in-game change,
 * not a correction); a line the provider dropped is listed apart (the ingest
 * never deletes a stored line). Nothing is hidden and nothing is merged.
 */
import type { FixtureEntry, FixtureMethod, FixtureRecording } from '../src/lib/leagues/stats/fixtures/fixture-format'
import { STAT_KEYS, type ScoringSurface } from '../src/lib/leagues/stats/stat-keys'
import type { ProviderGame, ProviderGameState, ProviderPlayerWeekStats } from '../src/lib/leagues/stats/stats-provider'
import { movedStatKeys, SETTLE_GRACE_MS, toStatRow, type StatRow } from '../src/lib/sync/ingest-week'

// ── Inputs ─────────────────────────────────────────────────────────────────

/** One line's identity and timing, read from Sleeper's public weekly-stats
 *  row beside the canonical recording (`correction-line-meta.ts`). */
export interface LineMeta {
  name: string | null
  position: string | null
  /** The team the player played FOR in this week's game (the row's `team`). */
  team: string | null
  opponent: string | null
  gameDate: string | null
  /** Sleeper's `last_modified` of the row, ISO — any field's change moves it
   *  (the rank fields included), so it bounds the last STAT change from above. */
  lastModified: string | null
}

export interface LinesSidecar {
  note: string
  season: number
  week: number
  /** When the sidecar's read ran (the canonical recording has its own `t`). */
  capturedAt: string
  lines: Record<string, LineMeta>
}

export interface Snapshot {
  /** `final` / `window-end` — the file's own label. */
  label: string
  recording: FixtureRecording
  lines?: LinesSidecar | null
}

/** Production's first observation of a final game (`nfl_games.updated_at`
 *  — the settle grace's own clock, D453(6)), matched by week + away@home. */
export interface FinalSeenGame {
  week: number
  homeTeam: string
  awayTeam: string
  status: string
  firstSeenFinalAt: string | null
}

/** A production `stat_correction_events` row, public fields only. */
export interface ProductionEvent {
  playerId: string
  statKey: string
  oldValue: number | null
  newValue: number | null
  detectedAt: string
  weekState: string
  gameId: string | null
}

export interface DiffOptions {
  finalSeen?: readonly FinalSeenGame[] | null
  events?: readonly ProductionEvent[] | null
  graceMs?: number
}

// ── Outputs ────────────────────────────────────────────────────────────────

export type GraceVerdict = 'inside' | 'outside' | 'undetermined'

export interface SnapshotChange {
  playerId: string
  name: string | null
  position: string | null
  team: string | null
  gameId: string | null
  /** How the game was found: the line's own id, the player's team in the
   *  week's schedule, or — neither known — the whole week (D432(3)). */
  gameBy: 'line' | 'team' | 'week'
  statKey: string
  label: string
  surface: ScoringSurface | 'unknown'
  old: number | null
  new: number | null
  /** `added` = no storable line at snapshot 1 (a gap filled late). */
  line: 'updated' | 'added'
  /** The game (or, by week, every in-week game) was final at snapshot 1. */
  finalAtFirst: boolean
  finalSeenAt: string | null
  /** `production` = the exact first observation; `recorder` = the earliest
   *  recorded read that shows it final (an upper bound on the true instant). */
  finalSeenSource: 'production' | 'recorder' | null
  changedAfter: string
  changedBy: string
  changedBySource: 'snapshot' | 'sleeper_last_modified'
  /** F528: minutes from first-seen-final to the change, as bounds — null
   *  where a bound is unknown. */
  minutesAfterFinal: { min: number | null; max: number | null }
  grace: GraceVerdict
  /** Production's event for the same player, key and new value, if any. */
  productionEvent: ProductionEvent | null
  notes: string[]
}

export interface VanishedLine {
  playerId: string
  name: string | null
  team: string | null
}

export interface SnapshotDiff {
  provider: string
  season: number
  week: number
  first: { label: string; t: string }
  second: { label: string; t: string }
  gamesAtFirst: { final: number; open: number; postponed: number }
  weekFinalAtFirst: boolean
  lines: { first: number; second: number; both: number; added: number; vanished: number; unchanged: number }
  /** Changes to lines whose game was final at snapshot 1 — the corrections. */
  changes: SnapshotChange[]
  /** Changes on games not yet final at snapshot 1 (in-game, not corrections). */
  notFinal: SnapshotChange[]
  vanished: VanishedLine[]
  /** Production events for this week that no change above accounts for. */
  productionOnly: ProductionEvent[]
  eventsCompared: boolean
  graceMs: number
  notes: string[]
}

// ── Reading a recording ────────────────────────────────────────────────────

function sameArgs(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** The latest SUCCESSFUL entry for (method, args) — the replayer's own rule
 *  (D6). None ⇒ throws: a snapshot without the read is not a snapshot. */
export function latestOk(recording: FixtureRecording, label: string, method: FixtureMethod, args: readonly number[]): FixtureEntry {
  const hits = recording.entries
    .filter((e) => e.method === method && sameArgs(e.args, args) && e.ok)
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
  const last = hits[hits.length - 1]
  if (!last) throw new Error(`snapshot "${label}" has no successful ${method}(${args.join(',')}) — refusing to diff a snapshot without it`)
  return last
}

interface ReadSnapshot {
  label: string
  t: string
  stats: ProviderPlayerWeekStats[]
  status: Map<string, ProviderGame['status']>
  weekGames: { gameId: string; homeTeam: string; awayTeam: string }[]
  /** Earliest recorded instant at which each game read final (recorder bound). */
  finalBy: Map<string, string>
  lines: Record<string, LineMeta>
}

function readSnapshot(snap: Snapshot): ReadSnapshot {
  const { season, week } = snap.recording.header
  const statsEntry = latestOk(snap.recording, snap.label, 'getWeekStats', [season, week])
  const statesEntry = latestOk(snap.recording, snap.label, 'getGameStates', [season, week])
  const scheduleEntry = latestOk(snap.recording, snap.label, 'getSchedule', [season])
  const stats = statsEntry.body as ProviderPlayerWeekStats[]
  if (!Array.isArray(stats)) throw new Error(`snapshot "${snap.label}": getWeekStats body is not a list`)
  const seen = new Set<string>()
  for (const line of stats) {
    if (seen.has(line.playerId)) throw new Error(`snapshot "${snap.label}": player ${line.playerId} has two lines — refusing to pick one`)
    seen.add(line.playerId)
  }
  const status = new Map<string, ProviderGame['status']>()
  for (const g of statesEntry.body as ProviderGameState[]) status.set(g.gameId, g.status)
  const weekGames = (scheduleEntry.body as ProviderGame[])
    .filter((g) => g.week === week)
    .map((g) => ({ gameId: g.gameId, homeTeam: g.homeTeam, awayTeam: g.awayTeam }))
  const finalBy = new Map<string, string>()
  const stateEntries = snap.recording.entries
    .filter((e) => e.method === 'getGameStates' && sameArgs(e.args, [season, week]) && e.ok)
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
  for (const e of stateEntries) {
    for (const g of e.body as ProviderGameState[]) {
      if (g.status === 'final' && !finalBy.has(g.gameId)) finalBy.set(g.gameId, e.t)
    }
  }
  return { label: snap.label, t: statsEntry.t, stats, status, weekGames, finalBy, lines: snap.lines?.lines ?? {} }
}

const IN_WEEK: ReadonlySet<string> = new Set(['scheduled', 'live', 'final'])

function rowsOf(snap: ReadSnapshot, provider: string): Map<string, { row: StatRow; line: ProviderPlayerWeekStats }> {
  const inWeek = [...snap.status.values()].filter((s) => IN_WEEK.has(s))
  const anyGameOpen = inWeek.some((s) => s !== 'final')
  const out = new Map<string, { row: StatRow; line: ProviderPlayerWeekStats }>()
  for (const line of snap.stats) {
    const { row } = toStatRow(line, { providerName: provider, gameStatus: snap.status, anyGameOpen })
    if (row !== null) out.set(line.playerId, { row, line })
  }
  return out
}

const DEF_BY_KEY = new Map(STAT_KEYS.map((d) => [d.key, d]))

function minutes(fromIso: string, toIso: string): number {
  return Math.round(((Date.parse(toIso) - Date.parse(fromIso)) / 60_000) * 10) / 10
}

// ── The diff ───────────────────────────────────────────────────────────────

export function diffSnapshots(first: Snapshot, second: Snapshot, opts: DiffOptions = {}): SnapshotDiff {
  const h1 = first.recording.header
  const h2 = second.recording.header
  if (h1.provider !== h2.provider || h1.season !== h2.season || h1.week !== h2.week) {
    throw new Error(
      `the two snapshots are not of one week: "${first.label}" is ${h1.provider} ${h1.season} wk${h1.week}, "${second.label}" is ${h2.provider} ${h2.season} wk${h2.week}`,
    )
  }
  const s1 = readSnapshot(first)
  const s2 = readSnapshot(second)
  if (Date.parse(s2.t) <= Date.parse(s1.t)) {
    throw new Error(`snapshot "${second.label}" (${s2.t}) is not later than "${first.label}" (${s1.t})`)
  }
  const graceMs = opts.graceMs ?? SETTLE_GRACE_MS
  const notes: string[] = []

  const inWeekFirst = [...s1.status.values()].filter((s) => IN_WEEK.has(s))
  const weekFinalAtFirst = inWeekFirst.length > 0 && inWeekFirst.every((s) => s === 'final')
  const gamesAtFirst = {
    final: inWeekFirst.filter((s) => s === 'final').length,
    open: inWeekFirst.filter((s) => s !== 'final').length,
    postponed: [...s1.status.values()].filter((s) => s === 'postponed').length,
  }

  const finalSeenByGame = new Map<string, string | null>()
  if (opts.finalSeen) {
    for (const g of s1.weekGames) {
      const hit = opts.finalSeen.filter((f) => f.week === h1.week && f.homeTeam === g.homeTeam && f.awayTeam === g.awayTeam)
      if (hit.length === 1) finalSeenByGame.set(g.gameId, hit[0].status === 'final' ? hit[0].firstSeenFinalAt : null)
      else notes.push(`production final-seen: ${hit.length} rows match ${g.awayTeam}@${g.homeTeam} — its instant is unknown`)
    }
  }

  function finalSeenFor(gameId: string | null): { at: string | null; source: SnapshotChange['finalSeenSource'] } {
    const games = gameId !== null ? [gameId] : s1.weekGames.filter((g) => IN_WEEK.has(s1.status.get(g.gameId) ?? '')).map((g) => g.gameId)
    if (games.length === 0) return { at: null, source: null }
    const pick = (source: 'production' | 'recorder', read: (id: string) => string | null | undefined) => {
      let latest: string | null = null
      for (const id of games) {
        const at = read(id)
        if (at === null || at === undefined) return null
        if (latest === null || Date.parse(at) > Date.parse(latest)) latest = at
      }
      return latest === null ? null : { at: latest, source }
    }
    return (
      (opts.finalSeen ? pick('production', (id) => finalSeenByGame.get(id)) : null) ??
      pick('recorder', (id) => s1.finalBy.get(id)) ?? { at: null, source: null }
    )
  }

  function gameFor(playerId: string, line: ProviderPlayerWeekStats | undefined, team: string | null): { gameId: string | null; by: SnapshotChange['gameBy']; note: string | null } {
    if (line?.gameId) return { gameId: line.gameId, by: 'line', note: null }
    if (team === null) return { gameId: null, by: 'week', note: 'no team for the player in either sidecar — the whole week stands in' }
    const hits = s1.weekGames.filter((g) => g.homeTeam === team || g.awayTeam === team)
    if (hits.length === 1) return { gameId: hits[0].gameId, by: 'team', note: null }
    return { gameId: null, by: 'week', note: `team ${team} is in ${hits.length} of the week's games — the whole week stands in` }
  }

  const rows1 = rowsOf(s1, h1.provider)
  const rows2 = rowsOf(s2, h2.provider)
  const changes: SnapshotChange[] = []
  const notFinal: SnapshotChange[] = []
  let unchanged = 0
  let added = 0
  let both = 0
  const events = opts.events ?? null
  const usedEvents = new Set<ProductionEvent>()

  for (const [playerId, cur] of rows2) {
    const prior = rows1.get(playerId)
    if (prior) both += 1
    else added += 1
    const moved = movedStatKeys(prior?.row, cur.row)
    if (moved.length === 0) {
      unchanged += 1
      continue
    }
    const meta2 = s2.lines[playerId]
    const meta1 = s1.lines[playerId]
    const team = meta2?.team ?? meta1?.team ?? null
    const game = gameFor(playerId, cur.line.gameId ? cur.line : prior?.line, team)
    const finalAtFirst = game.gameId !== null ? s1.status.get(game.gameId) === 'final' : weekFinalAtFirst
    const seen = finalSeenFor(game.gameId)

    // The change happened after snapshot 1 read the old value and no later
    // than snapshot 2 — or Sleeper's stamp of the line's last modification,
    // when that falls between the two (a later stamp says nothing more).
    let changedBy = s2.t
    let changedBySource: SnapshotChange['changedBySource'] = 'snapshot'
    const lineNotes: string[] = []
    if (game.note) lineNotes.push(game.note)
    const stamp = meta2?.lastModified ?? null
    if (stamp !== null) {
      if (Date.parse(stamp) > Date.parse(s1.t) && Date.parse(stamp) < Date.parse(s2.t)) {
        changedBy = stamp
        changedBySource = 'sleeper_last_modified'
      } else if (Date.parse(stamp) <= Date.parse(s1.t)) {
        lineNotes.push(`Sleeper's last-modified stamp (${stamp}) is not after snapshot 1 — the snapshot bounds are used`)
      }
    }
    let min: number | null = null
    let max: number | null = null
    if (seen.at !== null) {
      min = minutes(seen.at, s1.t)
      if (seen.source === 'production') max = minutes(seen.at, changedBy)
    }
    const graceMin = graceMs / 60_000
    const grace: GraceVerdict =
      min !== null && min >= graceMin ? 'outside' : max !== null && max < graceMin ? 'inside' : 'undetermined'

    for (const key of moved) {
      const def = DEF_BY_KEY.get(key.stat_key)
      let productionEvent: ProductionEvent | null = null
      if (events) {
        productionEvent =
          events.find((e) => !usedEvents.has(e) && e.playerId === playerId && e.statKey === key.stat_key && e.newValue === key.new) ?? null
        if (productionEvent) usedEvents.add(productionEvent)
      }
      const change: SnapshotChange = {
        playerId,
        name: meta2?.name ?? meta1?.name ?? null,
        position: meta2?.position ?? meta1?.position ?? null,
        team,
        gameId: game.gameId,
        gameBy: game.by,
        statKey: key.stat_key,
        label: def?.label ?? key.stat_key,
        surface: def?.scoring_surface ?? 'unknown',
        old: key.old,
        new: key.new,
        line: prior ? 'updated' : 'added',
        finalAtFirst,
        finalSeenAt: seen.at,
        finalSeenSource: seen.source,
        changedAfter: s1.t,
        changedBy,
        changedBySource,
        minutesAfterFinal: { min, max },
        grace,
        productionEvent,
        notes: lineNotes,
      }
      ;(finalAtFirst ? changes : notFinal).push(change)
    }
  }

  const vanished: VanishedLine[] = []
  for (const playerId of rows1.keys()) {
    if (rows2.has(playerId)) continue
    const meta = s1.lines[playerId]
    vanished.push({ playerId, name: meta?.name ?? null, team: meta?.team ?? null })
  }

  const order = new Map(STAT_KEYS.map((d, i) => [d.key, i]))
  const sortChanges = (a: SnapshotChange, b: SnapshotChange) =>
    (a.gameId ?? '~').localeCompare(b.gameId ?? '~') ||
    a.playerId.localeCompare(b.playerId) ||
    (order.get(a.statKey) ?? 999) - (order.get(b.statKey) ?? 999)
  changes.sort(sortChanges)
  notFinal.sort(sortChanges)
  vanished.sort((a, b) => a.playerId.localeCompare(b.playerId))

  const productionOnly = events ? events.filter((e) => !usedEvents.has(e)) : []
  if (!first.lines || !second.lines) notes.push('a line sidecar is missing — players are named by id, games by the week, and the change window by the snapshots alone')

  return {
    provider: h1.provider,
    season: h1.season,
    week: h1.week,
    first: { label: s1.label, t: s1.t },
    second: { label: s2.label, t: s2.t },
    gamesAtFirst,
    weekFinalAtFirst,
    lines: { first: rows1.size, second: rows2.size, both, added, vanished: vanished.length, unchanged },
    changes,
    notFinal,
    vanished,
    productionOnly,
    eventsCompared: events !== null,
    graceMs,
    notes,
  }
}

// ── F528's settle profile (one snapshot's stamps vs production's finals) ────

export interface SettleProfile {
  /** Lines with both a Sleeper stamp and a production first-seen-final. */
  measured: number
  unmeasured: number
  buckets: { label: string; count: number }[]
}

const SETTLE_BUCKETS: { label: string; upToMin: number }[] = [
  { label: 'before the game was seen final', upToMin: 0 },
  { label: '0–60 min after', upToMin: 60 },
  { label: '1–6 h after (inside the grace)', upToMin: 360 },
  { label: '6–24 h after', upToMin: 1440 },
  { label: '1–3 days after', upToMin: 4320 },
  { label: 'more than 3 days after', upToMin: Number.POSITIVE_INFINITY },
]

/**
 * For each line of `snap` whose game production saw final: the minutes from
 * that first observation to Sleeper's last-modified stamp of the line. The
 * stamp moves for ANY field (the rank fields too), so a line in a late bucket
 * is not evidence of a late stat change — only a line in an early bucket is
 * evidence that nothing on it moved later (F528).
 */
export function settleProfile(snap: Snapshot, finalSeen: readonly FinalSeenGame[]): SettleProfile {
  const s = readSnapshot(snap)
  const { week } = snap.recording.header
  const counts = SETTLE_BUCKETS.map(() => 0)
  let measured = 0
  let unmeasured = 0
  for (const line of s.stats) {
    const meta = s.lines[line.playerId]
    const team = meta?.team ?? null
    const game = team === null ? [] : s.weekGames.filter((g) => g.homeTeam === team || g.awayTeam === team)
    const seen = game.length === 1 ? finalSeen.filter((f) => f.week === week && f.homeTeam === game[0].homeTeam && f.awayTeam === game[0].awayTeam) : []
    const at = seen.length === 1 && seen[0].status === 'final' ? seen[0].firstSeenFinalAt : null
    if (!meta?.lastModified || at === null) {
      unmeasured += 1
      continue
    }
    measured += 1
    const m = minutes(at, meta.lastModified)
    const i = m < 0 ? 0 : SETTLE_BUCKETS.findIndex((b, idx) => idx > 0 && m < b.upToMin)
    counts[i] += 1
  }
  return { measured, unmeasured, buckets: SETTLE_BUCKETS.map((b, i) => ({ label: b.label, count: counts[i] })) }
}

// ── Rendering (the words the orchestrator and PROGRESS read) ───────────────

/** A NULL old / new value: no line yet (an added line) or a pending column. */
function value(v: number | null): string {
  return v === null ? '(none)' : String(v)
}

function renderChange(c: SnapshotChange, i: number): string[] {
  const who = `${c.name ?? `player ${c.playerId}`} (${[c.position, c.team].filter(Boolean).join(', ') || 'position/team unknown'}; id ${c.playerId})`
  const game = c.gameId !== null ? `game ${c.gameId} (by ${c.gameBy})` : 'game unknown — the week stands in'
  const out = [`  ${i + 1}. ${who} — ${c.statKey} "${c.label}" ${value(c.old)} → ${value(c.new)} [${c.surface}] — ${game} — line ${c.line}`]
  const seen = c.finalSeenAt === null ? 'first-seen-final unknown' : `${c.finalSeenSource === 'production' ? 'first seen final' : 'recorded final by'} ${c.finalSeenAt} (${c.finalSeenSource})`
  const { min, max } = c.minutesAfterFinal
  const span = min === null && max === null ? 'minutes unknown' : max === null ? `≥ ${min} min after final` : `${min}–${max} min after final`
  out.push(`     ${seen}; changed after ${c.changedAfter}, by ${c.changedBy} (${c.changedBySource === 'sleeper_last_modified' ? "Sleeper's stamp" : 'snapshot 2'}) → ${span} — settle grace: ${c.grace}`)
  if (c.productionEvent) out.push(`     production recorded it: detected ${c.productionEvent.detectedAt}, ${value(c.productionEvent.oldValue)} → ${value(c.productionEvent.newValue)}, week_state ${c.productionEvent.weekState}`)
  for (const n of c.notes) out.push(`     note: ${n}`)
  return out
}

export function renderSnapshotDiff(d: SnapshotDiff): string[] {
  const out: string[] = []
  out.push(`${d.season} week ${d.week} — ${d.provider}: snapshot "${d.first.label}" (${d.first.t}) → "${d.second.label}" (${d.second.t})`)
  out.push(
    `games at "${d.first.label}": ${d.gamesAtFirst.final} final, ${d.gamesAtFirst.open} not final, ${d.gamesAtFirst.postponed} postponed — ${d.weekFinalAtFirst ? 'the week was final' : 'the week was NOT final (changes on its open games are in-game, not corrections)'}`,
  )
  out.push(
    `lines: ${d.lines.first} at "${d.first.label}", ${d.lines.second} at "${d.second.label}" — ${d.lines.both} in both, ${d.lines.added} added, ${d.lines.vanished} vanished, ${d.lines.unchanged} unchanged`,
  )
  const scorable = d.changes.filter((c) => c.surface === 'scorable').length
  if (d.changes.length === 0) {
    out.push(`FINAL-GAME CHANGES: none — no line of a game final at "${d.first.label}" moved by "${d.second.label}". Nothing to capture this week (never fabricated).`)
  } else {
    out.push(`FINAL-GAME CHANGES: ${d.changes.length} (${scorable} on a scorable key) — each a stat correction under TD2 unless its grace verdict says "inside":`)
    d.changes.forEach((c, i) => out.push(...renderChange(c, i)))
  }
  if (d.notFinal.length > 0) {
    out.push(`IN-GAME CHANGES (game not final at "${d.first.label}" — not corrections): ${d.notFinal.length}`)
    d.notFinal.forEach((c, i) => out.push(...renderChange(c, i)))
  }
  if (d.vanished.length > 0) {
    out.push(`VANISHED LINES (in "${d.first.label}", not in "${d.second.label}" — the ingest keeps a stored line): ${d.vanished.length}`)
    for (const v of d.vanished) out.push(`  - ${v.name ?? `player ${v.playerId}`} (${v.team ?? 'team unknown'}; id ${v.playerId})`)
  }
  if (d.eventsCompared) {
    const matched = d.changes.filter((c) => c.productionEvent !== null).length + d.notFinal.filter((c) => c.productionEvent !== null).length
    out.push(`production events: ${matched} match a change above; ${d.productionOnly.length} production-only`)
    for (const e of d.productionOnly) {
      out.push(`  - production-only: player ${e.playerId} ${e.statKey} ${value(e.oldValue)} → ${value(e.newValue)}, detected ${e.detectedAt} (${e.weekState}) — outside the two snapshots' window, or not in the recorded lines`)
    }
  }
  for (const n of d.notes) out.push(`note: ${n}`)
  return out
}

export function renderSettleProfile(p: SettleProfile, label: string): string[] {
  const out = [`settle profile of "${label}" (F528 — Sleeper's last-modified stamp vs production's first-seen-final; the stamp moves for any field, so it bounds a line's last stat change from ABOVE): ${p.measured} lines measured, ${p.unmeasured} not measurable`]
  for (const b of p.buckets) out.push(`  ${b.label}: ${b.count}`)
  return out
}
