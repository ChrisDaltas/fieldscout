import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  activeFranchises,
  auctionTimerPayload,
  budgetEditPreview,
  endDraftConsequences,
  priceEntry,
  unfilledSlotsAtEnd,
  AUCTION_TIMER_RANGES,
  END_CONFIRM_WORD,
} from './commish-auction-ops'
import { PAUSE_FIRST_CLAUSE, pauseFirstGate } from './commish-panel-ops'
import {
  AUCTION_DRAFT_OPTIONS_ENTRIES,
  DRAFT_OPTIONS_ENTRIES,
  NOT_PAUSE_FIRST_SECTIONS,
  PAUSE_FIRST_RPC_SECTIONS,
  PAUSE_FIRST_SECTIONS,
  type DraftOptionsSectionId,
} from './draft-options-ops'

/**
 * Pins for the AUCTION commissioner sections (M3 task L.C3.2; spec §8.7's
 * v2.10 auction rows + C41's End-as-is; D141/D142/D143; E28) and for **F72's
 * remaining half** — the pause-first DISABLED STATES, for BOTH draft types.
 *
 * Three kinds of pin, in descending order of what they buy:
 *
 *  1. **The engine cross-check.** The disabled-states rule is a claim ABOUT
 *     the SQL, so it is checked against the SQL: the suite parses the whole
 *     migration chain, takes the HEAD body of every function (the D137 rule —
 *     newest definition wins, never `pg_get_functiondef`), and asserts that
 *     the set of functions calling `draft_auction_pause_gate_internal` is
 *     exactly the set `PAUSE_FIRST_RPC_SECTIONS` maps to UI groups — and that
 *     the gate's head predicate is type-NEUTRAL (migration 090, F57 ALIGN).
 *     A future migration that gates a seventh verb, or ungates one, fails
 *     here instead of shipping a control that lies.
 *  2. **Ops goldens** as stored literals — the budget projection's three E28
 *     arms with their boundary dollar, the cost re-entry box, End's
 *     consequence list.
 *  3. **Source pins** for the three things a UI-layer regression would break
 *     silently: every pause-first control carries `gate.blocked`, the budget
 *     editor cannot double-submit (087's delta is CUMULATIVE and takes no
 *     `action_id`), and End cannot fire on one click.
 */

const PANEL = 'src/components/draft/commish-draft-panel.tsx'
const SETTINGS = 'src/components/leagues/settings-panel.tsx'
const MIGRATIONS = 'supabase/migrations'
const GATE = 'draft_auction_pause_gate_internal'

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments removed — a pin a comment can satisfy is not a pin
 *  (the `draft-options-menu.test.ts` idiom). */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/**
 * Every function in the chain at its HEAD definition (D137: the newest
 * migration that defines a name is the one that governs; migrations are
 * applied in filename order, so last write wins).
 */
function headBodies(): Map<string, { file: string; body: string }> {
  const dir = path.resolve(process.cwd(), MIGRATIONS)
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const head = new Map<string, { file: string; body: string }>()
  for (const file of files) {
    const text = readFileSync(path.join(dir, file), 'utf8')
    const re = /CREATE(?: OR REPLACE)? FUNCTION\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(/g
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const end = text.indexOf('\n$$;', match.index)
      head.set(match[1], {
        file,
        body: end === -1 ? text.slice(match.index) : text.slice(match.index, end),
      })
    }
  }
  return head
}

/** The panel body of one section component, so a pin cannot be satisfied by
 *  a sibling section's code. */
function sectionSource(component: string): string {
  const source = code(PANEL)
  const start = source.indexOf(`function ${component}(`)
  expect(start, `section not found: ${component}`).toBeGreaterThan(-1)
  const next = source.indexOf('\nfunction ', start + 1)
  return next === -1 ? source.slice(start) : source.slice(start, next)
}

/**
 * R437: every `<Button …>…</Button>` in a section, individually — the
 * per-SECTION pin below it was satisfied by whichever button happened to
 * carry the gate, which is how three dialog confirms (Undo, Manual Edit's
 * two, Cancel nomination) shipped ungated inside gated sections.
 */
function buttonsIn(component: string): string[] {
  return sectionSource(component)
    .split('<Button')
    .slice(1)
    .map((chunk) => {
      const end = chunk.indexOf('</Button>')
      return end === -1 ? chunk : chunk.slice(0, end)
    })
}

/**
 * Buttons in a pause-first section that legitimately do NOT carry the gate,
 * with the reason each is exempt. Anything else in one of those sections can
 * reach a pause-first RPC and must be disabled with it.
 */
