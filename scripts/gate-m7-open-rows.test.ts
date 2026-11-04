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
  EXIT_EVIDENCE_MISSING,
  EXIT_LEG_FAILED,
  EXIT_OPEN_S0_S1,
  EXIT_PASSED,
  EXIT_UNREADABLE,
  GATE_STAGES,
  LedgerParseError,
  MUST_BE_CLOSED,
  RATING_OWED,
  S01_TEXT_ALLOWLIST,
  SECTION_10_ROWS,
  classifyStatus,
  exitCodeOf,
  judgeAttachment,
  judgeStamps,
  parseLedger,
  readSeverity,
  readUnreadableMark,
  renderBanner,
  renderStatus,
  stampFile,
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

/** F861 closed and F273 / F859 / F860 rated: what exit 0 needs from the ledger (R1759). */
const SETTLED = [
  '| F273 | x | y | z | ⬜ Open **[Severity S3 — fixture]** |',
  '| F859 | x | y | z | ⬜ Open **[Severity S3 — fixture]** |',
  '| F860 | x | y | z | ✅ Done |',
  '| F861 | x | y | z | ✅ Done |',
]

function attachmentText(key: string): string {
  const ruling = key === 'C4' ? 'M7-GATE-RULING: C4 2026-12-01 Chris: "it counts"\n' : ''
  return `M7-GATE-ATTACHMENT: ${key} PASS\n${ruling}`
}

function passingAttachments(): AttachmentFinding[] {
  return ATTACHMENTS.map((spec) => judgeAttachment(spec, attachmentText(spec.key)))
}

function missingAttachments(): AttachmentFinding[] {
  return ATTACHMENTS.map((spec) => judgeAttachment(spec, null))
}

const CLEAN = summarizeLedger(parsed('| F1 | done row | x | y | ✅ Done 2026-09-07 |', ...SETTLED))
const COMMIT = { sha: 'abc1234', dirty: false }

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

describe('an S0 / S1 no mark can read fails, it never reads as unrated (R1760)', () => {
  it.each([
    ['plain text', '🟡 Partial — S1', 'S1'],
    ['plain text', '⏳ Open — S0', 'S0'],
    ['plain text', '⬜ Open (S1)', 'S1'],
    ['plain text', '⬜ Open · S0', 'S0'],
    ['plain text', '⬜ Open **[S1 — review]**', 'S1'],
    ['plain text', '⬜ Open [Severity: S0]', 'S0'],
    ['plain text', '⬜ Open [severity S0]', 'S0'],
    ['plain text', '⬜ Open Severity S1', 'S1'],
    ['plain text', '⬜ Open — **rated S1**', 'S1'],
    ['A title **[S0]** y', '⬜ Open', 'S0'],
    ['**S0 — x** y', '⬜ Open', 'S0'],
  ])('%s + %s fails by name as %s', (obligation, status, want) => {
    expect(readSeverity(obligation, status)).toBeNull()
    const row = one(`| F1000 | ${obligation} | y | z | ${status} |`)
    expect(row).toMatchObject({ status: 'open', severity: null, unreadableMark: want })
    const summary = summarizeLedger([row])
    expect(summary.failing.map((r) => r.id)).toEqual(['F1000'])
    expect(summary.unreadable.map((r) => r.id)).toEqual(['F1000'])
    expect(summary.unrated).toEqual([])
    expect(exitCodeOf({ ledger: summary, attachments: passingAttachments(), legsGreen: true })).toBe(EXIT_OPEN_S0_S1)
    expect(
      renderBanner({ ledger: summary, attachments: passingAttachments(), legsGreen: true, m8: 'absent', elapsedSeconds: 1, commit: COMMIT }),
    ).toContain(`F1000 [${want} in its text, no mark reads it]`)
  })

  it('a milder rating beside the words does not settle them', () => {
    expect(readUnreadableMark('F1000', 'plain', '⬜ Open — S3 (S1)')).toBe('S1')
    expect(summarizeLedger([one('| F1000 | plain | y | z | ⬜ Open — S3 (S1) |')]).failing.map((r) => r.id)).toEqual(['F1000'])
  })

  it('a mark that reads it is enough, S2 / S3 text means nothing, struck text does not count', () => {
    expect(readUnreadableMark('F1000', '**[S0 — x]** text says S0', '⬜ Open')).toBeNull()
    expect(readUnreadableMark('F1000', 'plain', '⬜ Open — S1 and S1 again')).toBeNull()
    expect(readUnreadableMark('F1000', 'never mints a (S2, week 1) row', '⬜ Open — S3')).toBeNull()
    expect(readUnreadableMark('F1000', 'plain', '~~⬜ Open — S1~~ ⬜ Open **[Severity S3 — re-rated]**')).toBeNull()
  })

  it('a closed row is not read at all', () => {
    expect(summarizeLedger([one('| F1000 | **[S1 while it happens — FIXED]** x | y | z | ✅ Done (S0 was fixed) |')]).failing).toEqual([])
  })

  it('the allowlist is by id: F778, F761, F861 and no one else', () => {
    expect(Object.keys(S01_TEXT_ALLOWLIST).sort()).toEqual(['F761', 'F778', 'F861'])
    const quoting = 'with its TD6 severity (S0 = wrong score / S1 = …)'
    for (const id of ['F778', 'F761', 'F861']) expect(readUnreadableMark(id, quoting, '⬜ Open')).toBeNull()
    expect(readUnreadableMark('F762', quoting, '⬜ Open')).toBe('S0')
  })
})

