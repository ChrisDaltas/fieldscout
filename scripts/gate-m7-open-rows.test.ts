/**
 * gate-m7-open-rows.test.ts — M7 L.F2.12 (PROGRESS D792). No database. Every
 * ledger fixture below is a stored literal copied from the shapes PROGRESS §6
 * really holds; the load-bearing property is the honest verdict: nothing absent,
 * empty, unreadable or unrated is ever read as success.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  ATTACHMENTS,
  EXIT_ATTACHMENT_MISSING,
  EXIT_LEG_FAILED,
  EXIT_OPEN_S0_S1,
  EXIT_PASSED,
  EXIT_UNREADABLE,
  LedgerParseError,
  classifyStatus,
  exitCodeOf,
  judgeAttachment,
  parseLedger,
  readSeverity,
  renderBanner,
  renderStatus,
  summarizeLedger,
  type AttachmentFinding,
  type LedgerRow,
} from './gate-m7-open-rows'

const REPO = resolve(__dirname, '..')

function ledgerOf(...rows: string[]): string {
  return [
    '## 5. Blockers',
    '| F9000 | a row outside the ledger | x | y | ⬜ Open — S0 |',
    '## 6. Forward obligations ledger *(added 2026-07-20, R47)*',
    '| # | Obligation | Origin | Discharged by | Status |',
    '|---|---|---|---|---|',
    ...rows,
    '## Review findings — 2026-07-19',
    '| F9001 | a row after the ledger | x | y | ⬜ Open — S0 |',
  ].join('\n')
}

const parsed = (...rows: string[]) => parseLedger(ledgerOf(...rows), 1)
const one = (row: string): LedgerRow => parsed(row)[0]!

function passingAttachments(): AttachmentFinding[] {
  return ATTACHMENTS.map((spec) => judgeAttachment(spec, `M7-GATE-ATTACHMENT: ${spec.key} PASS\n`))
}

function missingAttachments(): AttachmentFinding[] {
  return ATTACHMENTS.map((spec) => judgeAttachment(spec, null))
}

const CLEAN = summarizeLedger(parsed('| F1 | done row | x | y | ✅ Done 2026-09-07 |'))

describe('the status of a row', () => {
  it.each([
    ['⬜ Open', 'open'],
    ['Open', 'open'],
    ['⬜ Open — S0', 'open'],
    ['⏳ Open', 'open'],
    ['🟡 Partial — **052 §K1/§K2**', 'open'],
    ['◐ **(a)’s L.E2 part — L.E2.1**', 'open'],
    ['⬜ **Open — NARROWED 2026-08-20', 'open'],
    ['Open — blocks merge', 'open'],
    ['✅ Done 2026-10-27 (D762)', 'closed'],
    ['**✅ Done (2026-07-25 — Q10 ruled', 'closed'],
    ['**Discharged 2026-10-21** — Chris "okay"', 'closed'],
    ['Decided (D593 rulings)', 'closed'],
    ['⬛ Withdrawn', 'closed'],
    ['~~⬜ Open~~ **✅ Discharged 2026-10-20 by L.F1.1** — x', 'closed'],
    ['~~⬜ Open — filed 2026-09-11~~ **✅ CLOSED — NOT WANTED', 'closed'],
    ['⬜ Open → ✅ **DISCHARGED 2026-09-08 (L.D5.4, D324)', 'closed'],
    ['⬜ Open — filed 2026-09-27 **✅ DISCHARGED 2026-09-28', 'closed'],
    ['⬜ Open ✅ **Discharged 2026-10-02 — PR #387', 'closed'],
    ['⬜ Open *→ ✅ Closed 2026-10-29', 'closed'],
    // A ✅ that names a part leaves the row open.
    ['⬜ Open — **(a) ✅ 2026-09-07 (L.D1.9, D319(9))', 'open'],
    ['⬜ Open **(a) ✅ DISCHARGED BY M6A — flipped 2026-09-29', 'open'],
    ['✅ **Partly discharged 2026-10-27** (D734)', 'open'],
    ['✅ **Code parts discharged 2026-10-27** (D736)', 'open'],
    // Nothing recognisable is not "closed".
    ['see above', 'unclassified'],
    ['', 'unclassified'],
  ])('%s → %s', (cell, want) => {
    expect(classifyStatus(cell)).toBe(want)
  })
})

describe('the severity of a row', () => {
  it.each([
    ['**[S0 — REDACTED]** A permission breach', '⬜ Open', 'S0'],
    ['**[S2] `notify_list_followers` has no check', '✅ Discharged', 'S2'],
    ["**[S2 — CHRIS'S CALL] A co-commissioner can", '⬜ Open', 'S2'],
    ['plain text', '⬜ Open — S0', 'S0'],
    ['plain text', '⬜ Open — S3 (proposed)', 'S3'],
    ['plain text', '⬜ Open **[2026-10-20, L.F2.7 — re-measured. Rated S2; → L.F2.8.]**', 'S2'],
    ['plain text', '⬜ Open **[Severity S3 — L.F2.12 review: hygiene.]**', 'S3'],
    // The most severe mark wins.
    ['**[S3] x', '⬜ Open **[Severity S1 — re-rated]**', 'S1'],
    // F262's text names a team "S2"; F761's quotes TD6. Neither is a rating.
    ['never mints a (S2, week 1) row', '⬜ Open — **(d) ✅ a (S2, week 1) row**', null],
    ['with its TD6 severity (S0 = wrong score / S1 = …)', '⬜ Open', null],
    ['plain text', '⬜ Open', null],
  ])('%s + %s → %s', (obligation, status, want) => {
    expect(readSeverity(obligation, status)).toBe(want)
  })
})

describe('parseLedger', () => {
  it('reads §6 only — rows in §5 and in the review findings are not the ledger', () => {
    const rows = parsed('| F1 | x | y | z | ⬜ Open |')
    expect(rows.map((r) => r.id)).toEqual(['F1'])
  })

  it('finds the status past a pipe in the text', () => {
    const row = one(
      '| F253 | obligation | L.D5.3 | (a) x | ⬜ Open — **(a) ✅ 2026-09-07 the `Final | Projected` segment is LIVE** · **[Severity S3 — review]** |',
    )
    expect(row).toMatchObject({ status: 'open', severity: 'S3' })
  })

  it('reads a four-cell row and SQL ||', () => {
    expect(one('| F128 | a standalone mock | y | ⬜ Open |').status).toBe('open')
    expect(one('| F18 | a || b | y | z | ✅ Discharged |').status).toBe('closed')
  })

  it('a row with no status cell is unclassified, and its S0 still counts', () => {
    const noCells = one('| F126 | **MS.7 pins** text ✅ Done somewhere in prose. |')
    expect(noCells.status).toBe('unclassified')
    const summary = summarizeLedger(parsed('| F126 | **[S0 — x]** text only |'))
    expect(summary.unclassified.map((r) => r.id)).toEqual(['F126'])
    expect(summary.failing.map((r) => r.id)).toEqual(['F126'])
  })

  it('refuses a missing heading or a table too small to be the ledger', () => {
    expect(() => parseLedger('# nothing here', 1)).toThrow(LedgerParseError)
    expect(() => parseLedger(ledgerOf('| F1 | x | y | z | ⬜ Open |'))).toThrow(/parsed to 1 row/)
  })
})

describe('summarizeLedger', () => {
  const summary = summarizeLedger(
    parsed(
      '| F710 | **[S0 — REDACTED]** breach | L.F2.7 | L.F2.8 | ⬜ Open — S0 |',
      '| F730 | **[S1 while it happens — FIXED]** x | y | z | ✅ Done 2026-10-27 |',
      '| F731 | x | y | z | ⬜ Open — S1 |',
      '| F717 | **[S2] AI spend** | y | z | ⬜ Open — S2 |',
      '| F723 | **[S3] net.http** | y | z | ✅ **Partly discharged 2026-10-27** |',
      '| F50 | older row with no rating | y | z | ⬜ Open |',
    ),
  )

  it('fails on open S0 and S1 by name, and only on those', () => {
    expect(summary.failing.map((r) => r.id)).toEqual(['F710', 'F731'])
  })

  it('a closed S1 is closed', () => {
    expect(summary.closed).toBe(1)
  })

  it('an unrated row is neither clean nor a failure', () => {
    expect(summary.unrated.map((r) => r.id)).toEqual(['F50'])
    expect(summary.failing.map((r) => r.id)).not.toContain('F50')
  })

  it('a partly discharged row stays on the open list', () => {
    expect(summary.openBySeverity.S3.map((r) => r.id)).toEqual(['F723'])
  })
})

describe('judgeAttachment', () => {
  const spec = ATTACHMENTS[0]!
  const line = `M7-GATE-ATTACHMENT: ${spec.key}`

  it('an absent file, an empty file, and a file with no line are each NOT having it', () => {
    expect(judgeAttachment(spec, null).state).toBe('absent')
    expect(judgeAttachment(spec, '').state).toBe('no-verdict')
    expect(judgeAttachment(spec, '# results\n\nall green\n').state).toBe('no-verdict')
  })

  it('a mention in a sentence, an indented line or a code fence does not count', () => {
    expect(judgeAttachment(spec, `Add the line \`${line} PASS\` when done.\n`).state).toBe('no-verdict')
    expect(judgeAttachment(spec, `    ${line} PASS\n`).state).toBe('no-verdict')
    expect(judgeAttachment(spec, `\`\`\`\n${line} PASS\n\`\`\`\n`).state).toBe('no-verdict')
  })

  it('anything but PASS is not PASS, and a later PASS does not launder it', () => {
    expect(judgeAttachment(spec, `${line} FAIL\n`).state).toBe('not-pass')
    expect(judgeAttachment(spec, `${line} PASS with one miss\n`).state).toBe('not-pass')
    expect(judgeAttachment(spec, `${line} FAIL\n${line} PASS\n`).state).toBe('not-pass')
  })

  it("another attachment's PASS is not this one's", () => {
    expect(judgeAttachment(spec, `M7-GATE-ATTACHMENT: C4 PASS\n`).state).toBe('no-verdict')
  })

  it('its own line on its own line is PASS', () => {
    expect(judgeAttachment(spec, `# results\n${line} PASS\n`).state).toBe('pass')
  })

  it('the three attachments are the ones §9 names', () => {
    expect(ATTACHMENTS.map((a) => [a.key, a.criterion])).toEqual([
      ['L.F2.2', 1],
      ['L.F2.10', 2],
      ['C4', 4],
    ])
  })
})

describe('the verdict', () => {
  const openS0 = summarizeLedger(parsed('| F710 | **[S0 — REDACTED]** breach | y | z | ⬜ Open — S0 |'))

  it('exit 0 needs all three: green legs, every attachment, no S0/S1', () => {
    expect(exitCodeOf({ ledger: CLEAN, attachments: passingAttachments(), legsGreen: true })).toBe(EXIT_PASSED)
    expect(exitCodeOf({ ledger: CLEAN, attachments: passingAttachments(), legsGreen: false })).toBe(EXIT_LEG_FAILED)
    expect(exitCodeOf({ ledger: CLEAN, attachments: missingAttachments(), legsGreen: true })).toBe(EXIT_ATTACHMENT_MISSING)
    expect(exitCodeOf({ ledger: openS0, attachments: passingAttachments(), legsGreen: true })).toBe(EXIT_OPEN_S0_S1)
  })

  it('one missing attachment of three is enough', () => {
    for (let i = 0; i < 3; i++) {
      const attachments = passingAttachments()
      attachments[i] = judgeAttachment(attachments[i]!.spec, null)
      expect(exitCodeOf({ ledger: CLEAN, attachments, legsGreen: true })).toBe(EXIT_ATTACHMENT_MISSING)
    }
  })

  it('an open S0 outranks a missing attachment', () => {
    expect(exitCodeOf({ ledger: openS0, attachments: missingAttachments(), legsGreen: true })).toBe(EXIT_OPEN_S0_S1)
  })

  it('the exit codes are distinct from a test failure', () => {
    expect(new Set([EXIT_PASSED, EXIT_LEG_FAILED, EXIT_UNREADABLE, EXIT_ATTACHMENT_MISSING, EXIT_OPEN_S0_S1]).size).toBe(5)
  })

  const banner = (over: Partial<Parameters<typeof renderBanner>[0]> = {}) =>
    renderBanner({ ledger: CLEAN, attachments: missingAttachments(), legsGreen: true, m8: 'absent', elapsedSeconds: 7, ...over })

  it('missing attachments: the exact headline, every leg named, never "GATE PASSED"', () => {
    const text = banner()
    expect(text).toContain('AUTOMATED LEGS GREEN — M7 2026 GATE NOT PASSED')
    expect(text).not.toContain('GATE PASSED')
    for (const a of ATTACHMENTS) expect(text).toContain(a.path)
    expect(text).toContain('criterion 1:')
    expect(text).toContain('criterion 2:')
    expect(text).toContain('criterion 4:')
    expect(text).toContain('Exit 3')
    expect(text).not.toContain('undefined')
  })

  it('an open S0: named with its severity, exit 4, never "GATE PASSED"', () => {
    const text = banner({ ledger: openS0, attachments: passingAttachments() })
    expect(text).toContain('AUTOMATED LEGS GREEN — M7 2026 GATE NOT PASSED')
    expect(text).toContain('F710 [S0]')
    expect(text).toContain('Exit 4')
    expect(text).not.toContain('GATE PASSED')
  })

  it('legs not green: says so, and never claims them', () => {
    const text = banner({ legsGreen: false, attachments: passingAttachments() })
    expect(text).not.toContain('AUTOMATED LEGS GREEN')
    expect(text).not.toContain('GATE PASSED')
  })

  it('all in: "GATE PASSED" appears, with no NOT, and the launch gate is named', () => {
    const text = banner({ attachments: passingAttachments() })
    expect(text).toContain('M7 2026 GATE PASSED')
    expect(text).not.toContain('NOT PASSED')
    expect(text).toContain('L.F2.15')
  })

  it('the M8 gate is printed either way, and unrated rows are always counted', () => {
    expect(banner()).toContain('test:gate:m8: NOT RUN')
    expect(banner({ m8: 'ran' })).toContain('test:gate:m8: ran')
    const unrated = summarizeLedger(parsed('| F50 | x | y | z | ⬜ Open |'))
    expect(banner({ ledger: unrated, attachments: passingAttachments() })).toContain('Open rows with no rating: 1')
  })

  it('pre-flight status claims no test leg', () => {
    const text = renderStatus({ ledger: CLEAN, attachments: missingAttachments() })
    expect(text).not.toContain('AUTOMATED LEGS GREEN')
    expect(text).not.toContain('GATE PASSED')
    expect(text).toContain('no test leg has run')
  })
})

describe('the CLI, on a scratch tree', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'gate-m7-'))
  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  const padding = Array.from({ length: 600 }, (_, i) => `| F${i + 1} | x | y | z | ✅ Done |`)
  function tree(name: string, rows: string[], attachments: boolean): string {
    const root = join(scratch, name)
    const write = (rel: string, text: string) => {
      const file = join(root, rel)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
    }
    write('docs/specs/PROGRESS-leagues.md', ledgerOf(...padding, ...rows))
    if (attachments) {
      for (const a of ATTACHMENTS) write(a.path, `M7-GATE-ATTACHMENT: ${a.key} PASS\n`)
    }
    return root
  }
  function run(root: string, ...args: string[]) {
    return spawnSync('npx', ['tsx', join(REPO, 'scripts/gate-m7-evidence.ts'), ...args, '--root', root], {
      cwd: REPO,
      encoding: 'utf8',
    })
  }

  it('verdict: 3 with the attachments gone, 4 on an open S0, 0 only when all is in', () => {
    const missing = run(tree('missing', [], false), 'verdict', '--m8', 'absent')
    expect(missing.status).toBe(EXIT_ATTACHMENT_MISSING)
    expect(missing.stdout).toContain('AUTOMATED LEGS GREEN — M7 2026 GATE NOT PASSED')

    const s0 = run(tree('s0', ['| F710 | x | y | z | ⬜ Open — S0 |'], true), 'verdict', '--m8', 'absent')
    expect(s0.status).toBe(EXIT_OPEN_S0_S1)
    expect(s0.stdout).toContain('F710')

    const passed = run(tree('passed', [], true), 'verdict', '--m8', 'absent')
    expect(passed.status).toBe(EXIT_PASSED)
    expect(passed.stdout).toContain('M7 2026 GATE PASSED')
  }, 60_000)

  it('an unreadable ledger is exit 2, and so is a verdict with no --m8', () => {
    const root = join(scratch, 'empty')
    mkdirSync(root, { recursive: true })
    expect(run(root, 'status').status).toBe(EXIT_UNREADABLE)
    expect(run(tree('nom8', [], true), 'verdict').status).toBe(EXIT_UNREADABLE)
    expect(run(tree('flag', [], true), 'status', '--legs-green', 'yes').status).toBe(EXIT_UNREADABLE)
  }, 60_000)
})

describe('the real PROGRESS file', () => {
  const rows = parseLedger(readFileSync(join(REPO, 'docs/specs/PROGRESS-leagues.md'), 'utf8'))

  it('parses to the whole table', () => {
    expect(rows.length).toBeGreaterThanOrEqual(639)
  })

  it('reads a long-closed row as closed', () => {
    expect(rows.find((r) => r.id === 'F1')?.status).toBe('closed')
  })

  it('almost every row has a readable status', () => {
    expect(rows.filter((r) => r.status === 'unclassified').length).toBeLessThanOrEqual(3)
  })

  it('the fifteen rows §10 sent to review are all rated', () => {
    const reviewed = 'F50 F86 F92 F93 F144 F212 F226 F248 F256 F260 F262 F274 F275 F278 F281'.split(' ')
    for (const id of reviewed) expect(rows.find((r) => r.id === id)?.severity, id).not.toBeNull()
  })
})
