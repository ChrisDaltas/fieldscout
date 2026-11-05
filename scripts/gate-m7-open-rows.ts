/**
 * gate-m7-open-rows.ts — the pure half of the M7 gate's verdict (L.F2.12;
 * tasks-M7 §6 / §9; TD6 = PROGRESS D575). No database, no network, no clock:
 * text in, findings out. `scripts/gate-m7-evidence.ts` is the thin CLI over
 * it; `gate-m7-open-rows.test.ts` pins it on stored literals.
 *
 * THREE JOBS.
 *
 * 1. THE LEDGER. PROGRESS §6 is a hand-kept table of ~640 rows, and its shape
 *    is not regular: some cells hold `|` (`Final | Projected`, SQL's `||`), a
 *    few rows have 4 / 7 / 8 cells, and the status words vary (`⬜ Open`,
 *    `Open`, `🟡 Partly`, `~~⬜ Open~~ **✅ Discharged…`, `✅ Partly
 *    discharged`). So a row's status is read in three outcomes, never two:
 *    `open`, `closed`, `unclassified`. An unclassified row is listed by name;
 *    it is neither clean nor open-by-assumption, and if it carries S0 / S1 it
 *    fails the gate anyway.
 *
 * 2. SEVERITY (TD6: S0 = a wrong score / standing / result, data loss, or a
 *    permission breach; S1 = a live draft or scoring weekend cannot complete
 *    without operator help; everything else S2+). Read ONLY from these marks,
 *    so a stray "S2" in the text (F262 names a team "S2") is never a rating:
 *      - the obligation cell opens `**[S0 — …]**` / `**[S2] …`;
 *      - the status cell opens `⬜ Open — S0`;
 *      - `Rated S3` anywhere in the status cell (L.F2.7's form);
 *      - `[Severity S3 …` anywhere in the status cell (L.F2.12's form — TD6's
 *        "severity column" is carried as this tag, D792(2), because the rows
 *        do not share one column layout).
 *    Several marks on one row: the most severe wins. Lowering a row means
 *    editing its marks, never adding a milder one.
 *    FAIL-CLOSED (R1760): any S0 / S1 in the obligation or the status of an
 *    open row, in a spelling these marks do not read, FAILS the gate by name
 *    rather than reading as unrated. Struck text doesn't count; a row that only
 *    quotes the words is allowlisted by id with its reason.
 *
 * 3. THE ATTACHMENTS. Exit criteria 1, 2 and 4 are not scripts. Each needs a
 *    file that says, on a line of its own, `M7-GATE-ATTACHMENT: <key> PASS`.
 *    An absent file, an empty file, a file with no such line, and a line
 *    saying anything but PASS are four different ways of NOT having it — and
 *    the banner names which. A mention inside a sentence, a code fence or an
 *    HTML comment does not count, so the docs can describe the line without
 *    satisfying it. C4 also needs its dated ruling on the line beside it (R1765).
 *
 * 4. THE STAMPS (R1761). The shell script writes `git rev-parse HEAD` to
 *    `.gate-m7/stage-N.done` as each automated stage finishes, and the verdict
 *    refuses without all of them for HEAD. Accident prevention, not
 *    forgery-proofing: it stops `verdict` run by hand reading as a pass.
 *
 * THE VERDICT. Exit 0 ONLY when every automated leg ran green AND all three
 * attachments say PASS AND no S0 / S1 row is open AND F861 is closed AND F273,
 * F859, F860 are rated or closed (R1759). CLAUDE.md: never let "nothing
 * happened" mean it worked.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Exit codes — the gate's whole vocabulary (`scripts/gate-m7.sh` header).
// ---------------------------------------------------------------------------
export const EXIT_PASSED = 0
/** A test leg failed (`set -e` carries the stage's own code; this is the same class). */
export const EXIT_LEG_FAILED = 1
/** The ledger could not be read, or the CLI was misused. Nothing is claimed. */
export const EXIT_UNREADABLE = 2
/** Every automated leg green; an attachment is missing or a rating is owed. Not a test failure. */
export const EXIT_EVIDENCE_MISSING = 3
/** An S0 / S1 row is open. Outranks a missing attachment. */
export const EXIT_OPEN_S0_S1 = 4

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------
export type RowStatus = 'open' | 'closed' | 'unclassified'
export type Severity = 'S0' | 'S1' | 'S2' | 'S3'