describe('exit 0 is held back on F861 and the three owed ratings (R1759)', () => {
  const held = (...rows: string[]) => summarizeLedger(parsed(...rows)).withheld.map((w) => w.id)

  it('names exactly those four', () => {
    expect([...MUST_BE_CLOSED, ...RATING_OWED]).toEqual(['F861', 'F273', 'F859', 'F860'])
  })

  it('all answered holds nothing back', () => {
    expect(held(...SETTLED)).toEqual([])
  })

  it('F861 open: exit 3, named, whatever else is clean', () => {
    const ledger = summarizeLedger(parsed(...SETTLED.filter((r) => !r.startsWith('| F861')), '| F861 | x | y | z | ⬜ Open |'))
    expect(ledger.withheld.map((w) => w.id)).toEqual(['F861'])
    expect(exitCodeOf({ ledger, attachments: passingAttachments(), legsGreen: true })).toBe(EXIT_EVIDENCE_MISSING)
    const text = renderBanner({ ledger, attachments: passingAttachments(), legsGreen: true, m8: 'absent', elapsedSeconds: 1, commit: COMMIT })
    expect(text).toContain('AUTOMATED LEGS GREEN — M7 2026 GATE NOT PASSED')
    expect(text).toContain('exit 0 held back: F861')
    expect(text).toContain('a rating is owed')
    expect(text).not.toContain('GATE PASSED')
  })

  it.each(['F273', 'F859', 'F860'])('%s open with no rating: exit 3, named', (id) => {
    const rows = [...SETTLED.filter((r) => !r.startsWith(`| ${id}`)), `| ${id} | x | y | z | ⬜ Open |`]
    const ledger = summarizeLedger(parsed(...rows))
    expect(ledger.withheld.map((w) => w.id)).toEqual([id])
    expect(exitCodeOf({ ledger, attachments: passingAttachments(), legsGreen: true })).toBe(EXIT_EVIDENCE_MISSING)
  })

  it('a row gone from the ledger holds it back too, and rating or closing releases it', () => {
    expect(held('| F1 | x | y | z | ✅ Done |')).toEqual(['F861', 'F273', 'F859', 'F860'])
    expect(held(...SETTLED.filter((r) => !r.startsWith('| F273')), '| F273 | x | y | z | ✅ Done |')).toEqual([])
  })

  it('an open S0 still outranks it', () => {
    const ledger = summarizeLedger(parsed('| F273 | x | y | z | ⬜ Open — S0 |', '| F859 | x | y | z | ⬜ Open |'))
    expect(exitCodeOf({ ledger, attachments: passingAttachments(), legsGreen: true })).toBe(EXIT_OPEN_S0_S1)
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

  it('a fence with ~~~, an indented fence, or an HTML comment hides a PASS (R1764)', () => {
    const hidden = (text: string) => judgeAttachment(spec, text).state
    expect(hidden(`~~~\n${line} PASS\n~~~\n`)).toBe('no-verdict')
    expect(hidden(`~~~~\n~~~\n${line} PASS\n~~~~\n`)).toBe('no-verdict')
    expect(hidden(`  \`\`\`\n${line} PASS\n  \`\`\`\n`)).toBe('no-verdict')
    expect(hidden(`    \`\`\`\n${line} PASS\n`)).toBe('no-verdict')
    expect(hidden(`\`\`\`\n~~~\n${line} PASS\n`)).toBe('no-verdict')
    expect(hidden(`<!-- ${line} PASS -->\n`)).toBe('no-verdict')
    expect(hidden(`<!--\n${line} PASS\n-->\n`)).toBe('no-verdict')
    expect(hidden(`<!-- open, never closed\n${line} PASS\n`)).toBe('no-verdict')
    // And the line outside them still counts.
    expect(hidden(`~~~\nexample\n~~~\n<!-- note -->\n${line} PASS\n`)).toBe('pass')
    expect(hidden(`<!--\nnote\n-->\n${line} PASS\n`)).toBe('pass')
  })

  it("C4's PASS needs a dated ruling on the line beside it (R1765)", () => {
    const c4 = ATTACHMENTS.find((a) => a.key === 'C4')!
    const pass = 'M7-GATE-ATTACHMENT: C4 PASS'
    const ruling = 'M7-GATE-RULING: C4 2026-12-01 Chris: "it counts"'
    expect(judgeAttachment(c4, `${pass}\n`).state).toBe('no-ruling')
    expect(judgeAttachment(c4, `${pass}\n${ruling}\n`).state).toBe('pass')
    expect(judgeAttachment(c4, `${ruling}\n\n${pass}\n`).state).toBe('pass')
    // Not dated, not a real date, no words, not beside it, or only in a fence.
    expect(judgeAttachment(c4, `${pass}\nM7-GATE-RULING: C4 Chris: "it counts"\n`).state).toBe('no-ruling')
    expect(judgeAttachment(c4, `${pass}\nM7-GATE-RULING: C4 2026-13-45 Chris\n`).state).toBe('no-ruling')
    expect(judgeAttachment(c4, `${pass}\nM7-GATE-RULING: C4 2026-12-01\n`).state).toBe('no-ruling')
    expect(judgeAttachment(c4, `${pass}\nsome prose\n${ruling}\n`).state).toBe('no-ruling')
    expect(judgeAttachment(c4, `${pass}\n\`\`\`\n${ruling}\n\`\`\`\n`).state).toBe('no-ruling')
    // And no attachment but C4 asks for one.
    expect(judgeAttachment(spec, `${line} PASS\n`).state).toBe('pass')
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
    expect(exitCodeOf({ ledger: CLEAN, attachments: missingAttachments(), legsGreen: true })).toBe(EXIT_EVIDENCE_MISSING)
    expect(exitCodeOf({ ledger: openS0, attachments: passingAttachments(), legsGreen: true })).toBe(EXIT_OPEN_S0_S1)
  })

  it('one missing attachment of three is enough', () => {
    for (let i = 0; i < 3; i++) {
      const attachments = passingAttachments()
      attachments[i] = judgeAttachment(attachments[i]!.spec, null)
      expect(exitCodeOf({ ledger: CLEAN, attachments, legsGreen: true })).toBe(EXIT_EVIDENCE_MISSING)
    }
  })

  it('an open S0 outranks a missing attachment', () => {
    expect(exitCodeOf({ ledger: openS0, attachments: missingAttachments(), legsGreen: true })).toBe(EXIT_OPEN_S0_S1)
  })

  it('the exit codes are distinct from a test failure', () => {
    expect(new Set([EXIT_PASSED, EXIT_LEG_FAILED, EXIT_UNREADABLE, EXIT_EVIDENCE_MISSING, EXIT_OPEN_S0_S1]).size).toBe(5)
  })

  const banner = (over: Partial<Parameters<typeof renderBanner>[0]> = {}) =>
    renderBanner({ ledger: CLEAN, attachments: missingAttachments(), legsGreen: true, m8: 'absent', elapsedSeconds: 7, commit: COMMIT, ...over })

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

  it('every banner names the commit and whether the tree was dirty (R1765)', () => {
    expect(banner()).toContain('Commit: abc1234 (clean)')
    expect(banner({ attachments: passingAttachments() })).toContain('Commit: abc1234 (clean)')
    expect(banner({ legsGreen: false })).toContain('Commit: abc1234 (clean)')
    expect(banner({ commit: { sha: 'abc1234', dirty: true } })).toContain('Commit: abc1234 (DIRTY')
  })

  it('every banner says where §9 and §10 stand (R1766)', () => {
    for (const text of [banner(), banner({ attachments: passingAttachments() }), banner({ legsGreen: false })]) {
      expect(text).toContain('tasks-M7 §9, the exit criteria:')
      expect(text).toContain('criterion 1, L.F2.2:')
      expect(text).toContain('criterion 3, zero S0/S1:')
      expect(text).toContain('criterion 4, C4:')
      expect(text).toContain('tasks-M7 §10, the 15 severity reviews:')
    }
    const reviewed = summarizeLedger(parsed('| F256 | x | y | z | ⬜ Open **[Severity S0 — part (b)]** |', '| F50 | x | y | z | ⬜ Open **[Severity S2 — x]** |'))
    const text = banner({ ledger: reviewed })
    expect(text).toContain('the 15 severity reviews: 2 rated; open at S0/S1: F256')
    expect(SECTION_10_ROWS).toHaveLength(15)
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

  const padding = Array.from({ length: 600 }, (_, i) => `| F${i + 1} | x | y | z | ✅ Done |`).filter((r) => !r.startsWith('| F273 '))
  const gitEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'test' as const }
  function git(root: string, ...args: string[]) {
    return spawnSync('git', ['-C', root, '-c', 'user.name=gate', '-c', 'user.email=gate@example.test', ...args], { encoding: 'utf8', env: gitEnv })
  }
  /** A real checkout with one commit, so `verdict` has a HEAD to name. Returns the SHA. */
  function checkout(root: string): string {
    git(root, 'init', '-q')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '--allow-empty', '-m', 'fixture')
    return git(root, 'rev-parse', 'HEAD').stdout.trim()
  }
  function stamp(root: string, sha: string, stages: readonly number[] = GATE_STAGES) {
    mkdirSync(join(root, '.gate-m7'), { recursive: true })
    for (const stage of stages) writeFileSync(join(root, '.gate-m7', stampFile(stage)), `${sha}\n`)
  }
  /** Ignore the stamp directory, as the real repo's .gitignore does. */
  function checkedOutAndStamped(root: string): string {
    writeFileSync(join(root, '.gitignore'), '/.gate-m7/\n')
    const sha = checkout(root)
    stamp(root, sha)
    return root
  }
  function tree(name: string, rows: string[], attachments: boolean, settled: string[] = SETTLED): string {
    const root = join(scratch, name)
    const write = (rel: string, text: string) => {
      const file = join(root, rel)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
    }
    write('docs/specs/PROGRESS-leagues.md', ledgerOf(...padding, ...settled, ...rows))
    if (attachments) {
      for (const a of ATTACHMENTS) write(a.path, attachmentText(a.key))
    }
    return root
  }
  function run(root: string, ...args: string[]) {
    return spawnSync('npx', ['tsx', join(REPO, 'scripts/gate-m7-evidence.ts'), ...args, '--root', root], {
      cwd: REPO,
      encoding: 'utf8',
      env: gitEnv,
    })
  }

  it('verdict: 3 with the attachments gone, 4 on an open S0, 0 only when all is in', () => {
    const missing = run(checkedOutAndStamped(tree('missing', [], false)), 'verdict', '--m8', 'absent')
    expect(missing.status).toBe(EXIT_EVIDENCE_MISSING)
    expect(missing.stdout).toContain('AUTOMATED LEGS GREEN — M7 2026 GATE NOT PASSED')

    const s0 = run(checkedOutAndStamped(tree('s0', ['| F710 | x | y | z | ⬜ Open — S0 |'], true)), 'verdict', '--m8', 'absent')
    expect(s0.status).toBe(EXIT_OPEN_S0_S1)
    expect(s0.stdout).toContain('F710')

    const passed = run(checkedOutAndStamped(tree('passed', [], true)), 'verdict', '--m8', 'absent')
    expect(passed.status).toBe(EXIT_PASSED)
    expect(passed.stdout).toContain('M7 2026 GATE PASSED')
    expect(passed.stdout).toMatch(/Commit: [0-9a-f]{40} \(clean\)/)
  }, 60_000)

  it('verdict by hand refuses, exit 2, with no leg on record for HEAD (R1761)', () => {
    const unstamped = tree('unstamped', [], true)
    checkout(unstamped)
    const none = run(unstamped, 'verdict', '--m8', 'absent')
    expect(none.status).toBe(EXIT_UNREADABLE)
    expect(none.stderr).toContain('not on record')
    expect(none.stdout).not.toContain('GATE PASSED')
    expect(none.stdout).not.toContain('AUTOMATED LEGS GREEN')

    const partial = tree('partial', [], true)
    stamp(partial, checkout(partial), [1, 2, 3, 4, 5])
    const five = run(partial, 'verdict', '--m8', 'absent')
    expect(five.status).toBe(EXIT_UNREADABLE)
    expect(five.stderr).toContain('stage 6/7 has no stamp')

    const stale = tree('stale', [], true)
    checkout(stale)
    stamp(stale, 'a-different-commit')
    const old = run(stale, 'verdict', '--m8', 'absent')
    expect(old.status).toBe(EXIT_UNREADABLE)
    expect(old.stderr).toContain('stamped for a-different-commit')

    const notRepo = tree('notrepo', [], true)
    const noGit = run(notRepo, 'verdict', '--m8', 'absent')
    expect(noGit.status).toBe(EXIT_UNREADABLE)
    expect(noGit.stdout).not.toContain('GATE PASSED')
  }, 60_000)

  it('the verdict shows a dirty tree', () => {
    const root = checkedOutAndStamped(tree('dirty', [], true))
    writeFileSync(join(root, 'uncommitted.txt'), 'x')
    const res = run(root, 'verdict', '--m8', 'absent')
    expect(res.status).toBe(EXIT_PASSED)
    expect(res.stdout).toContain('(DIRTY')
  }, 60_000)

  it('F861 open: 3 by name, with every attachment in and every leg stamped (R1759)', () => {
    const settled = SETTLED.map((r) => (r.startsWith('| F861') ? '| F861 | x | y | z | ⬜ Open |' : r))
    const res = run(checkedOutAndStamped(tree('f861', [], true, settled)), 'verdict', '--m8', 'absent')
    expect(res.status).toBe(EXIT_EVIDENCE_MISSING)
    expect(res.stdout).toContain('exit 0 held back: F861')
    expect(res.stdout).not.toContain('GATE PASSED')
  }, 60_000)

  it('an unreadable ledger is exit 2, and so is a verdict with no --m8', () => {
    const root = join(scratch, 'empty')
    mkdirSync(root, { recursive: true })
    expect(run(root, 'status').status).toBe(EXIT_UNREADABLE)
    expect(run(tree('nom8', [], true), 'verdict').status).toBe(EXIT_UNREADABLE)
    expect(run(tree('flag', [], true), 'status', '--legs-green', 'yes').status).toBe(EXIT_UNREADABLE)
  }, 60_000)
})

describe('judgeStamps', () => {
  const all = () => 'head\n'

  it('needs all six stages, each for HEAD', () => {
    expect(GATE_STAGES).toEqual([1, 2, 3, 4, 5, 6])
    expect(judgeStamps('head', all)).toEqual([])
    expect(judgeStamps('head', (s) => (s === 4 ? null : 'head'))).toEqual(['stage 4/7 has no stamp'])
    expect(judgeStamps('head', (s) => (s === 6 ? 'other' : 'head'))).toEqual(['stage 6/7 is stamped for other'])
    expect(judgeStamps('head', (s) => (s === 1 ? '' : 'head'))).toEqual(['stage 1/7 is stamped for nothing'])
  })
})

describe('the real PROGRESS file', () => {
  const rows = parseLedger(readFileSync(join(REPO, 'docs/specs/PROGRESS-leagues.md'), 'utf8'))
  const summary = summarizeLedger(rows)

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
    for (const id of SECTION_10_ROWS) expect(rows.find((r) => r.id === id)?.severity, id).not.toBeNull()
  })

  it('F273, F859 and F860 are rated (or closed) and nothing else holds exit 0 back but F861', () => {
    for (const id of RATING_OWED) {
      const row = rows.find((r) => r.id === id)!
      expect(row.status === 'closed' || row.severity !== null, id).toBe(true)
    }
    const f861Open = rows.find((r) => r.id === 'F861')?.status !== 'closed'
    expect(summary.withheld.map((w) => w.id)).toEqual(f861Open ? ['F861'] : [])
  })

  it('no open row says S0 / S1 in a spelling the marks cannot read', () => {
    expect(summary.unreadable.map((r) => r.id)).toEqual([])
    expect(summary.failing.filter((r) => r.unreadableMark).map((r) => r.id)).toEqual([])
  })

  it('L.F2.7\'s four S0 rows are closed (F778)', () => {
    for (const id of ['F710', 'F711', 'F712', 'F713', 'F778']) {
      expect(rows.find((r) => r.id === id)?.status, id).toBe('closed')
    }
  })
})
