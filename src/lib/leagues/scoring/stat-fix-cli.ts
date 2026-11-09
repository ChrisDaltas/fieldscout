/**
 * stat-fix-cli — `npm run stat-fix` (migration 222; PROGRESS D838). The
 * operator's side of OUR OWN stat fixes: the score-week pass applies a
 * written fix by itself; this records one the fill did not (an engine fix, a
 * backlog), previews what one would move, and says what is owed.
 *
 *   npm run stat-fix -- plan --file <lines.json> [--landed-at <iso>]
 *     READ-ONLY. Per league, week and player: stored → new and the delta,
 *     through the door's own dry run (rolled back). Nothing is recorded. With
 *     --landed-at, a week last scored after it is named not eligible, as the
 *     door will name it.
 *   npm run stat-fix -- record --file <lines.json> --reason "<plain words>" --landed-at <iso>
 *     prints what it would record; with --apply --confirm-target <host> it
 *     records the fix and marks it written — the pass then applies it.
 *   npm run stat-fix -- status
 *     every written fix: applied / owed / not eligible (each named).
 *
 * --landed-at is REQUIRED to record, never assumed: when OUR change reached
 * the stats (a fill: the run's instant) or the engine (a deploy: the instant
 * the new code answered every request). A week whose scores were last
 * computed after it — 216's close stamp, else its finalization — was scored
 * with the change and is not paid again (`week_scored_after_fix`); "now"
 * would make every week finalized in between owed, and pay it twice. A
 * landing in the future is refused.
 *
 * The file: {"season": 2026, "lines": [{"week": 1, "player_id": "…",
 * "stat_key": "fg_0_39", "before": 0, "after": 2}]} — `stat_key` a
 * `player_stats` column, `before` the stored value our change replaced (0 for
 * a line that had no row), `after` the value OUR change wrote — never simply
 * today's value, which may carry a provider's later correction (that would
 * then be paid: PROGRESS D838 says how to read it). An engine fix is written
 * the same way: the value the old engine scored (a kicker's `rush_yards`
 * before 0) → the value it now reads, as the week was locked. A move a
 * WRITTEN fix already holds — the same week, player and stat from the same
 * before value — is refused by the database by name (`already_recorded`), so
 * a re-run never pays it twice.
 *
 * ⚠ TARGET. Like every sync script the wrapper loads `.env.local`, which names
 * the HOSTED project. The first line printed is `target: <host>`; `--apply`
 * exits 2 having written nothing until `--confirm-target` names that host.
 *
 * Exit 2: bad arguments or target. Exit 1: a refusal, a problem or a failed
 * call. Never a quiet success.
 */
import { z } from 'zod'

import type { Json } from '@/types/database'

import { pageAll } from '@/lib/supabase/page-all'
import { isMissingSchemaObject } from '@/lib/supabase/postgrest-errors'
import { confirmTarget } from '@/lib/sync/reingest-weeks'

import type { TimeProvider } from '../time/time-provider'
import type { ScoreWorkerClient } from './score-week-worker'
import { fixLeagueWeek, PRE_222_SENTENCE, STAT_FIX_TARGETS, type StatFixLine, type WeekFixOutcome } from './stat-fix-rescore'

const USAGE = [
  'usage: npm run stat-fix -- plan --file <lines.json> [--landed-at <iso>]',
  '       npm run stat-fix -- record --file <lines.json> --reason "<plain words>" --landed-at <iso> [--apply --confirm-target <host>]',
  '       npm run stat-fix -- status',
].join('\n')

const COMMANDS = ['plan', 'record', 'status'] as const
type Command = (typeof COMMANDS)[number]
const VALUE_FLAGS: ReadonlySet<string> = new Set(['--file', '--reason', '--landed-at', '--confirm-target'])
const FLAGS_BY_COMMAND: Record<Command, ReadonlySet<string>> = {
  plan: new Set(['--file', '--landed-at']),
  record: new Set(['--file', '--reason', '--landed-at', '--apply', '--confirm-target']),
  status: new Set([]),
}

export interface StatFixArgs {
  command: Command
  file?: string
  reason?: string
  landedAt?: string
  apply: boolean
  confirmTarget?: string
}