export interface LedgerRow {
  id: string
  title: string
  status: RowStatus
  severity: Severity | null
  /** S0 / S1 in the row's text with no mark that reads it (R1760). Fails the gate. */
  unreadableMark: 'S0' | 'S1' | null
}

export class LedgerParseError extends Error {}

/**
 * Below this, the "ledger" we read is not the ledger: a renamed heading or a
 * truncated file must not read as a nearly clean table. 639 rows were measured
 * at L.F2.12, and PROGRESS never shrinks.
 */
export const MIN_LEDGER_ROWS = 600

const SECTION_HEADING = /^## 6\. Forward obligations ledger/
const ROW_ID = /^\|\s*[~*]*(F\d+)[~*]*\s*\|/
const OPEN_HEAD = /^(⬜|⏳|🟡|◐|Open\b|Partial\b|Partly\b)/iu
const CLOSED_HEAD = /^(✅|⬛|Done\b|Discharged\b|Closed\b|Decided\b|Answered\b|Withdrawn\b|Ruled\b)/iu
/** `✅ Partly discharged` / `✅ Code parts discharged`: something is still owed. */
const PARTIAL_CLOSED = /^✅[\s*]*(partly|partial|code parts)/iu
/**
 * The superseded-open shapes, closed as a whole: `⬜ Open → ✅ DISCHARGED`,
 * `⬜ Open — filed 2026-09-27 **✅ DISCHARGED`, `⬜ Open *→ ✅ Closed`. A ✅ that
 * names a part (`⬜ Open — **(a) ✅ …`) does not match: that row is still open.
 */
const SUPERSEDED_OPEN = /^⬜[\s*]*Open[\s*]*(—\s*filed\s+\d{4}-\d{2}-\d{2}[\s*]*)?(→[\s*]*)?✅/iu

/** §6's lines only: rows in §5 or the review findings are not the ledger. */
function ledgerLines(markdown: string): string[] {
  const lines = markdown.split('\n')
  const start = lines.findIndex((l) => SECTION_HEADING.test(l))
  if (start < 0) throw new LedgerParseError('PROGRESS has no "## 6. Forward obligations ledger" heading')
  const after = lines.slice(start + 1)
  const end = after.findIndex((l) => l.startsWith('## '))
  return end < 0 ? after : after.slice(0, end)
}

function cellsOf(line: string): string[] {
  const body = line.replace(/^\|\s*/, '').replace(/\s*\|\s*$/, '')
  return body.split(/\s\|\s/).map((c) => c.trim())
}

/** A cell's leading markup and struck-through words removed: what it says now. */
function statusHead(cell: string): string {
  let s = cell
  for (;;) {
    const t = s.replace(/^[*\s]+/, '')
    const struck = t.match(/^~~.*?~~/u)
    if (!struck) return t
    s = t.slice(struck[0].length)
  }
}

function looksLikeStatus(cell: string): boolean {
  const head = statusHead(cell)
  return OPEN_HEAD.test(head) || CLOSED_HEAD.test(head)
}

/**
 * The status cell: the fifth on a regular row. A `|` in the text shifts it, and
 * text after a `|` in the status cell itself lands in later cells, so an
 * irregular row is searched from the end for a cell that reads as a status.
 */
function statusIndexOf(cells: string[]): number {
  if (cells.length === 5) return 4
  for (let i = cells.length - 1; i >= 2; i--) {
    if (looksLikeStatus(cells[i]!)) return i
  }
  return -1
}

export function classifyStatus(cell: string): RowStatus {
  const head = statusHead(cell)
  if (PARTIAL_CLOSED.test(head)) return 'open'
  if (SUPERSEDED_OPEN.test(head)) return 'closed'
  if (CLOSED_HEAD.test(head)) return 'closed'
  if (OPEN_HEAD.test(head)) return 'open'
  return 'unclassified'
}