const GATE_EXEMPT_ONCLICK: ReadonlyArray<{ needle: string; why: string }> = [
  // Pause/Resume is the gate's OWN verb — gating it would make a running
  // draft unpausable, i.e. would make every other control unreachable.
  { needle: 'pauseResume', why: 'the verb that lifts the gate' },
  // Pure client state: arm the mode, pick a branch, open/close a dialog.
  { needle: 'onClick={() => setArmed(', why: 'toggles Manual Edit Mode' },
  { needle: "onClick={() => setChoice('", why: "the modal's two choices" },
  { needle: 'onClick={() => setOpen(true)}', why: 'opens a confirm dialog' },
  { needle: 'onClick={() => setOpen(false)}', why: 'closes a confirm dialog' },
  { needle: 'onClick={() => setTarget(null)}', why: 'closes a confirm dialog' },
  { needle: 'onClick={close}', why: 'closes the modal' },
  { needle: 'onClick={openSingle}', why: 'opens the undo dialog' },
  { needle: 'onClick={openCascade}', why: 'opens the undo dialog' },
]

// ---------------------------------------------------------------------------
// 1. F72 — the pause-first gate, checked against the engine that enforces it
// ---------------------------------------------------------------------------

describe('the D141 pause-first gate mirrors migration 090, for BOTH draft types', () => {
  const head = headBodies()

  it('the gate exists at the head of the chain, in 090', () => {
    expect(head.get(GATE)?.file).toBe('090_snake_pause_first.sql')
  })

  it('its head predicate is draft-type NEUTRAL (F57 ALIGN, spec §8.7 v2.12.5)', () => {
    const body = head.get(GATE)?.body ?? ''
    // The refusal fires on status alone; the type only picks the sentence.
    expect(body).toContain("IF p_draft.status = 'live' THEN")
    expect(body).not.toContain("IF p_draft.draft_type = 'auction' AND p_draft.status = 'live'")
  })

  it('both UI clauses are the engine sentences, verbatim', () => {
    const body = head.get(GATE)?.body ?? ''
    expect(body).toContain(PAUSE_FIRST_CLAUSE.auction)
    expect(body).toContain(PAUSE_FIRST_CLAUSE.other)
  })

  it('the RPCs that fire the gate are EXACTLY the ones the UI maps to groups', () => {
    const consumers = [...head.entries()]
      .filter(([name, entry]) => name !== GATE && entry.body.includes(`${GATE}(`))
      .map(([name]) => name)
      .sort()
    expect(consumers).toEqual(Object.keys(PAUSE_FIRST_RPC_SECTIONS).sort())
    // The recorded set, as literals, so the assertion above cannot pass by
    // both sides drifting together.
    expect(consumers).toEqual([
      'draft_cancel_nomination',
      'draft_move_player',
      'draft_reassign_pick',
      'draft_reverse_won_bid',
      'draft_set_clock',
      'draft_undo',
    ])
  })

  it('the mapped groups are exactly PAUSE_FIRST_SECTIONS', () => {
    const mapped = new Set(Object.values(PAUSE_FIRST_RPC_SECTIONS).flat())
    expect([...mapped].sort()).toEqual([...PAUSE_FIRST_SECTIONS].sort())
  })

  it('gated and not-gated partition every group in both catalogs', () => {
    const all = new Set<DraftOptionsSectionId>([
      ...DRAFT_OPTIONS_ENTRIES.map((e) => e.id),
      ...AUCTION_DRAFT_OPTIONS_ENTRIES.map((e) => e.id),
    ])
    const gated = new Set(PAUSE_FIRST_SECTIONS)
    const open = new Set(NOT_PAUSE_FIRST_SECTIONS)
    for (const id of all) {
      expect(gated.has(id) !== open.has(id), `${id} must be in exactly one list`).toBe(true)
    }
    expect(gated.size + open.size).toBe(all.size)
  })

  it('budget, force-nominate, order, reset and End are NOT pause-gated (D141)', () => {
    // The ruling's own exclusions — the list Chris named is the list, and a
    // helpful extra disable would be inventing a refusal the engine lacks.
    expect([...NOT_PAUSE_FIRST_SECTIONS].sort()).toEqual([
      'autopick',
      'budget',
      'end',
      'force-pick',
      'order',
      'reset',
      'seats',
    ])
  })
})