/** Throws, naming the argument, on anything this tool doesn't take: a stale or mistyped flag never runs. */
export function parseStatFixArgs(argv: readonly string[]): StatFixArgs {
  const [command, ...rest] = argv
  if (!COMMANDS.includes(command as Command)) throw new Error(`unknown command ${command ?? '(none)'} — nothing read or written.\n${USAGE}`)
  const cmd = command as Command
  const values = new Map<string, string>()
  let apply = false
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (!FLAGS_BY_COMMAND[cmd].has(token)) throw new Error(`${cmd} does not take ${token} — nothing read or written.\n${USAGE}`)
    if (token === '--apply') {
      apply = true
    } else if (VALUE_FLAGS.has(token)) {
      const value = rest[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${token} needs a value.\n${USAGE}`)
      if (values.has(token)) throw new Error(`${token} was given twice.\n${USAGE}`)
      values.set(token, value)
      i += 1
    }
  }
  const args: StatFixArgs = {
    command: cmd,
    file: values.get('--file'),
    reason: values.get('--reason'),
    landedAt: values.get('--landed-at'),
    apply,
    confirmTarget: values.get('--confirm-target'),
  }
  if ((cmd === 'plan' || cmd === 'record') && args.file === undefined) throw new Error(`${cmd} needs --file.\n${USAGE}`)
  if (cmd === 'record' && (args.reason === undefined || args.reason.trim() === '')) throw new Error(`record needs --reason (plain words: what we fixed and why).\n${USAGE}`)
  if (cmd === 'record' && args.landedAt === undefined) {
    throw new Error(
      `record needs --landed-at <iso>: when our change reached the stats (the fill run’s instant) or the engine (the deploy, once the new code answered every request) — a week last scored after it is not paid again, so it is never assumed.\n${USAGE}`,
    )
  }
  if (args.landedAt !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(args.landedAt)) {
    throw new Error(`--landed-at must be an ISO instant with its zone (got ${args.landedAt}).\n${USAGE}`)
  }
  return args
}

const fileSchema = z.object({
  season: z.number().int().min(2000).max(2100),
  lines: z
    .array(
      z.object({
        week: z.number().int().min(1).max(22),
        player_id: z.string().trim().min(1),
        stat_key: z.string().trim().min(1),
        before: z.number().finite(),
        after: z.number().finite(),
      }),
    )
    .min(1),
})

export interface StatFixFile {
  season: number
  lines: StatFixLine[]
}

/** The lines file, checked: every line a real move, no (week, player, key) twice. */
export function parseStatFixFile(text: string): StatFixFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new Error(`the lines file is not JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  const parsed = fileSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`the lines file is not {season, lines: [{week, player_id, stat_key, before, after}]}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  const seen = new Set<string>()
  for (const line of parsed.data.lines) {
    const key = `${line.week}|${line.player_id}|${line.stat_key}`
    if (seen.has(key)) throw new Error(`week ${line.week} player ${line.player_id} ${line.stat_key} appears twice in the lines file`)
    seen.add(key)
    if (line.before === line.after) throw new Error(`week ${line.week} player ${line.player_id} ${line.stat_key} does not move (${line.before} → ${line.after}) — a fix names only what it changed`)
  }
  return parsed.data
}

export interface StatFixCliIo {
  supabaseUrl: string | undefined
  /** Called only once the arguments and the target have passed. */
  connect: () => { db: ScoreWorkerClient; time: TimeProvider }
  readFile: (path: string) => string
  log: (line: string) => void
  error: (line: string) => void
}

const two = (n: number | null | undefined): string => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(2))
const signed = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(2)}`

/** The door's eligibility refusals: named, not problems — the league-week is just not one a fix reaches. */
const NOT_ELIGIBLE = /\b(league_not_in_season|bracket_built|week_not_final|week_not_scheduled|week_scored_after_fix|fix_other_season)\b/

/** One league-week of a plan, in lines (ids and player names; the league by name). */
export function renderWeekFix(outcome: WeekFixOutcome, names: ReadonlyMap<string, string>): string[] {
  const { plan } = outcome
  const head = `league ${plan.league_name} (${plan.league_id}) week ${plan.week}`
  if (outcome.verdict === 'ineligible') return [`${head}: not eligible — ${outcome.refusal}`]
  if (outcome.verdict === 'refused') {
    return NOT_ELIGIBLE.test(outcome.refusal ?? '') ? [`${head}: not eligible — ${outcome.refusal}`] : [`${head}: REFUSED — ${outcome.refusal}`]
  }
  if (outcome.verdict === 'already_applied') return [`${head}: already applied (receipt ${outcome.doc?.receipt_id ?? '?'})`]
  const doc = outcome.doc
  const lines = [`${head}: ${outcome.verdict} — ${doc?.players_changed ?? 0} player row(s), ${doc?.scores_changed ?? 0} team score(s), ${doc?.results_changed?.length ?? 0} result(s) move`]
  for (const team of plan.teams) {
    for (const row of team.changed) {
      const who = names.get(row.player_id)
      lines.push(`  team ${team.team_id} ${row.slot} ${who ? `${who} (${row.player_id})` : row.player_id}: ${two(row.stored)} → ${two(row.points)} (${signed(row.delta)})${team.writable ? '' : ' — the commissioner-set score is kept; the player\'s row moves'}`)
    }
    if (team.writable && team.changed.length > 0) lines.push(`  team ${team.team_id} score: ${team.cells.map(two).join('/')} → ${two(team.points)}`)
  }
  for (const p of outcome.problems) lines.push(`  PROBLEM: ${p}`)
  return lines
}

async function namesOf(db: ScoreWorkerClient, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const { data, error } = await db.from('players').select('id, full_name').in('id', [...ids])
  if (error) throw new Error(`players read: ${error.message}`)
  for (const p of data ?? []) if (p.full_name) out.set(p.id, p.full_name)
  return out
}

/** Every league of the season holding one of the file's weeks (archived ones are named, never planned). */
async function leagueWeeksOf(db: ScoreWorkerClient, season: number, weeks: readonly number[]): Promise<Array<{ league_id: string; week: number }>> {
  const rows = await pageAll<{ id: string; league_id: string; week: number }>((from, to) =>
    db.from('league_weeks').select('id, league_id, week', { count: 'exact' }).eq('season', season).in('week', [...weeks]).order('id').range(from, to),
  )
  return rows.map((r) => ({ league_id: r.league_id, week: r.week })).sort((a, b) => (a.league_id < b.league_id ? -1 : a.league_id > b.league_id ? 1 : a.week - b.week))
}

/** The whole CLI as a function: returns the exit code. */
export async function runStatFixCli(argv: readonly string[], io: StatFixCliIo): Promise<number> {
  let args: StatFixArgs
  let file: StatFixFile | null = null
  try {
    args = parseStatFixArgs(argv)
    if (args.file !== undefined) file = parseStatFixFile(io.readFile(args.file))
  } catch (err) {
    io.error((err as Error).message)
    return 2
  }
  const url = io.supabaseUrl ?? ''
  let host: string
  try {
    host = new URL(url).host
  } catch {
    io.error(`NEXT_PUBLIC_SUPABASE_URL is not a URL: "${url}"`)
    return 2
  }
  io.log(`target: ${host}`)
  if (args.apply || args.confirmTarget !== undefined) {
    try {
      confirmTarget(url, args.confirmTarget)
    } catch (err) {
      io.error((err as Error).message)
      return 2
    }
  }

  if (args.command === 'record' && !args.apply) {
    const weeks = [...new Set(file!.lines.map((l) => l.week))].sort((a, b) => a - b)
    io.log(`would record a stat fix: season ${file!.season}, ${file!.lines.length} line(s) over week(s) ${weeks.join(', ')}, landed ${args.landedAt} — "${args.reason!.trim()}"`)
    for (const l of file!.lines) io.log(`  week ${l.week} ${l.player_id} ${l.stat_key}: ${l.before} → ${l.after}`)
    io.log(`Nothing recorded. To record it (the score-week pass then applies it): npm run stat-fix -- record --file ${args.file} --reason "${args.reason!.trim()}" --landed-at ${args.landedAt} --apply --confirm-target ${host}`)
    return 0
  }

  const { db, time } = io.connect()
  // A landing in the future would make every week finalized until then owed (and pay those already scored with it).
  if (args.landedAt !== undefined && Date.parse(args.landedAt) > time.now().getTime()) {
    io.error(`--landed-at ${args.landedAt} is after now (${time.now().toISOString()}): our change can’t have landed yet — nothing read or written`)
    return 2
  }
  try {
    if (args.command === 'plan') return await runPlan(db, file!, args.landedAt, io)
    if (args.command === 'record') return await runRecord(db, file!, args, io)
    return await runStatus(db, io)
  } catch (err) {
    io.error(`FAILED — ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function runPlan(db: ScoreWorkerClient, file: StatFixFile, landedAt: string | undefined, io: StatFixCliIo): Promise<number> {
  const weeks = [...new Set(file.lines.map((l) => l.week))].sort((a, b) => a - b)
  io.log(
    `Plan [${file.season}] weeks ${weeks.join(', ')}: ${file.lines.length} line(s)${landedAt ? `, landed ${landedAt}` : ' (no --landed-at: a week scored after the fix lands is not told apart)'} — read-only, every league-week through the door's dry run (rolled back)`,
  )
  const names = await namesOf(db, [...new Set(file.lines.map((l) => l.player_id))])
  let problems = 0
  let moving = 0
  for (const lw of await leagueWeeksOf(db, file.season, weeks)) {
    const outcome = await fixLeagueWeek(db, { fixId: null, leagueId: lw.league_id, week: lw.week, lines: file.lines, landedAt }, false)
    for (const line of renderWeekFix(outcome, names)) io.log(line)
    if (outcome.verdict === 'would_apply') moving += 1
    const notEligible = outcome.verdict === 'refused' && NOT_ELIGIBLE.test(outcome.refusal ?? '')
    if (!notEligible && (outcome.verdict === 'refused' || outcome.problems.length > 0)) problems += 1
  }
  io.log(`league-weeks that would move: ${moving}; with a problem: ${problems}`)
  if (problems > 0) {
    io.error('PROBLEMS above — a fix recorded now would stay owed in those league-weeks until they are explained')
    return 1
  }
  io.log('Plan only — nothing written or recorded.')
  return 0
}

async function runRecord(db: ScoreWorkerClient, file: StatFixFile, args: StatFixArgs, io: StatFixCliIo): Promise<number> {
  const landedAt = args.landedAt!
  const recorded = await db.rpc('record_stat_fix', {
    p_season: file.season,
    p_reason: args.reason!.trim(),
    p_lines: file.lines as unknown as Json,
    p_landed_at: landedAt,
  })
  if (recorded.error) {
    io.error(isMissingSchemaObject(recorded.error, ['record_stat_fix']) ? `REFUSED — ${PRE_222_SENTENCE}` : `REFUSED — record_stat_fix: ${recorded.error.message}`)
    return 1
  }
  const fixId = recorded.data as string
  const written = await db.rpc('mark_stat_fix_written', { p_fix_id: fixId })
  let lost = ''
  if (written.error) {
    // An error is not "not written": the mark may have committed and only its
    // reply been lost. Read it back — never guess either way (a wrong "NOT
    // written" invites a second record; the database refuses that one anyway).
    const back = await db.from('stat_fixes').select('written_at').eq('id', fixId).maybeSingle()
    if (back.error || back.data === null) {
      io.error(
        `FAILED — fix ${fixId} is recorded; whether it is written is NOT known (mark_stat_fix_written: ${written.error.message}; read-back: ${back.error?.message ?? 'no such fix'}). ` +
          'Run npm run stat-fix -- status before anything else: written, it is done; not written, re-run this record (a re-run is refused while a written fix holds these moves).',
      )
      return 1
    }
    if (back.data.written_at === null) {
      io.error(`FAILED — fix ${fixId} is recorded but NOT written (read back): nothing applies from it (mark_stat_fix_written: ${written.error.message}). Re-run this record: a fix never written applies nowhere, so nothing is paid twice.`)
      return 1
    }
    lost = ` (mark_stat_fix_written’s reply was lost — read back: written ${back.data.written_at})`
  }
  io.log(`recorded and written: stat fix ${fixId} — season ${file.season}, ${file.lines.length} line(s), landed ${landedAt}${lost}`)
  io.log('The score-week pass applies it to every eligible final league-week within minutes, quietly. `npm run stat-fix -- status` shows where it stands.')
  return 0
}

async function runStatus(db: ScoreWorkerClient, io: StatFixCliIo): Promise<number> {
  // Every (written fix, league, week) — fixes × weeks × leagues, growing all
  // season — PAGED past PostgREST's 1000-row cap with an exact count (round 5:
  // one call was cut at row 1000, and the function lists the NEWEST fix last,
  // so the fix being checked read "owed 0"). Ordered on the row's own key.
  const page = (from: number, to: number) =>
    db.rpc(STAT_FIX_TARGETS, { p_owed_only: false, p_limit: 1 }, { count: 'exact' }).order('fix_id').order('league_id').order('week').range(from, to)
  const probe = await page(0, 0)
  if (probe.error) {
    io.error(isMissingSchemaObject(probe.error, [STAT_FIX_TARGETS]) ? `REFUSED — ${PRE_222_SENTENCE}` : `FAILED — ${STAT_FIX_TARGETS}: ${probe.error.message}`)
    return 1
  }
  const rows = await pageAll(page)
  const fixes = await pageAll<{ id: string; season: number; reason: string; landed_at: string; created_at: string; written_at: string | null }>((from, to) =>
    db.from('stat_fixes').select('id, season, reason, landed_at, created_at, written_at', { count: 'exact' }).order('created_at').order('id').range(from, to),
  )
  if (fixes.length === 0) io.log('no stat fix has been recorded')
  for (const fix of fixes) {
    const mine = rows.filter((r) => r.fix_id === fix.id)
    const count = (state: string) => mine.filter((r) => r.state === state).length
    const notEligible = mine.filter((r) => r.state !== 'applied' && r.state !== 'owed')
    io.log(
      `fix ${fix.id} season ${fix.season} landed ${fix.landed_at} ${fix.written_at ? `written ${fix.written_at}` : 'NOT WRITTEN (nothing applies from it)'} — "${fix.reason}": applied ${count('applied')}, owed ${count('owed')}, not eligible ${notEligible.length}`,
    )
    for (const r of notEligible) io.log(`  league ${r.league_id} week ${r.week}: ${r.state}`)
  }
  return 0
}