export function readSeverity(obligation: string, status: string): Severity | null {
  const marks: string[] = []
  const inObligation = /^[\s*~]*\[S([0-3])\b/.exec(obligation)
  if (inObligation) marks.push(inObligation[1]!)
  const inHead = /^[⬜\s*]*Open[\s*]*—[\s*]*S([0-3])\b/u.exec(statusHead(status))
  if (inHead) marks.push(inHead[1]!)
  for (const m of status.matchAll(/\bRated S([0-3])\b/g)) marks.push(m[1]!)
  for (const m of status.matchAll(/\[Severity S([0-3])\b/g)) marks.push(m[1]!)
  if (marks.length === 0) return null
  return `S${marks.sort()[0]}` as Severity
}

/**
 * Rows whose text says S0 / S1 without rating themselves, each by id with why.
 * Everything else that says it needs a mark that reads it (R1760).
 */
export const S01_TEXT_ALLOWLIST: Readonly<Record<string, string>> = {
  F761: "cites TD6's record of the weekend; no rating of its own",
  F778: 'its close-out condition names "no other S0 / S1"',
  F861: 'its title is about the gate\'s "zero S0/S1"',
}

const S01_TOKEN = /\bS([01])\b/giu
const STRUCK = /~~.*?~~/gu

/**
 * The S0 / S1 a row's text states that its marks don't account for. A row rated
 * S0 has nothing worse to say; a milder rating beside the words does not settle
 * them. Reword the row or allowlist it; never let a spelling pass as unrated.
 */
export function readUnreadableMark(id: string, obligation: string, status: string): 'S0' | 'S1' | null {
  if (Object.hasOwn(S01_TEXT_ALLOWLIST, id)) return null
  const severity = readSeverity(obligation, status)
  const text = `${obligation} ${status}`.replace(STRUCK, ' ')
  const tokens = [...text.matchAll(S01_TOKEN)].map((m) => m[1]!)
  if (tokens.length === 0) return null
  const worst = `S${tokens.sort()[0]}` as 'S0' | 'S1'
  if (severity === 'S0' || severity === worst) return null
  return worst
}

function shortTitle(obligation: string): string {
  const plain = obligation.replace(/\*\*|~~|\*/g, '').trim()
  const chars = Array.from(plain)
  return chars.length <= 100 ? plain : `${chars.slice(0, 100).join('')}…`
}

export function parseLedger(markdown: string, minRows = MIN_LEDGER_ROWS): LedgerRow[] {
  const rows: LedgerRow[] = []
  for (const line of ledgerLines(markdown)) {
    const id = ROW_ID.exec(line)?.[1]
    if (!id) continue
    const cells = cellsOf(line)
    const obligation = cells[1] ?? ''
    const at = statusIndexOf(cells)
    if (at < 0) {
      // No status cell at all: read the marks over the whole row's text, so an
      // S0 in an unreadable row still fails the gate.
      rows.push({
        id,
        title: shortTitle(obligation),
        status: 'unclassified',
        severity: readSeverity(obligation, cells.slice(2).join(' | ')),
        unreadableMark: readUnreadableMark(id, obligation, cells.slice(2).join(' | ')),
      })
      continue
    }
    const statusText = cells.slice(at).join(' | ')
    rows.push({
      id,
      title: shortTitle(obligation),
      status: classifyStatus(cells[at]!),
      severity: readSeverity(obligation, statusText),
      unreadableMark: readUnreadableMark(id, obligation, statusText),
    })
  }
  if (rows.length < minRows) {
    throw new LedgerParseError(
      `the ledger parsed to ${rows.length} row(s), expected at least ${minRows} — this is not the whole table`,
    )
  }
  return rows
}

/**
 * R1759: exit 0 is withheld until these are answered. F861 says criterion 3 can't
 * be claimed for the whole ledger while most rows have no rating; the other three
 * read as wrong-score shapes, so each needs a rating before anything can pass.
 */
export const MUST_BE_CLOSED = ['F861'] as const
export const RATING_OWED = ['F273', 'F859', 'F860'] as const

export interface Withheld {
  id: string
  why: string
}

function withheldOf(rows: LedgerRow[]): Withheld[] {
  const out: Withheld[] = []
  const named = (id: string) => rows.filter((r) => r.id === id)
  for (const id of MUST_BE_CLOSED) {
    const found = named(id)
    if (found.length === 0) out.push({ id, why: 'the row is not in the ledger' })
    else if (found.some((r) => r.status !== 'closed')) out.push({ id, why: 'is open: most open rows have no rating, so "zero S0/S1" can\'t be claimed yet' })
  }
  for (const id of RATING_OWED) {
    const found = named(id)
    if (found.length === 0) out.push({ id, why: 'the row is not in the ledger' })
    else if (found.some((r) => r.status !== 'closed' && r.severity === null)) out.push({ id, why: 'reads as a wrong-score shape and has no rating' })
  }
  return out
}

export interface LedgerSummary {
  total: number
  closed: number
  /** Every row as parsed, for the §10 review line. */
  rows: LedgerRow[]
  openBySeverity: Record<Severity, LedgerRow[]>
  /** Open with no rating: reported, never read as clean. Fails only through R1760 / R1759. */
  unrated: LedgerRow[]
  /** Open, S0 / S1 in the text, no mark that reads it (R1760). All of these fail. */
  unreadable: LedgerRow[]
  /** No readable status. Reported by name. */
  unclassified: LedgerRow[]
  /** Open or unclassified with S0 / S1 by a mark or in unreadable text. These fail the gate. */
  failing: LedgerRow[]
  /** What holds exit 0 back without being an open S0 / S1 (R1759). */
  withheld: Withheld[]
}

export function summarizeLedger(rows: LedgerRow[]): LedgerSummary {
  const openBySeverity: Record<Severity, LedgerRow[]> = { S0: [], S1: [], S2: [], S3: [] }
  const unrated: LedgerRow[] = []
  const unreadable: LedgerRow[] = []
  const unclassified: LedgerRow[] = []
  const failing: LedgerRow[] = []
  let closed = 0
  for (const row of rows) {
    if (row.status === 'closed') {
      closed++
      continue
    }
    if (row.status === 'unclassified') unclassified.push(row)
    else if (row.severity) openBySeverity[row.severity].push(row)
    else if (row.unreadableMark) unreadable.push(row)
    else unrated.push(row)
    if (row.severity === 'S0' || row.severity === 'S1' || row.unreadableMark) failing.push(row)
  }
  return { total: rows.length, closed, rows, openBySeverity, unrated, unreadable, unclassified, failing, withheld: withheldOf(rows) }
}

// ---------------------------------------------------------------------------
// The attachments
// ---------------------------------------------------------------------------
export interface AttachmentSpec {
  key: string
  /** tasks-M7 §1's exit criterion this proves. */
  criterion: number
  what: string
  /** Repo-relative. */
  path: string
  waitsOn: string
  /** C4: the PASS needs Chris's dated ruling on the line beside it (R1765). */
  rulingBeside?: boolean
}

export const ATTACHMENTS: AttachmentSpec[] = [
  {
    key: 'L.F2.2',
    criterion: 1,
    what: 'L.F2.2 load results at 2026 size (the y2026 profile; F311, F701)',
    path: 'docs/runbooks/evidence/L.F2.2-load-y2026.md',
    waitsOn: 'C1, the hosted test project (does not exist yet)',
  },
  {
    key: 'L.F2.10',
    criterion: 2,
    what: 'L.F2.10 runbook rehearsal logs, timestamped (TD5; F759, F834)',
    path: 'docs/runbooks/evidence/L.F2.10-rehearsal-log.md',
    waitsOn: 'C1, the hosted test project (does not exist yet)',
  },
  {
    key: 'C4',
    criterion: 4,
    what: "the test-league live draft weekend record + Chris's ruling (TD10; F761)",
    path: 'docs/runbooks/beta-ladder.md',
    waitsOn: "C4, the weekend itself, then Chris's ruling",
    rulingBeside: true,
  },
]

export type AttachmentState = 'pass' | 'absent' | 'no-verdict' | 'not-pass' | 'no-ruling'

export interface AttachmentFinding {
  spec: AttachmentSpec
  state: AttachmentState
  detail: string
}

/**
 * The file's text with fenced code and HTML comments removed: an example is not
 * a verdict. Fails closed: a fence at any indent counts, `~~~` as well as three
 * backticks, closed only by its own kind; an unclosed fence or comment hides the
 * rest of the file.
 */
function outsideFences(text: string): string[] {
  const kept: string[] = []
  let fence: string | null = null
  let inComment = false
  for (const raw of text.split('\n')) {
    if (fence !== null) {
      const closes = raw.trim()
      if (closes.length >= fence.length && closes[0] === fence[0] && closes === fence[0]!.repeat(closes.length)) fence = null
      continue
    }
    let line = raw
    if (inComment) {
      const end = line.indexOf('-->')
      if (end < 0) continue
      line = line.slice(end + 3)
      inComment = false
    }
    for (;;) {
      const open = line.indexOf('<!--')
      if (open < 0) break
      const close = line.indexOf('-->', open + 4)
      if (close < 0) {
        line = line.slice(0, open)
        inComment = true
        break
      }
      line = line.slice(0, open) + line.slice(close + 3)
    }
    const opens = /^\s*(`{3,}|~{3,})/.exec(line)
    if (opens) {
      fence = opens[1]!
      continue
    }
    kept.push(line)
  }
  return kept
}

function isRealDate(iso: string): boolean {
  const at = new Date(`${iso}T00:00:00.000Z`)
  return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(iso)
}

/** `M7-GATE-RULING: C4 2026-12-01 <his words>` on the nearest non-blank line either side of the PASS. */
function hasRulingBeside(lines: string[], passAt: number, key: string): boolean {
  const ruling = new RegExp(`^M7-GATE-RULING: ${key.replace(/\./g, '\\.')} (\\d{4}-\\d{2}-\\d{2}) +\\S`)
  const nearest = (from: number, step: number): string | undefined => {
    for (let i = from; i >= 0 && i < lines.length; i += step) if (lines[i]!.trim() !== '') return lines[i]
    return undefined
  }
  return [nearest(passAt - 1, -1), nearest(passAt + 1, 1)].some((line) => {
    const date = line === undefined ? null : ruling.exec(line)?.[1]
    return typeof date === 'string' && isRealDate(date)
  })
}

/** `text` is the file's content, or null when the file does not exist. */
export function judgeAttachment(spec: AttachmentSpec, text: string | null): AttachmentFinding {
  if (text === null) {
    return { spec, state: 'absent', detail: `${spec.path} does not exist` }
  }
  const prefix = `M7-GATE-ATTACHMENT: ${spec.key} `
  const lines = outsideFences(text).map((l) => l.trimEnd())
  const verdicts = lines
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.slice(prefix.length))
  if (verdicts.length === 0) {
    return { spec, state: 'no-verdict', detail: `${spec.path} has no "${prefix.trimEnd()} PASS" line of its own` }
  }
  const other = verdicts.find((v) => v !== 'PASS')
  if (other !== undefined) {
    return { spec, state: 'not-pass', detail: `${spec.path} says "${prefix}${other}"` }
  }
  if (spec.rulingBeside && !hasRulingBeside(lines, lines.indexOf(`${prefix}PASS`), spec.key)) {
    return {
      spec,
      state: 'no-ruling',
      detail: `${spec.path} says PASS with no "M7-GATE-RULING: ${spec.key} <YYYY-MM-DD> <the ruling>" line beside it`,
    }
  }
  return { spec, state: 'pass', detail: `${spec.path} says PASS` }
}

export function readAttachments(root: string, specs: AttachmentSpec[] = ATTACHMENTS): AttachmentFinding[] {
  return specs.map((spec) => {
    const file = join(root, spec.path)
    return judgeAttachment(spec, existsSync(file) ? readFileSync(file, 'utf8') : null)
  })
}

// ---------------------------------------------------------------------------
// The stamps (R1761)
// ---------------------------------------------------------------------------
/** The automated stages of `scripts/gate-m7.sh`; [7/7] is the verdict itself. */
export const GATE_STAGES = [1, 2, 3, 4, 5, 6] as const

export function stampFile(stage: number): string {
  return `stage-${stage}.done`
}

/** What keeps the verdict from running for `head`. Empty means every stage is on record. */
export function judgeStamps(head: string, read: (stage: number) => string | null): string[] {
  const problems: string[] = []
  for (const stage of GATE_STAGES) {
    const stamped = read(stage)
    if (stamped === null) problems.push(`stage ${stage}/7 has no stamp`)
    else if (stamped.trim() !== head) problems.push(`stage ${stage}/7 is stamped for ${stamped.trim() || 'nothing'}`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------
export interface CommitState {
  sha: string
  /** Tracked or untracked changes in the tree when the verdict ran. */
  dirty: boolean
}

export interface VerdictInput {
  ledger: LedgerSummary
  attachments: AttachmentFinding[]
  /** True only when the gate's automated stages actually ran and passed. */
  legsGreen: boolean
  /** How the M8 gate stands. Absent is printed, never silently skipped. */
  m8: 'absent' | 'ran'
  elapsedSeconds: number | null
  /** The commit the verdict speaks for; null only in pre-flight's picture. */
  commit: CommitState | null
}

/** What the ledger and the attachments alone say; no test leg is implied. */
export function standingCode(v: Pick<VerdictInput, 'ledger' | 'attachments'>): number {
  if (v.ledger.failing.length > 0) return EXIT_OPEN_S0_S1
  if (v.attachments.some((a) => a.state !== 'pass') || v.ledger.withheld.length > 0) return EXIT_EVIDENCE_MISSING
  return EXIT_PASSED
}

export function exitCodeOf(v: Pick<VerdictInput, 'ledger' | 'attachments' | 'legsGreen'>): number {
  return v.legsGreen ? standingCode(v) : EXIT_LEG_FAILED
}

const RULE = '======================================================================'

function idList(rows: LedgerRow[]): string {
  return rows.length === 0 ? 'none' : rows.map((r) => r.id).join(' ')
}

export function renderLedgerLines(ledger: LedgerSummary): string[] {
  const lines = [
    `Ledger: ${ledger.total} rows, ${ledger.closed} closed.`,
    `  open S0: ${ledger.openBySeverity.S0.length} — ${idList(ledger.openBySeverity.S0)}`,
    `  open S1: ${ledger.openBySeverity.S1.length} — ${idList(ledger.openBySeverity.S1)}`,
    `  open S2: ${ledger.openBySeverity.S2.length} — ${idList(ledger.openBySeverity.S2)}`,
    `  open S3: ${ledger.openBySeverity.S3.length} — ${idList(ledger.openBySeverity.S3)}`,
    `  open, S0/S1 in the text with no mark that reads it: ${ledger.unreadable.length} — ${idList(ledger.unreadable)}`,
    `  open UNRATED: ${ledger.unrated.length} — NOT read as clean; "zero S0/S1" covers rated rows only.`,
    `    ${idList(ledger.unrated)}`,
    `  status unreadable: ${ledger.unclassified.length} — ${idList(ledger.unclassified)}`,
  ]
  return lines
}

/** The full list with titles, for the report file. */
export function renderLedgerReport(ledger: LedgerSummary): string {
  const out = [...renderLedgerLines(ledger), '']
  const section = (name: string, rows: LedgerRow[]) => {
    out.push(`${name} (${rows.length})`)
    for (const r of rows) out.push(`  ${r.id} — ${r.title}`)
    out.push('')
  }
  section('OPEN S0', ledger.openBySeverity.S0)
  section('OPEN S1', ledger.openBySeverity.S1)
  section('OPEN S2', ledger.openBySeverity.S2)
  section('OPEN S3', ledger.openBySeverity.S3)
  section('OPEN, S0/S1 IN THE TEXT, NO MARK READS IT', ledger.unreadable)
  section('OPEN UNRATED', ledger.unrated)
  section('STATUS UNREADABLE', ledger.unclassified)
  return out.join('\n')
}

/** tasks-M7 §10's "reviewed at L.F2.12 for severity" list. */
export const SECTION_10_ROWS = ['F50', 'F86', 'F92', 'F93', 'F144', 'F212', 'F226', 'F248', 'F256', 'F260', 'F262', 'F274', 'F275', 'F278', 'F281'] as const

/** R1766: where tasks-M7 §9's map and §10's review stand, every time. */
function proofMapLines(input: Pick<VerdictInput, 'ledger' | 'attachments'>): string[] {
  const { ledger, attachments } = input
  const lines = ['  tasks-M7 §9, the exit criteria:']
  const criterionLine = (a: AttachmentFinding) =>
    `    criterion ${a.spec.criterion}, ${a.spec.key}: ${a.state === 'pass' ? 'attached' : 'not attached'}`
  for (const a of attachments.filter((f) => f.spec.criterion < 3)) lines.push(criterionLine(a))
  lines.push(
    `    criterion 3, zero S0/S1: ${ledger.failing.length} open${ledger.failing.length > 0 ? ` (${idList(ledger.failing)})` : ''}; ${ledger.withheld.length} held back (${ledger.withheld.map((w) => w.id).join(' ') || 'none'})`,
  )
  for (const a of attachments.filter((f) => f.spec.criterion > 3)) lines.push(criterionLine(a))
  lines.push('    Phase F (L.F1.1, L.F1.4): not read here; their boxes are in PROGRESS §2.')
  const reviewed = SECTION_10_ROWS.map((id) => ledger.rows.find((r) => r.id === id))
  const rated = reviewed.filter((r) => r?.severity).length
  const atS01 = SECTION_10_ROWS.filter((id) =>
    ledger.rows.some((r) => r.id === id && r.status !== 'closed' && (r.severity === 'S0' || r.severity === 'S1')),
  )
  lines.push(
    `  tasks-M7 §10, the ${SECTION_10_ROWS.length} severity reviews: ${rated} rated; open at S0/S1: ${atS01.join(' ') || 'none'} (each becomes a task).`,
  )
  return lines
}

/** What a failing row is failing on, for the banner. */
function failingLabel(row: LedgerRow): string {
  return row.unreadableMark ? `${row.unreadableMark} in its text, no mark reads it` : `${row.severity}`
}

function missingLines(input: VerdictInput): string[] {
  const out: string[] = []
  for (const a of input.attachments) {
    if (a.state === 'pass') continue
    out.push(`    - criterion ${a.spec.criterion}: ${a.spec.what}`)
    out.push(`      ${a.detail}; waits on ${a.spec.waitsOn}`)
  }
  if (input.ledger.failing.length > 0) {
    out.push('    - criterion 3: zero S0/S1 open — these are open:')
    for (const r of input.ledger.failing) out.push(`      ${r.id} [${failingLabel(r)}] ${r.title}`)
  }
  for (const w of input.ledger.withheld) out.push(`    - criterion 3: exit 0 held back: ${w.id} ${w.why}`)
  return out
}

/** Pre-flight's picture: what stands today. Says nothing about any test leg. */
export function renderStatus(input: Pick<VerdictInput, 'ledger' | 'attachments'>): string {
  const full: VerdictInput = { ...input, legsGreen: false, m8: 'absent', elapsedSeconds: null, commit: null }
  const missing = missingLines(full)
  return [
    ...renderLedgerLines(input.ledger),
    '',
    missing.length > 0 ? 'Standing against the verdict (no test leg has run yet):' : 'Nothing stands against the verdict yet (no test leg has run).',
    ...missing,
    '',
    ...proofMapLines(input),
  ].join('\n')
}

function commitLine(commit: CommitState | null): string {
  if (commit === null) return '  Commit: not recorded.'
  return `  Commit: ${commit.sha} ${commit.dirty ? '(DIRTY: uncommitted changes, so this is not that commit alone)' : '(clean)'}`
}

function exit3Reason(input: VerdictInput): string {
  const reasons: string[] = []
  if (input.attachments.some((a) => a.state !== 'pass')) reasons.push('an attachment is missing')
  if (input.ledger.withheld.length > 0) reasons.push('a rating is owed')
  return `${reasons.join(' and ')}, no test failed`
}

export function renderBanner(input: VerdictInput): string {
  const code = exitCodeOf(input)
  const m8Line =
    input.m8 === 'ran'
      ? '  test:gate:m8: ran, green.'
      : "  test:gate:m8: NOT RUN — it does not exist (M8's L.G2.2 is unticked; it waits on C1)."
  const total = input.elapsedSeconds === null ? [] : [`  TOTAL: ${input.elapsedSeconds}s`]
  const unrated = `  Open rows with no rating: ${input.ledger.unrated.length} (NOT read as clean; "zero S0/S1" covers rated rows only).`
  const commit = commitLine(input.commit)
  const proofMap = proofMapLines(input)
  if (!input.legsGreen) {
    return [
      RULE,
      '  M7 2026 GATE NOT PASSED — the automated legs did not complete.',
      commit,
      ...missingLines(input),
      m8Line,
      unrated,
      ...proofMap,
      RULE,
    ].join('\n')
  }
  if (code === EXIT_PASSED) {
    return [
      RULE,
      '  M7 2026 GATE PASSED — tasks-M7 §9, 2026 form: automated legs green, the',
      '  L.F2.2 results, the L.F2.10 logs and the C4 ruling attached, no rated S0/S1',
      '  open. M7 itself closes at L.F2.15, the launch gate (TD9).',
      commit,
      m8Line,
      unrated,
      ...proofMap,
      ...total,
      RULE,
    ].join('\n')
  }
  return [
    RULE,
    '  AUTOMATED LEGS GREEN — M7 2026 GATE NOT PASSED',
    commit,
    '  Missing:',
    ...missingLines(input),
    m8Line,
    unrated,
    ...proofMap,
    `  Exit ${code}: ${code === EXIT_OPEN_S0_S1 ? 'an S0/S1 row is open' : exit3Reason(input)}.`,
    ...total,
    RULE,
  ].join('\n')
}