describe('pauseFirstGate — one predicate, both types (golden)', () => {
  const cases: ReadonlyArray<{
    status: string
    draft_type: string
    blocked: boolean
    reason: string | null
  }> = [
    {
      status: 'live',
      draft_type: 'auction',
      blocked: true,
      reason: 'Pause the draft first — auction commissioner controls run on a paused board.',
    },
    {
      status: 'live',
      draft_type: 'snake',
      blocked: true,
      reason: 'Pause the draft first — commissioner controls run on a paused board.',
    },
    {
      status: 'live',
      draft_type: 'linear',
      blocked: true,
      reason: 'Pause the draft first — commissioner controls run on a paused board.',
    },
    { status: 'paused', draft_type: 'auction', blocked: false, reason: null },
    { status: 'paused', draft_type: 'snake', blocked: false, reason: null },
    // Not this gate's business — `scheduled`/`complete` refusals are the
    // RPCs' own, with their own sentences (D188(3): no second spelling).
    { status: 'scheduled', draft_type: 'auction', blocked: false, reason: null },
    { status: 'complete', draft_type: 'snake', blocked: false, reason: null },
  ]

  for (const row of cases) {
    it(`${row.draft_type}/${row.status} ⇒ ${row.blocked ? 'blocked' : 'open'}`, () => {
      expect(pauseFirstGate({ status: row.status, draft_type: row.draft_type })).toEqual({
        blocked: row.blocked,
        reason: row.reason,
      })
    })
  }

  it('a live SNAKE draft is blocked — the F72 regression, stated as a case', () => {
    // The shipped panel offered undo/fix/clock on a live snake and let the
    // server refuse each click (F72). This is the assertion that fails if
    // that posture ever returns.
    expect(pauseFirstGate({ status: 'live', draft_type: 'snake' }).blocked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Source pins — the panel actually WIRES the gate (F72's discharge)
// ---------------------------------------------------------------------------

describe('the panel disables every pause-first control while a draft RUNS', () => {
  const panel = code(PANEL)

  it('derives the gate ONCE, from the draft alone (no draft-type branch)', () => {
    const calls = panel.split('pauseFirstGate(').length - 1
    expect(calls).toBe(1)
    expect(panel).toMatch(/const gate = pauseFirstGate\(draft\)/)
  })

  for (const section of [
    'ClockSection',
    'UndoSection',
    'FixPickSection',
    'ManualEditSection',
    'CancelNominationSection',
  ]) {
    it(`${section} takes the gate and disables on it`, () => {
      const body = sectionSource(section)
      expect(body).toMatch(/gate: ControlGate/)
      expect(body).toMatch(/disabled=\{gate\.blocked/)
      // The copy travels with the disable — D141's "UI disables with the
      // same copy" (the hint says why; the title says it on the control).
      expect(body).toMatch(/gate\.reason/)
    })
  }

  it('the auction timer form is gated too (087 set_clock is one verb)', () => {
    const body = sectionSource('AuctionTimerFields')
    expect(body).toMatch(/disabled=\{gate\.blocked/)
  })

  // R437 — the pin above is per SECTION, so ONE gated button satisfies it.
  // These are per BUTTON: a confirm sitting inside a dialog that outlives a
  // co-commissioner's resume is exactly F72's defect in a race, and
  // `ManualEditDialog` is rendered OUTSIDE the `armed && !gate.blocked`
  // guard that hides the cell grid.
  for (const section of [
    'ClockSection',
    'AuctionTimerFields',
    'UndoSection',
    'FixPickSection',
    'ManualEditDialog',
    'CancelNominationSection',
  ]) {
    it(`${section}: EVERY button that can reach the server carries the gate`, () => {
      const mustGate = buttonsIn(section).filter(
        (button) => !GATE_EXEMPT_ONCLICK.some((exempt) => button.includes(exempt.needle)),
      )
      // Non-vacuous: a section with nothing to gate would pass silently.
      expect(mustGate.length, `${section} has no server-reaching button`).toBeGreaterThan(0)
      for (const button of mustGate) {
        const label = button.slice(button.lastIndexOf('>') + 1).trim() || button.slice(0, 60)
        expect(button, `${section} → ${label}`).toContain('gate.blocked')
      }
    })
  }

  for (const section of ['BudgetSection', 'EndDraftSection']) {
    it(`${section} is NOT gated — D141 does not name it`, () => {
      expect(sectionSource(section)).not.toMatch(/gate\.blocked/)
    })
  }
})

// ---------------------------------------------------------------------------
// 3. The double-submit audit (the L.C2.2 review's hand-off)
// ---------------------------------------------------------------------------

describe('double submit: the budget delta is the one that duplicates money', () => {
  const head = headBodies()

  it('draft_adjust_budget composes its delta CUMULATIVELY and takes no action_id', () => {
    const body = head.get('draft_adjust_budget')?.body ?? ''
    expect(body).toContain('v_after   := v_before + p_delta')
    expect(body).not.toContain('p_action_id')
  })

  it('the other three self-guard on a replay (their own refusals)', () => {
    // reverse-bid: the pick is no longer live · cancel: nothing is nominated ·
    // end: already complete. None of them moves money twice.
    expect(head.get('draft_reverse_won_bid')?.body ?? '').toContain(
      'is not a live pick of this draft',
    )
    expect(head.get('draft_cancel_nomination')?.body ?? '').toContain(
      'no player is nominated right now',
    )
    expect(head.get('draft_end')?.body ?? '').toContain('the draft is already complete')
  })

  it('the budget submit is disabled while its mutation is pending', () => {
    const body = sectionSource('BudgetSection')
    expect(body).toMatch(/adjustBudget\.isPending/)
    // Inside the submit's own disabled expression, not merely somewhere in
    // the section (the label also reads isPending).
    const disabled = body.slice(body.indexOf('disabled={'), body.indexOf('onClick={'))
    expect(disabled).toContain('adjustBudget.isPending')
  })

  for (const [section, mutation] of [
    ['ManualEditDialog', 'reverse.isPending'],
    ['ManualEditDialog', 'movePlayer.isPending'],
    ['CancelNominationSection', 'cancel.isPending'],
    ['EndDraftSection', 'endDraft.isPending'],
  ] as const) {
    it(`${section} disables on ${mutation} too`, () => {
      expect(sectionSource(section)).toContain(mutation)
    })
  }
})

// ---------------------------------------------------------------------------
// 4. End draft — the hard confirm is entirely the client's (D188(3))
// ---------------------------------------------------------------------------

describe('End draft cannot fire on a single click', () => {
  const body = sectionSource('EndDraftSection')

  it('the confirm word is its own, not Reset’s', () => {
    expect(END_CONFIRM_WORD).toBe('END')
    expect(END_CONFIRM_WORD).not.toBe('RESET')
  })

  it('the section button only OPENS the dialog', () => {
    expect(body).toMatch(/End draft…/)
    expect(body).toMatch(/onClick=\{\(\) => setOpen\(true\)\}/)
  })

  it('the destructive call sits behind the typed word, a reason and the pending guard', () => {
    // ONE call site in the whole section, and it is the dialog footer's —
    // there is no second path to `draft_end` for a stray click to find.
    expect(body.split('.mutateAsync').length - 1).toBe(1)
    expect(body).toMatch(/confirmText !== END_CONFIRM_WORD \|\|/)
    expect(body).toMatch(/reason\.trim\(\)\.length === 0 \|\|/)
    expect(body).toMatch(/endDraft\.isPending/)
  })

  it('the route carries no confirm phrase — the confirm is the UI’s (D188(3))', () => {
    const request = code('src/hooks/use-draft-controls-ops.ts')
    const start = request.indexOf('export function endDraftRequest')
    const body = request.slice(start, request.indexOf('export function', start + 10))
    expect(body).toContain('draft_id: draftId, reason: reason.trim()')
    expect(body).not.toContain('confirm')
  })

  it('lists the ruled consequences (C41 end-as-is), count folded in', () => {
    expect(endDraftConsequences(3)).toEqual([
      '3 roster spots stay unfilled.',
      'Drafted players keep their prices.',
      'The league moves to in-season.',
      'Free agency fills the gaps.',
    ])
    expect(endDraftConsequences(1)[0]).toBe('1 roster spot stays unfilled.')
    expect(endDraftConsequences(0)[0]).toBe('0 roster spots stay unfilled.')
    // Underivable capacity ⇒ say the true thing without a number.
    expect(endDraftConsequences(null)[0]).toBe('Unfilled roster spots stay empty.')
  })
})

describe('unfilledSlotsAtEnd counts what draft_end counts', () => {
  const inputs = { auctionBudget: 200, reserve: 1 as const, totalRounds: 3, budgetAdjustments: null }
  const picks = [
    { team_id: 'A', price: 50, is_undone: false },
    { team_id: 'A', price: 10, is_undone: false },
    { team_id: 'B', price: 5, is_undone: false },
    // Undone rows are audit history — they leave the slot OPEN (E4/D131).
    { team_id: 'B', price: 99, is_undone: true },
  ]

  it('sums open slots over the franchises given', () => {
    // A: 3 − 2 = 1 · B: 3 − 1 = 2 · C: 3 − 0 = 3 ⇒ 6
    expect(unfilledSlotsAtEnd(inputs, picks, ['A', 'B', 'C'])).toBe(6)
  })

  it('is null when a capacity is not derivable (084 would raise)', () => {
    expect(
      unfilledSlotsAtEnd({ ...inputs, totalRounds: null }, picks, ['A']),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. The budget projection (E28's three arms, at the dollar)
// ---------------------------------------------------------------------------

describe('budgetEditPreview projects 084 and names the arm a refusal would hit', () => {
  // A fresh-ish seat: $200 budget, 15 slots, $50 spent on one player ⇒
  // remaining 150, open 14, max bid 150 − 13 = 137 (auction-budget's own
  // golden literals, from pgTAP 033 §D).
  const before = { remaining: 150, openSlots: 14, maxBid: 137, committed: 50 }

  it('applies the delta and re-derives max bid', () => {
    const preview = budgetEditPreview({ budget: before, delta: 10, reserve: 1 as const, highBidHeld: null })
    expect(preview.after).toEqual({
      remaining: 160,
      openSlots: 14,
      maxBid: 147,
      committed: 50,
    })
    expect(preview.refusal).toBeNull()
    expect(preview.note).toBeNull()
  })

  it('arm 2 boundary: exactly the solvency floor passes, one dollar under refuses', () => {
    // floor = 14 open × $1 = $14 ⇒ delta −136 leaves exactly $14.
    expect(
      budgetEditPreview({ budget: before, delta: -136, reserve: 1 as const, highBidHeld: null }).refusal,
    ).toBeNull()
    const under = budgetEditPreview({
      budget: before,
      delta: -137,
      reserve: 1 as const,
      highBidHeld: null,
    })
    expect(under.refusal).toBe('below-floor')
    expect(under.note).toBe(
      'That leaves $13 for 14 open roster spots at a $1 per-slot reserve — §8.6.8 needs at least $14.',
    )
  })

  it('arm 1 wins over arm 2 when the cut goes under what was SPENT', () => {
    const preview = budgetEditPreview({
      budget: before,
      delta: -151,
      reserve: 1 as const,
      highBidHeld: null,
    })
    expect(preview.refusal).toBe('below-committed')
    expect(preview.note).toBe(
      'That is $1 below the $50 this team has already spent — reverse a won bid instead, or make the adjustment smaller (E28).',
    )
  })

  it('arm 3: solvent, but no longer able to afford the high bid it is holding', () => {
    // max bid after −20 is 117; a $130 standing high bid is now unaffordable.
    const preview = budgetEditPreview({
      budget: before,
      delta: -20,
      reserve: 1 as const,
      highBidHeld: 130,
    })
    expect(preview.refusal).toBe('below-high-bid')
    expect(preview.note).toContain('$130 high bid')
    // …and the same edit is fine when this team holds no bid.
    expect(
      budgetEditPreview({ budget: before, delta: -20, reserve: 1 as const, highBidHeld: null }).refusal,
    ).toBeNull()
  })

  it('a complete roster reads max bid 0 (084s one special case, E27)', () => {
    const full = { remaining: 20, openSlots: 0, maxBid: 0, committed: 180 }
    const preview = budgetEditPreview({ budget: full, delta: 5, reserve: 1 as const, highBidHeld: null })
    expect(preview.after).toEqual({ remaining: 25, openSlots: 0, maxBid: 0, committed: 180 })
    expect(preview.refusal).toBeNull()
  })

  it('renders nothing when the mirror cannot derive a budget', () => {
    expect(budgetEditPreview({ budget: null, delta: 10, reserve: 1 as const, highBidHeld: null })).toEqual({
      before: null,
      after: null,
      refusal: null,
      note: null,
    })
  })
})

// ---------------------------------------------------------------------------
// 6. Manual Edit Mode's cost re-entry (D142)
// ---------------------------------------------------------------------------

describe('priceEntry — the re-entered cost, capped like the bid box', () => {
  const receiving = { remaining: 60, openSlots: 5, maxBid: 56, committed: 140 }

  it('states the range it will accept', () => {
    expect(priceEntry({ raw: '', reserve: 1 as const, receivingBudget: receiving }).hint).toBe(
      '$1–$56 — the receiving team keeps $1 per remaining roster spot.',
    )
    expect(priceEntry({ raw: '', reserve: 1 as const, receivingBudget: null }).hint).toBe('At least $1.')
  })

  it('blocks empty, non-numeric, below-min and over-max', () => {
    expect(priceEntry({ raw: '', reserve: 1 as const, receivingBudget: receiving }).blocker).toBe('empty')
    expect(priceEntry({ raw: '12x', reserve: 1 as const, receivingBudget: receiving }).blocker).toBe(
      'not-a-number',
    )
    expect(priceEntry({ raw: '0', reserve: 1 as const, receivingBudget: receiving }).blocker).toBe(
      'below-min',
    )
    expect(priceEntry({ raw: '57', reserve: 1 as const, receivingBudget: receiving }).blocker).toBe(
      'over-max',
    )
  })

  it('accepts both boundaries', () => {
    expect(priceEntry({ raw: '1', reserve: 1 as const, receivingBudget: receiving }).blocker).toBeNull()
    expect(priceEntry({ raw: '56', reserve: 1 as const, receivingBudget: receiving }).blocker).toBeNull()
    expect(priceEntry({ raw: ' 20 ', reserve: 1 as const, receivingBudget: receiving }).parsed).toBe(20)
  })

  // 092/AP.1 — C38 re-pointed at the toggle (D198(3)).
  it('a $0-nominations league accepts $0, and says so in the hint instead of naming a reserve it does not hold', () => {
    expect(priceEntry({ raw: '0', reserve: 0, receivingBudget: receiving }).blocker).toBeNull()
    expect(priceEntry({ raw: '', reserve: 0, receivingBudget: receiving }).hint).toBe(
      '$0–$56 — this league allows $0 nominations, so nothing is held back per roster spot.',
    )
  })

  it('D146 BOUNDARY, one dollar either side of the floor: $0 blocks at reserve 1 and passes at reserve 0', () => {
    expect(priceEntry({ raw: '0', reserve: 1, receivingBudget: receiving }).blocker).toBe('below-min')
    expect(priceEntry({ raw: '0', reserve: 0, receivingBudget: receiving }).blocker).toBeNull()
    // …and the cap is the same number either way — the toggle moves the
    // FLOOR here, never the ceiling (the ceiling is the mirror's max_bid).
    expect(priceEntry({ raw: '57', reserve: 0, receivingBudget: receiving }).blocker).toBe('over-max')
  })

  it('E28 arm 2 at reserve 0: the floor is $0, so a cut to exactly nothing is solvent and one dollar under is not', () => {
    const before = { remaining: 150, openSlots: 14, maxBid: 137, committed: 50 }
    expect(
      budgetEditPreview({ budget: before, delta: -150, reserve: 0, highBidHeld: null }).refusal,
    ).toBeNull()
    const under = budgetEditPreview({ budget: before, delta: -151, reserve: 0, highBidHeld: null })
    // Below committed spend, so arm 1 — the arm that still binds at reserve 0
    // (§8.6.8 stops binding; the "you cannot un-spend money" arm never does).
    expect(under.refusal).toBe('below-committed')
  })
})

describe('Manual Edit Mode offers EXACTLY two choices (D142)', () => {
  const dialog = sectionSource('ManualEditDialog')

  it('reset and move, and nothing else', () => {
    expect(dialog).toContain("useState<'reset' | 'move' | null>(null)")
    expect(dialog.split("setChoice('reset')").length - 1).toBe(1)
    expect(dialog.split("setChoice('move')").length - 1).toBe(1)
  })

  it('the move charges a re-entered cost, and sends it', () => {
    expect(dialog).toMatch(/price: cost\.parsed/)
    expect(dialog).toMatch(/cost\.blocker !== null \|\|/)
  })

  it('both paths require a reason — the four auction verbs 400 without one', () => {
    expect(dialog).toMatch(/const reasonReady = reason\.trim\(\)\.length > 0/)
    expect(dialog.split('!reasonReady').length - 1).toBe(2)
  })

  it('a pick whose row id has not arrived cannot be reset (never a guess)', () => {
    expect(dialog).toMatch(/disabled=\{target\?\.pickId === null\}/)
  })
})

// ---------------------------------------------------------------------------
// 7. §7.3.8's auction block in League settings (L.C3.2 item 2)
// ---------------------------------------------------------------------------

describe('the three UI-less §7.3.8 auction fields now have inputs', () => {
  const settings = code(SETTINGS)

  for (const id of ['set-auction-bid', 'set-auction-anti-snipe', 'set-nomination-order-mode']) {
    it(`${id} renders`, () => {
      expect(settings).toContain(`id="${id}"`)
    })
  }

  it('keeps the catalog ranges (§7.3.8) on the two clocks', () => {
    expect(settings).toMatch(/id="set-auction-bid"[\s\S]{0,120}min=\{10\}[\s\S]{0,40}max=\{60\}/)
    expect(settings).toMatch(/id="set-auction-anti-snipe"[\s\S]{0,140}min=\{0\}[\s\S]{0,40}max=\{15\}/)
  })

  it('does NOT offer nomination_order_mode `manual` — it would make the draft unstartable (F80)', () => {
    // The engine's side of the same fact: 084's manual arm validates a
    // STORED `drafts.nomination_order`, and 087's `draft_set_order` refuses
    // to write one before an auction starts, so `manual` has no reachable
    // path today. Offering it would be offering a refusal.
    const head = headBodies()
    expect(head.get('draft_nomination_order_internal')?.body ?? '').toContain(
      'nomination_order_mode=manual but the stored nomination order does not cover every active franchise exactly once',
    )
    expect(head.get('draft_set_order')?.body ?? '').toContain(
      'this auction has not started — set nomination_order_mode and its order in League settings',
    )
    // Scoped to the NOMINATION select's own block — the DRAFT-order select
    // above it keeps its `manual` arm, which has a real editor
    // (`DraftOrderEditor`) and a working pre-start write.
    const start = settings.indexOf('id="set-nomination-order-mode"')
    expect(start).toBeGreaterThan(-1)
    const block = settings.slice(start, settings.indexOf('/>', start))
    expect(block).not.toMatch(/\{ value: 'manual', label: 'Commissioner sets' \}/)
    // Offered ONLY as the escape hatch for a league that already stores it.
    expect(block).toMatch(
      /d\.nomination_order_mode === 'manual'[\s\S]{0,160}Commissioner sets \(no editor yet/,
    )
  })
})

// ---------------------------------------------------------------------------
// 8. R435 — the room's auction Clock form ENFORCES the ranges it prints
// ---------------------------------------------------------------------------

describe('auctionTimerPayload clamps to §7.3.8 instead of just printing it', () => {
  // The catalog's own numbers (spec §7.3.8, lines 418–420), as stored
  // literals — the same three the settings editor clamps with.
  it('carries the catalog ranges', () => {
    expect(AUCTION_TIMER_RANGES).toEqual({
      nominationSeconds: { min: 10, max: 120 },
      bidSeconds: { min: 10, max: 60 },
      antiSnipeSeconds: { min: 0, max: 15 },
    })
  })

  const stored = { nomination: 30, bid: 20, antiSnipe: 10 }
  const typed = (patch: Partial<Record<'nomination' | 'bid' | 'antiSnipe', string>>) => ({
    nomination: String(stored.nomination),
    bid: String(stored.bid),
    antiSnipe: String(stored.antiSnipe),
    ...patch,
  })

  it('sends only what CHANGED (087 reads an omitted key as unchanged)', () => {
    expect(auctionTimerPayload(typed({}), stored)).toEqual({})
    expect(auctionTimerPayload(typed({ bid: '45' }), stored)).toEqual({ bidSeconds: 45 })
  })

  // The one-unit boundaries, both ends of both clocks: the value the label
  // promises lands untouched, and one step outside lands on the bound.
  // R435's live repro was `bid_seconds: 5` reaching `drafts.config` with a
  // 200 from the route — `3` is what the box actually accepted.
  it('bid clock: 10 lands, 9 clamps to 10', () => {
    expect(auctionTimerPayload(typed({ bid: '10' }), stored)).toEqual({ bidSeconds: 10 })
    expect(auctionTimerPayload(typed({ bid: '9' }), stored)).toEqual({ bidSeconds: 10 })
    expect(auctionTimerPayload(typed({ bid: '3' }), stored)).toEqual({ bidSeconds: 10 })
  })

  it('bid clock: 60 lands, 61 clamps to 60', () => {
    expect(auctionTimerPayload(typed({ bid: '60' }), stored)).toEqual({ bidSeconds: 60 })
    expect(auctionTimerPayload(typed({ bid: '61' }), stored)).toEqual({ bidSeconds: 60 })
  })

  it('nomination clock: 10 and 120 land, 9 and 121 clamp', () => {
    expect(auctionTimerPayload(typed({ nomination: '10' }), stored)).toEqual({
      nominationSeconds: 10,
    })
    expect(auctionTimerPayload(typed({ nomination: '9' }), stored)).toEqual({
      nominationSeconds: 10,
    })
    expect(auctionTimerPayload(typed({ nomination: '120' }), stored)).toEqual({
      nominationSeconds: 120,
    })
    expect(auctionTimerPayload(typed({ nomination: '121' }), stored)).toEqual({
      nominationSeconds: 120,
    })
  })

  it('anti-snipe: 0 and 15 land, 16 clamps — and 0 is a real value, not "unset"', () => {
    expect(auctionTimerPayload(typed({ antiSnipe: '0' }), stored)).toEqual({ antiSnipeSeconds: 0 })
    expect(auctionTimerPayload(typed({ antiSnipe: '15' }), stored)).toEqual({
      antiSnipeSeconds: 15,
    })
    expect(auctionTimerPayload(typed({ antiSnipe: '16' }), stored)).toEqual({
      antiSnipeSeconds: 15,
    })
  })

  it('a clamped value EQUAL to what is stored is not sent at all', () => {
    // Stored bid 10; typing 3 clamps to 10 ⇒ nothing changed ⇒ no key, so
    // the form is not "dirty" and the RPC is never called for a no-op.
    expect(auctionTimerPayload({ ...typed({}), bid: '3' }, { ...stored, bid: 10 })).toEqual({})
  })

  it('an empty or unreadable box means UNCHANGED, never a guess', () => {
    expect(auctionTimerPayload(typed({ bid: '' }), stored)).toEqual({})
    expect(auctionTimerPayload(typed({ bid: '  ' }), stored)).toEqual({})
    expect(auctionTimerPayload(typed({ bid: '12x' }), stored)).toEqual({})
    // A negative is readable — and clamps to the floor rather than reaching
    // 090's only auction-timer check (`must be a non-negative integer`).
    expect(auctionTimerPayload(typed({ bid: '-5' }), stored)).toEqual({ bidSeconds: 10 })
  })

  it('the panel builds the payload through THIS function, and labels from the same literals', () => {
    const body = sectionSource('AuctionTimerFields')
    expect(body).toMatch(/const payload = auctionTimerPayload\(/)
    // No second, unclamped builder: the shipped one compared `asInt(…)` to
    // the stored value and sent whatever was typed.
    expect(body).not.toContain('asInt(')
    // The printed range and the enforced range are the SAME literals.
    expect(body).toContain('range={AUCTION_TIMER_RANGES.nominationSeconds}')
    expect(body).toContain('range={AUCTION_TIMER_RANGES.bidSeconds}')
    expect(body).toContain('range={AUCTION_TIMER_RANGES.antiSnipeSeconds}')
    expect(sectionSource('TimerInput')).toContain('`${min}–${max}s`')
  })

  it('the route and the RPC are UNCHANGED — the clamp is a UI guard, not the rule', () => {
    // Recorded so the next reader does not mistake this for enforcement:
    // the wire still admits anything non-negative, exactly as L.C2.2 built
    // it. Server-authoritative is unaffected; the UI simply stops proposing
    // a number its own label calls illegal.
    const service = code('src/lib/leagues/api/draft-service.ts')
    expect(service).toContain('const timerSecondsSchema = z.number().int().min(0).max(86_400)')
    const head = headBodies()
    expect(head.get('draft_set_clock')?.body ?? '').toContain(
      'draft_set_clock: auction_bid_seconds must be a non-negative integer',
    )
  })
})

// ---------------------------------------------------------------------------
// 9. R436 — the panel counts the franchises `draft_end` counts
// ---------------------------------------------------------------------------

describe('activeFranchises agrees with draft_end’s WHERE clause', () => {
  const teams = [
    { id: 'A', name: 'Active', status: 'active' },
    { id: 'B', name: 'Orphaned', status: 'orphaned' },
    { id: 'C', name: 'Retired', status: 'retired' },
  ]

  it('drops retired seats and KEEPS orphaned ones (087 excludes only retired)', () => {
    expect(activeFranchises(teams).map((t) => t.id)).toEqual(['A', 'B'])
  })

  it('the engine really excludes exactly `retired` — read out of the chain', () => {
    const body = headBodies().get('draft_end')?.body ?? ''
    expect(body).toContain("WHERE t.league_id = v_draft.league_id AND t.status <> 'retired'")
  })

  it('the End confirm’s count and draft_end agree once a seat is retired', () => {
    const inputs = { auctionBudget: 200, reserve: 1 as const, totalRounds: 3, budgetAdjustments: null }
    const picks = [{ team_id: 'A', price: 50, is_undone: false }]
    // Unfiltered, the dialog would promise 3 more empty spots than the
    // engine posts (C's whole roster) — a wrong number in a terminal confirm.
    expect(unfilledSlotsAtEnd(inputs, picks, ['A', 'B', 'C'])).toBe(8)
    expect(
      unfilledSlotsAtEnd(inputs, picks, activeFranchises(teams).map((t) => t.id)),
    ).toBe(5)
  })

  it('the panel derives it ONCE and feeds all three consumers from it', () => {
    const panel = code(PANEL)
    expect(panel).toMatch(/const activeTeams = useMemo\(\(\) => activeFranchises\(detail\.teams\)/)
    expect(panel).toMatch(/const teamIds = useMemo\(\(\) => activeTeams\.map/)
    expect(panel).toContain('teams: activeTeams,') // Manual Edit's columns
    expect(panel).toContain('teams={activeTeams}') // the budget picker
    // `teamsById` stays UNFILTERED on purpose — a retired franchise's
    // existing picks still need a name to render.
    expect(panel).toMatch(/const teamsById = useMemo\(\(\) => new Map\(detail\.teams\.map/)
  })
})
