import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * **The practice surfaces are launch-facing** (MP task MP.10; tasks-MP §4
 * rule 14; CLAUDE.md's 2026 go-live block). Two source-level pins for the two
 * drifts MP.10 measured in a browser, in the `more-lists.test.ts` /
 * `one-voice.test.ts` idiom — read the source text, assert against it —
 * because both defects are invisible to a unit test of the pure layer and
 * both are one careless edit away from returning.
 *
 * **PIN 1 — a list of identical rows is not a list.** Every `MockRow` printed
 * the constant *"Practice draft"*. At the §22.5 three-active cap that is three
 * rows with the same title, two of them with the same progress line, and
 * nothing on screen separating a 12-team snake from an 8-team auction —
 * measured on the local stack, and the exact thing Chris's use case (*"practice
 * drafting these players at these rounds or cost"*) needs to compare. The row
 * now derives its identity from data it already carries (`mockIdentityLabel`,
 * pinned for value in `mock-launcher-ops.test.ts`). **A value pin alone could
 * not catch this** — reverting the JSX to the constant leaves every ops
 * assertion green, which is the F104/R513 species, so the pin has to be here.
 *
 * **PIN 2 — a practice surface names itself on a phone.** `AppHeader` is
 * `hidden lg:block` (`app-shell.tsx`), so below `lg` the page title is gone.
 * `/app/lists` — the 2026 launch scope's own reskinned page — answers that
 * with `<h3 className="mr-auto text-h5">Lists</h3>` inside its `lg:hidden`
 * action row (`lists-page-v2.tsx`). The practice home and the report shipped
 * that row WITHOUT the title, so at 375px `/app/mocks` opened on a bare blue
 * button and the report on an unlabelled *Delete report*. The pattern was not
 * the drift; these two surfaces were.
 */

const DRAFT_DIR = 'src/components/draft'

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments removed — these files DISCUSS the retired copy at
 *  length, and a pin a comment can satisfy (or redden) pins nothing
 *  (`one-voice.test.ts`'s rule, R513/R514's species). */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('MP.10 pin 1 — the row says which practice draft it is', () => {
  const row = code(`${DRAFT_DIR}/mock-draft-launcher.tsx`)

  it('`MockRow` renders the derived identity', () => {
    expect(row).toContain('{mockIdentityLabel(row, seatCount)}')
  })

  it('…and carries no constant row title in its place', () => {
    // The defect, spelled exactly as it shipped. `Practice draft` survives in
    // this file as a PageHeader title and inside toast/aria copy, so the
    // assertion is the JSX text node this replaced, not the phrase.
    expect(row).not.toContain('leading-tight">Practice draft<')
  })
})

describe('MP.10 pin 2 — a practice surface names itself below `lg`', () => {
  // The shell header is `hidden lg:block`, so each of these carries the page
  // name in its own `lg:hidden` row. Asserted per file, with the element and
  // the tokens `/app/lists` uses, so a title dropped from one of them is a
  // named failure rather than a silently unlabelled phone screen.
  const SURFACES: { file: string; title: string }[] = [
    { file: 'mocks-home.tsx', title: 'Mock drafts' },
    { file: 'mock-report.tsx', title: 'Mock draft report' },
  ]

  for (const { file, title } of SURFACES) {
    it(`${file} prints "${title}" at mobile widths`, () => {
      const source = code(`${DRAFT_DIR}/${file}`)
      expect(source).toContain('lg:hidden')
      expect(source).toMatch(
        new RegExp(`<h3 className="[^"]*text-h5[^"]*">${title}</h3>`),
      )
    })
  }

  it('the report names itself in its NON-body states too (loading · error · not-here)', () => {
    // All three render through `ReportShell`; the LOADING arm used to build
    // its own frame and so lost the title with the rest of it.
    const source = code(`${DRAFT_DIR}/mock-report.tsx`)
    expect(source).toMatch(/function ReportShell\b[\s\S]*?lg:hidden/)

    // SLICED, not regexed across the file. The first cut asserted
    // `/if \(room\.isPending\) \{[\s\S]*?<ReportShell>/` and stayed GREEN with
    // the loading arm's own frame reinstated, because the lazy `[\s\S]*?`
    // simply ran on to the ERROR arm's `<ReportShell>` — a pin that could not
    // fail for its stated reason (R513's species), caught by the break probe
    // it was written for. The arm is cut out and asserted on its own instead.
    const start = source.indexOf('if (room.isPending)')
    const end = source.indexOf('if (room.isError)')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const loadingArm = source.slice(start, end)
    expect(loadingArm).toContain('<ReportShell>')
    expect(loadingArm).not.toContain('<PageHeader')
  })
})
