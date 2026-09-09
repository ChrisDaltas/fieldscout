import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The Home practice entry — MP.7 (spec v2.16 §8.8; rulings §3.4 / §3.8;
 * D229, D231).
 *
 * Three claims, each of which fails silently if it breaks, and two of which
 * are invisible in local development because flags default ON there:
 *
 *  1. **The Mock chip is gated on `featureFlags.mockDrafts` and NOTHING
 *     else.** A later editor folding it into the `leagues` block above it —
 *     they are adjacent, and three of the four chips live there — would
 *     re-couple practice to the league product's release (D231(1)/(2)), and
 *     nothing would show it until a deploy with `leagues` off.
 *  2. **With `mockDrafts` off, this header is what it was before MP.7.**
 *     Pinned as an inventory: exactly one chip renders outside both gated
 *     blocks, and it is List.
 *  3. **ONE launch dialog** (MP.7 item 3). Home composes `MockLaunchDialog`
 *     at its shipped definition and brings no settings controls of its own.
 *
 * Source-level pins, for the reason `route-groups.test.ts` and
 * `launch-scope-gates.test.ts` give: these are `.tsx` under Next's
 * `jsx: "preserve"`, so Vite cannot import them and there is no renderer in
 * this repo. The point is that the SHAPE exists, not that it paints.
 */

const HOME_CHIPS = 'src/components/home/home-quick-actions.tsx'

function read(rel: string) {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/**
 * Source with comments removed. Every pin below runs through this, because
 * this file's docblock DISCUSSES both flags precisely in order to state the
 * distinction between them — a pin a prose mention can satisfy (or break) is
 * not pinning the code. (`route-groups.test.ts`'s `code()`, same argument.)
 */
function code(rel: string) {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/**
 * The balanced body of `{featureFlags.<flag> && ( … )}`.
 *
 * Brace/paren-balanced rather than "everything between two string indexes",
 * because ordering alone is not structure: a chip written after the
 * `mockDrafts` gate but inside the `leagues` block still reads as "after" to
 * an index comparison, and that is exactly the defect these pins exist to
 * catch. Throws when the gate is missing, so deleting a gate reddens here
 * rather than quietly emptying the block it guards.
 */
function gatedBlock(source: string, flag: string): string {
  const marker = `featureFlags.${flag} && (`
  const at = source.indexOf(marker)
  if (at === -1) throw new Error(`no \`${marker}\` gate in the source`)
  const open = at + marker.length - 1
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error(`unbalanced \`${marker}\` gate`)
}

/** Every `<ActionChip label="X">` in a stretch of source, in order. */
function chipLabels(source: string): string[] {
  return [...source.matchAll(/label="([^"]+)"/g)].map((m) => m[1])
}

describe('the Home practice entry is released on the mockDrafts flag (MP.7 / D231)', () => {
  it('the Mock chip and its dialog live inside the mockDrafts gate', () => {
    const block = gatedBlock(code(HOME_CHIPS), 'mockDrafts')
    expect(chipLabels(block)).toEqual(['Mock'])
    expect(block, 'the dialog is gated with the chip that opens it').toContain(
      'MockLaunchDialog',
    )
  })

  it('the leagues gate holds both league chips and NEITHER half of the mock entry', () => {
    // Asserted by name so the negative below is meaningful — the block is
    // non-empty and is the one we think it is. (Until 2026-09-09 these were
    // stubs and this comment pinned MP.7 item 5: not "fixed" on the way past.
    // They are real now, fixed deliberately rather than in passing, and the
    // gate assertion is unchanged.)
    const block = gatedBlock(code(HOME_CHIPS), 'leagues')
    expect(chipLabels(block)).toEqual(['Join', 'League'])
    expect(block).not.toContain('MockLaunchDialog')
  })

  it('with mockDrafts OFF the header is what it was before MP.7', () => {
    // The inventory form of "byte-identical to today": whatever the gated
    // blocks hold, exactly ONE chip renders outside them, and it is the
    // un-gated List chip that has always been there.
    const source = code(HOME_CHIPS)
    // The component's own body, not the file: the imports name the dialog
    // whatever the flag says, and an import renders nothing.
    let outside = source.slice(source.indexOf('export function HomeQuickActions'))
    for (const flag of ['leagues', 'mockDrafts']) {
      outside = outside.replace(gatedBlock(source, flag), '')
    }
    expect(chipLabels(outside)).toEqual(['List'])
    expect(outside).not.toContain('MockLaunchDialog')
  })

  it('never gates the mock entry on the leagues flag, in any statement', () => {
    // The narrow form R519 arrived at on `/app/mocks`: what must not exist is
    // a leagues-flag GATE over practice. Here there is no legitimate read at
    // all — the leagues chips are the flag's own surfaces — so the whole file
    // carries exactly one, and it is the one that gates Join and League.
    const source = code(HOME_CHIPS)
    expect((source.match(/featureFlags\.leagues/g) ?? []).length).toBe(1)
    expect((source.match(/featureFlags\.mockDrafts/g) ?? []).length).toBe(1)
  })
})

describe('ONE launch dialog, and Home lands the launcher in the room (MP.7 items 2–3)', () => {
  it('composes the shipped MockLaunchDialog and defines no second one', () => {
    expect(code(HOME_CHIPS)).toContain(
      "import { MockLaunchDialog } from '@/components/draft/mock-launch-dialog'",
    )
    // The declaration is unique in the tree, so "compose, do not fork" is a
    // measurement rather than a habit.
    const declared = tsxFiles('src').filter((rel) =>
      read(rel).includes('export function MockLaunchDialog'),
    )
    expect(declared).toEqual(['src/components/draft/mock-launch-dialog.tsx'])
  })

  it('brings no settings surface of its own', () => {
    // The other half of "one dialog": a mount that starts importing the
    // settings controls is building the second editor by accretion, which is
    // the LV.7 failure pattern MP.4's docblock names.
    const source = code(HOME_CHIPS)
    for (const forked of [
      'settings-form-controls',
      'RosterSlotBuilder',
      'ScoringTemplatePicker',
      'draft-config-fields',
      'mock-launch-ops',
    ]) {
      expect(source, forked).not.toContain(forked)
    }
  })

  it('routes to the room through the shared href builder, never a hand-rolled URL', () => {
    const source = code(HOME_CHIPS)
    expect(source).toContain(
      "import { mockRoomHref } from '@/components/draft/mock-launcher-entry'",
    )
    expect(source).toMatch(/router\.push\(mockRoomHref\(/)
    expect(source, 'no second source of truth for the room URL').not.toContain('/app/mocks/')
  })
})

/** Every `.tsx` under a directory, as repo-relative paths. */
function tsxFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.resolve(process.cwd(), dir))) {
      const rel = `${dir}/${entry}`
      if (statSync(path.resolve(process.cwd(), rel)).isDirectory()) walk(rel)
      else if (entry.endsWith('.tsx')) out.push(rel)
    }
  }
  walk(root)
  return out
}
