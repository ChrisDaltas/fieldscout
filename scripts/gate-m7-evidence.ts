/**
 * gate-m7-evidence.ts — the CLI over `gate-m7-open-rows.ts` (M7 L.F2.12).
 *
 *   npx tsx scripts/gate-m7-evidence.ts status  [--root DIR] [--out DIR]
 *     What stands today: the ledger by severity and the three attachments.
 *     Safe any time; touches no database. Claims nothing about a test leg.
 *
 *   npx tsx scripts/gate-m7-evidence.ts verdict --m8 absent|ran
 *                                               [--elapsed S] [--root DIR] [--out DIR]
 *     The gate's last stage, and only the gate calls it: reaching it means
 *     every automated stage passed under `set -e`. Prints the banner.
 *
 * EXIT: 0 passed · 1 a crash · 2 unreadable ledger or a misused command ·
 * 3 an attachment is missing · 4 an S0 / S1 row is open. `status` exits 3 / 4
 * the same way, or 0 when nothing stands against the verdict yet.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  EXIT_UNREADABLE,
  LedgerParseError,
  exitCodeOf,
  parseLedger,
  readAttachments,
  renderBanner,
  renderLedgerReport,
  renderStatus,
  standingCode,
  summarizeLedger,
} from './gate-m7-open-rows'

const PROGRESS = 'docs/specs/PROGRESS-leagues.md'

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

  if (out) {
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'open-rows.txt'), renderLedgerReport(ledger))
  }

  if (command === 'status') {
    console.log(renderStatus({ ledger, attachments }))
    process.exit(standingCode({ ledger, attachments }))
  }

  const m8 = flags.get('--m8')
  if (m8 !== 'absent' && m8 !== 'ran') refuse('verdict needs --m8 absent|ran')
  const elapsedRaw = flags.get('--elapsed')
  const elapsedSeconds = elapsedRaw === undefined ? null : Number(elapsedRaw)
  if (elapsedSeconds !== null && !Number.isFinite(elapsedSeconds)) refuse('--elapsed must be a number of seconds')

  const input = { ledger, attachments, legsGreen: true, m8, elapsedSeconds } as const
  console.log(renderBanner(input))
  const code = exitCodeOf(input)
  if (out) writeFileSync(join(out, 'verdict.txt'), `${renderBanner(input)}\nexit ${code}\n`)
  process.exit(code)
}

main()
