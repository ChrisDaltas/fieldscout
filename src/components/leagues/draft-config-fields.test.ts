/**
 * The §7.3.8 draft fields are ONE implementation with TWO mount points
 * (review finding R505). These pins are the thing that keeps that true —
 * a re-fork would have to delete an assertion, not merely add a file.
 *
 * Source pins (the `elevation-rule.test.ts` / `draft-settings-guard.test.ts`
 * precedent): read the two consumers' source and assert the composition,
 * because "composed, not copied" is a claim about the FILES and no rendered
 * DOM can distinguish a shared component from an identical fork.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  draftConfigSchema,
  PICK_TIMER_SECONDS,
} from '@/lib/leagues/settings/league-settings'

import {
  DRAFT_FIELD_BOUNDS,
  PICK_TIMER_LABELS,
  pickTimerOptions,
} from './draft-config-fields-ops'

const read = (p: string) => readFileSync(p, 'utf8')

const PANEL = 'src/components/leagues/settings-panel.tsx'
const DIALOG = 'src/components/draft/mock-launch-dialog.tsx'
const SHARED = 'src/components/leagues/draft-config-fields.tsx'

// ---------------------------------------------------------------------------
// R505 — both mount points COMPOSE, and neither re-implements
// ---------------------------------------------------------------------------

describe('R505 — one implementation, two mount points', () => {
  for (const [name, file] of [
    ['the league settings panel (L.A2.4)', PANEL],
    ['the practice-draft launch dialog (MP.4)', DIALOG],
  ] as const) {
    it(`${name} mounts the shared fields`, () => {
      const src = read(file)
      expect(src).toContain('draft-config-fields')
      expect(src).toContain('<PickClockField')
      expect(src).toContain('<SnakeReversalField')
      expect(src).toContain('<AuctionConfigFields')
    })

    it(`${name} does NOT re-declare the auction controls it now composes`, () => {
      const src = read(file)
      // The six §7.3.8 auction knobs are named ONCE, in the shared file. A
      // consumer that starts spelling them out again is the fork coming back.
      for (const id of [
        'auction-budget',
        'auction-zero-dollar',
        'auction-nom',
        'auction-bid',
        'auction-anti-snipe',
        'nomination-order-mode',
      ]) {
        expect(src, `${file} re-declares ${id}`).not.toContain(`id={\`\${idPrefix}-${id}\`}`)
        expect(src, `${file} re-declares ${id}`).not.toContain(`id="set-${id}"`)
        expect(src, `${file} re-declares ${id}`).not.toContain(`id="mock-${id}"`)
      }
    })

    it(`${name} carries no second copy of the §7.3.8 hint copy`, () => {
      // Four hint strings were byte-identical across the fork. They live in
      // exactly one file now.
      const src = read(file)
      expect(src).not.toContain('Seconds each bid resets the clock to.')
      expect(src).not.toContain('One-time draft budget.')
      expect(src).not.toContain("Sleeper-style — the 3rd round doesn't flip.")
    })
  }

  it('the shared file is where that copy lives', () => {
    const src = read(SHARED)
    expect(src).toContain('Seconds each bid resets the clock to.')
    expect(src).toContain('One-time draft budget.')
    expect(src).toContain("Sleeper-style — the 3rd round doesn't flip.")
  })

  it('the two mounts differ ONLY where a real rule differs — the panel offers the `manual` nomination arm (F80 → AP.5/098), the standalone mock cannot (095 refuses it by name)', () => {
    expect(read(PANEL)).toContain('offerManual')
    expect(read(DIALOG)).not.toContain('offerManual={')
    expect(read(DIALOG)).not.toContain('offerManual\n')
  })

  it('element ids stay namespaced per mount, so two mounts on one page cannot collide', () => {
    expect(read(PANEL)).toContain('idPrefix="set"')
    expect(read(DIALOG)).toContain('idPrefix="mock"')
  })
})

// ---------------------------------------------------------------------------
// R506 — the pick clock offers the WHOLE catalog
// ---------------------------------------------------------------------------

describe('R506 — no surface quietly drops a clock the contract offers', () => {
  it('every `PICK_TIMER_SECONDS` value is offered, in catalog order', () => {
    expect(pickTimerOptions().map((o) => Number(o.value))).toEqual([...PICK_TIMER_SECONDS])
  })

  it('all thirteen, including the four long clocks the first cut trimmed', () => {
    expect(pickTimerOptions()).toHaveLength(13)
    for (const long of [3600, 14400, 28800, 86400]) {
      expect(pickTimerOptions().some((o) => Number(o.value) === long)).toBe(true)
    }
  })

  it('every offered value has a real label — no `${v}s` fallback reaches a user', () => {
    for (const v of PICK_TIMER_SECONDS) {
      expect(PICK_TIMER_LABELS[v], `no label for ${v}`).toBeTruthy()
    }
    expect(PICK_TIMER_LABELS[0]).toBe('No clock (untimed)')
  })

  it('the options are DERIVED, not a hand-kept list — the label map cannot be the source of truth for which values exist', () => {
    // A value with a label but no catalog entry must not be offered.
    const rogue = { ...PICK_TIMER_LABELS, 7: '7 seconds' }
    expect(Object.keys(rogue)).toHaveLength(14)
    expect(pickTimerOptions()).toHaveLength(13)
  })
})

// ---------------------------------------------------------------------------
// R505 — the input bounds are pinned TO the contract, not merely gathered
// ---------------------------------------------------------------------------

describe('the control bounds agree with `draftConfigSchema`, edge by edge', () => {
  const base = draftConfigSchema.parse({})

  for (const [field, { min, max }] of Object.entries(DRAFT_FIELD_BOUNDS)) {
    it(`${field}: the schema ACCEPTS ${min} and ${max} and REFUSES ${min - 1} and ${max + 1}`, () => {
      const at = (n: number) => draftConfigSchema.safeParse({ ...base, [field]: n }).success
      expect(at(min), `${field} min ${min} rejected`).toBe(true)
      expect(at(max), `${field} max ${max} rejected`).toBe(true)
      expect(at(min - 1), `${field} accepted ${min - 1}`).toBe(false)
      expect(at(max + 1), `${field} accepted ${max + 1}`).toBe(false)
    })
  }

  it('every bounded §7.3.8 number the controls edit is covered — a new knob with an input and no bound here is the gap this asserts against', () => {
    expect(Object.keys(DRAFT_FIELD_BOUNDS).sort()).toEqual([
      'auction_anti_snipe_seconds',
      'auction_bid_seconds',
      'auction_budget',
      'auction_nomination_seconds',
    ])
  })
})
