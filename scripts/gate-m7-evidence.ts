/**
 * gate-m7-evidence.ts — the CLI over `gate-m7-open-rows.ts` (M7 L.F2.12).
 *
 *   npx tsx scripts/gate-m7-evidence.ts status  [--root DIR] [--out DIR]
 *     What stands today: the ledger by severity and the three attachments.
 *     Safe any time; touches no database. Claims nothing about a test leg.
 *
 *   npx tsx scripts/gate-m7-evidence.ts verdict --m8 absent|ran
 *                                               [--elapsed S] [--root DIR] [--out DIR]
 *     The gate's last stage. Prints the banner, but only when every automated
 *     stage left its stamp for HEAD under `<root>/.gate-m7/` (R1761): run by
 *     hand with no leg behind it, it refuses with exit 2. Accident prevention,
 *     not forgery-proofing.
 *
 * EXIT: 0 passed · 1 a crash · 2 unreadable ledger, a misused command, or no
 * stamps for HEAD · 3 an attachment is missing or a rating is owed · 4 an S0 / S1
 * row is open. `status` exits 3 / 4 the same way, or 0 when nothing stands
 * against the verdict yet.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  EXIT_UNREADABLE,
  LedgerParseError,
  exitCodeOf,
  judgeStamps,
  parseLedger,
  readAttachments,
  renderBanner,
  renderLedgerReport,
  renderStatus,
  stampFile,
  standingCode,
  summarizeLedger,
} from './gate-m7-open-rows'

const PROGRESS = 'docs/specs/PROGRESS-leagues.md'
const STAMP_DIR = '.gate-m7'

function refuse(message: string): never {
  console.error(`gate-m7-evidence: ${message}`)
  process.exit(EXIT_UNREADABLE)
}

function parseArgs(argv: string[]): { command: string; flags: Map<string, string> } {
  const [command, ...rest] = argv
  if (command !== 'status' && command !== 'verdict') refuse('the command must be "status" or "verdict"')
  const allowed = command === 'status' ? ['--root', '--out'] : ['--root', '--out', '--m8', '--elapsed']
  const flags = new Map<string, string>()
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i]!
    const value = rest[i + 1]
    if (!allowed.includes(name)) refuse(`unknown flag ${name}`)
    if (value === undefined) refuse(`${name} needs a value`)
    flags.set(name, value)
  }
  return { command, flags }
}

function git(root: string, ...args: string[]): string {
  const res = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  if (res.status !== 0) refuse(`git ${args.join(' ')} failed under ${root}: the verdict can't name a commit`)
  return res.stdout.trim()
}

function main() {
  const { command, flags } = parseArgs(process.argv.slice(2))
  const root = resolve(flags.get('--root') ?? '.')
  const out = flags.get('--out')

  let markdown: string
  try {
    markdown = readFileSync(join(root, PROGRESS), 'utf8')
  } catch {
    refuse(`cannot read ${PROGRESS} under ${root}`)
  }

  let rows
  try {
    rows = parseLedger(markdown)
  } catch (error) {
    if (error instanceof LedgerParseError) refuse(error.message)
    throw error
  }
  const ledger = summarizeLedger(rows)
  const attachments = readAttachments(root)

  function writeReport(dir: string) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'open-rows.txt'), renderLedgerReport(ledger))
  }

  if (command === 'status') {
    if (out) writeReport(out)
    console.log(renderStatus({ ledger, attachments }))
    process.exit(standingCode({ ledger, attachments }))
  }

  const m8 = flags.get('--m8')
  if (m8 !== 'absent' && m8 !== 'ran') refuse('verdict needs --m8 absent|ran')
  const elapsedRaw = flags.get('--elapsed')
  const elapsedSeconds = elapsedRaw === undefined ? null : Number(elapsedRaw)
  if (elapsedSeconds !== null && !Number.isFinite(elapsedSeconds)) refuse('--elapsed must be a number of seconds')

  const sha = git(root, 'rev-parse', 'HEAD')
  const notStamped = judgeStamps(sha, (stage) => {
    const file = join(root, STAMP_DIR, stampFile(stage))
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  })
  if (notStamped.length > 0) {
    refuse(`no verdict: the automated legs are not on record for ${sha} (${notStamped.join('; ')}). Run \`npm run test:gate:m7\`; \`status\` shows what stands.`)
  }
  const commit = { sha, dirty: git(root, 'status', '--porcelain') !== '' }

  if (out) writeReport(out)
  const input = { ledger, attachments, legsGreen: true, m8, elapsedSeconds, commit } as const
  console.log(renderBanner(input))
  const code = exitCodeOf(input)
  if (out) writeFileSync(join(out, 'verdict.txt'), `${renderBanner(input)}\nexit ${code}\n`)
  process.exit(code)
}

main()
