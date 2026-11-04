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
 *
 * 3. THE ATTACHMENTS. Exit criteria 1, 2 and 4 are not scripts. Each needs a
 *    file that says, on a line of its own, `M7-GATE-ATTACHMENT: <key> PASS`.
 *    An absent file, an empty file, a file with no such line, and a line
 *    saying anything but PASS are four different ways of NOT having it — and
 *    the banner names which. A mention inside a sentence or a code fence does
 *    not count, so the docs can describe the line without satisfying it.
 *
 * THE VERDICT. Exit 0 ONLY when every automated leg ran green AND all three
 * attachments say PASS AND no S0 / S1 row is open. CLAUDE.md: never let
 * "nothing happened" mean it worked.
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
/** Every automated leg green; an attachment is missing. Not a test failure. */
export const EXIT_ATTACHMENT_MISSING = 3
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
      })
      continue
    }
    const statusText = cells.slice(at).join(' | ')
    rows.push({
      id,
      title: shortTitle(obligation),
      status: classifyStatus(cells[at]!),
      severity: readSeverity(obligation, statusText),
    })
  }
  if (rows.length < minRows) {
    throw new LedgerParseError(
      `the ledger parsed to ${rows.length} row(s), expected at least ${minRows} — this is not the whole table`,
    )
  }
  return rows
}

export interface LedgerSummary {
  total: number
  closed: number
  openBySeverity: Record<Severity, LedgerRow[]>
  /** Open with no rating: reported, never read as clean, never read as a failure. */
  unrated: LedgerRow[]
  /** No readable status. Reported by name. */
  unclassified: LedgerRow[]
  /** Open S0 / S1, plus any unclassified row carrying S0 / S1. These fail the gate. */
  failing: LedgerRow[]
}

export function summarizeLedger(rows: LedgerRow[]): LedgerSummary {
  const openBySeverity: Record<Severity, LedgerRow[]> = { S0: [], S1: [], S2: [], S3: [] }
  const unrated: LedgerRow[] = []
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
    else unrated.push(row)
    if (row.severity === 'S0' || row.severity === 'S1') failing.push(row)
  }
  return { total: rows.length, closed, openBySeverity, unrated, unclassified, failing }
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
  },
]

export type AttachmentState = 'pass' | 'absent' | 'no-verdict' | 'not-pass'

export interface AttachmentFinding {
  spec: AttachmentSpec
  state: AttachmentState
  detail: string
}

/** The file's text with fenced code removed: an example is not a verdict. */
function outsideFences(text: string): string[] {
  const kept: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (!inFence) kept.push(line)
  }
  return kept
}

/** `text` is the file's content, or null when the file does not exist. */
export function judgeAttachment(spec: AttachmentSpec, text: string | null): AttachmentFinding {
  if (text === null) {
    return { spec, state: 'absent', detail: `${spec.path} does not exist` }
  }
  const prefix = `M7-GATE-ATTACHMENT: ${spec.key} `
  const verdicts = outsideFences(text)
    .map((l) => l.trimEnd())
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.slice(prefix.length))
  if (verdicts.length === 0) {
    return { spec, state: 'no-verdict', detail: `${spec.path} has no "${prefix.trimEnd()} PASS" line of its own` }
  }
  const other = verdicts.find((v) => v !== 'PASS')
  if (other !== undefined) {
    return { spec, state: 'not-pass', detail: `${spec.path} says "${prefix}${other}"` }
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
// The verdict
// ---------------------------------------------------------------------------
export interface VerdictInput {
  ledger: LedgerSummary
  attachments: AttachmentFinding[]
  /** True only when the gate's automated stages actually ran and passed. */
  legsGreen: boolean
  /** How the M8 gate stands. Absent is printed, never silently skipped. */
  m8: 'absent' | 'ran'
  elapsedSeconds: number | null
}

/** What the ledger and the attachments alone say; no test leg is implied. */
export function standingCode(v: Pick<VerdictInput, 'ledger' | 'attachments'>): number {
  if (v.ledger.failing.length > 0) return EXIT_OPEN_S0_S1
  if (v.attachments.some((a) => a.state !== 'pass')) return EXIT_ATTACHMENT_MISSING
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
  section('OPEN UNRATED', ledger.unrated)
  section('STATUS UNREADABLE', ledger.unclassified)
  return out.join('\n')
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
    for (const r of input.ledger.failing) out.push(`      ${r.id} [${r.severity}] ${r.title}`)
  }
  return out
}

/** Pre-flight's picture: what stands today. Says nothing about any test leg. */
export function renderStatus(input: Omit<VerdictInput, 'legsGreen' | 'elapsedSeconds' | 'm8'>): string {
  const full: VerdictInput = { ...input, legsGreen: false, m8: 'absent', elapsedSeconds: null }
  const missing = missingLines(full)
  return [
    ...renderLedgerLines(input.ledger),
    '',
    missing.length > 0 ? 'Standing against the verdict (no test leg has run yet):' : 'Nothing stands against the verdict yet (no test leg has run).',
    ...missing,
  ].join('\n')
}

export function renderBanner(input: VerdictInput): string {
  const code = exitCodeOf(input)
  const m8Line =
    input.m8 === 'ran'
      ? '  test:gate:m8: ran, green.'
      : "  test:gate:m8: NOT RUN — it does not exist (M8's L.G2.2 is unticked; it waits on C1)."
  const total = input.elapsedSeconds === null ? [] : [`  TOTAL: ${input.elapsedSeconds}s`]
  const unrated = `  Open rows with no rating: ${input.ledger.unrated.length} (NOT read as clean; "zero S0/S1" covers rated rows only).`
  if (!input.legsGreen) {
    return [
      RULE,
      '  M7 2026 GATE NOT PASSED — the automated legs did not complete.',
      ...missingLines(input),
      m8Line,
      unrated,
      RULE,
    ].join('\n')
  }
  if (code === EXIT_PASSED) {
    return [
      RULE,
      '  M7 2026 GATE PASSED — tasks-M7 §9, 2026 form: automated legs green, the',
      '  L.F2.2 results, the L.F2.10 logs and the C4 ruling attached, no rated S0/S1',
      '  open. M7 itself closes at L.F2.15, the launch gate (TD9).',
      m8Line,
      unrated,
      ...total,
      RULE,
    ].join('\n')
  }
  return [
    RULE,
    '  AUTOMATED LEGS GREEN — M7 2026 GATE NOT PASSED',
    '  Missing:',
    ...missingLines(input),
    m8Line,
    unrated,
    `  Exit ${code}: ${code === EXIT_OPEN_S0_S1 ? 'an S0/S1 row is open' : 'an attachment is missing, no test failed'}.`,
    ...total,
    RULE,
  ].join('\n')
}
