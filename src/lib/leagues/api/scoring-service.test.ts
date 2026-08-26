/**
 * scoring-service.test.ts — SE.6's translation layer, pinned branch by branch.
 *
 * `scoring-api-db.test.ts` drives the two verbs over the real stack; this
 * suite owns the parts a live fixture cannot reach or cannot tell apart:
 *
 *   §A  the wire schemas — including the one that reads like an accident
 *       (`rules` is a `z.unknown()`-rooted schema, and Zod infers such a key
 *       as OPTIONAL, so "did the caller send a document at all?" is answered
 *       by the validator's `document_shape` family rather than by required-ness);
 *   §B  `mapScoringRpcError`'s whole branch table, including the arms that are
 *       unreachable through the route by construction and the arms whose
 *       WRONG answer would be silent (an unknown SQLSTATE answering 400 would
 *       dress a database fault as the commissioner's mistake);
 *   §C  the marker lists measured against migration 105's actual text — the
 *       drift pin. A marker that stops matching any 105 message turns a 409
 *       into a 400 with no test noticing, which is why presence is asserted
 *       against the SQL rather than against a copy of it.
 *
 * Every fixture below is chosen so the guarded clause is REACHED: §B's
 * fall-through cases carry a hint 105 really raises (`tier_cuts_undetectable`,
 * which is deliberately NOT one of the seven families) rather than a made-up
 * string, and the `docField` conjunct is pinned from both sides.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { SCORING_GUARDRAILS } from '../scoring/validate-rules-doc'
import {
  forkScoringTemplateInputSchema,
  mapScoringRpcError,
  updateScoringRulesInputSchema,
} from './scoring-service'

const TEMPLATE = '11111111-1111-4111-8111-111111111111'

/** A valid, normalized format-2 document (the fork shape SE.5's RPC writes). */
const VALID_DOC = {
  format: 2,
  base: { receptions: 1, pass_yards: 0.04 },
  positions: {},
  tier_cuts: { def_pa: [0, 1, 7, 14, 21, 28, 35], def_ya: [0, 100, 200] },
}

function fieldErrorsOf(body: unknown): Record<string, string[]> {
  const error = (body as { error?: unknown }).error
  return (error as { fieldErrors: Record<string, string[]> }).fieldErrors
}

// ---------------------------------------------------------------------------
// §A The wire schemas
// ---------------------------------------------------------------------------

describe('§A the wire schemas', () => {
  it('fork: a uuid template_id parses; an unknown key is a 400, never a silent strip', () => {
    expect(forkScoringTemplateInputSchema.safeParse({ template_id: TEMPLATE }).success).toBe(true)
    // R77: a plain z.object would DROP `templateId` and fork whatever the
    // league already pointed at — a success that did nothing.
    expect(
      forkScoringTemplateInputSchema.safeParse({ template_id: TEMPLATE, templateId: TEMPLATE })
        .success,
    ).toBe(false)
    expect(forkScoringTemplateInputSchema.safeParse({ template_id: 'not-a-uuid' }).success).toBe(
      false,
    )
  })

  it('save: a whole normalized document parses', () => {
    expect(updateScoringRulesInputSchema.safeParse({ rules: VALID_DOC }).success).toBe(true)
  })

  it('save: a body with NO `rules` key is refused — the optional-key trap, closed', () => {
    // `z.unknown()` makes `rules` an optional key in Zod's inference, so this
    // is the shape that would otherwise 200 while writing nothing. It is
    // refused because the refinement still runs, with `undefined` as the
    // value, and `document_shape` rejects it — path `rules`, not `''`.
    const parsed = updateScoringRulesInputSchema.safeParse({})
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toEqual(['rules'])
    expect(parsed.error.issues[0].message).toContain('Document shape')
  })

  it('save: the EMPTY KEY at the route boundary — both formats, both shapes (F138)', () => {
    // `''` is a legal JSON key and is not scorable. In FORMAT 2 the path is
    // unambiguous — the empty LAST segment is the key — and the editor's own
    // documents are always format 2, so this is the shape that can actually
    // reach the route from the product.
    const v2 = updateScoringRulesInputSchema.safeParse({
      rules: { ...VALID_DOC, base: { ...VALID_DOC.base, '': 1 } },
    })
    expect(v2.success).toBe(false)
    if (v2.success) return
    expect(v2.error.issues[0].path.map(String)).toEqual(['rules', 'base', ''])

    // In FORMAT 1 the path IS the key name, so the empty key and "the
    // document" are the same string `''` on the TS side — the F138
    // ambiguity, stated rather than papered over. The route reports the
    // document, and the MESSAGE names the offending key. This is accepted
    // rather than fixed because format 1 is the TEMPLATE format: the editor
    // never authors one (SE.5's fork always writes format 2), so the
    // ambiguity is unreachable from the product, while giving
    // `ScoringViolation.path` a nullable form would change SE.3's contract,
    // its suite, and the parity comparator's counted refinement.
    const v1 = updateScoringRulesInputSchema.safeParse({ rules: { '': 1 } })
    expect(v1.success).toBe(false)
    if (v1.success) return
    expect(v1.error.issues[0].path.map(String)).toEqual(['rules'])
    expect(v1.error.issues[0].message).toContain('Scorable allowlist')
  })

  it('save: an INVALID document is refused by this layer, before any RPC call', () => {
    // 101 is one unit past the |coef| ≤ 100 bound at 2dp (D146(1)).
    const parsed = updateScoringRulesInputSchema.safeParse({
      rules: { ...VALID_DOC, base: { ...VALID_DOC.base, receptions: 101 } },
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0].path.join('.')).toBe('rules.base.receptions')
  })
})

// ---------------------------------------------------------------------------
// §B mapScoringRpcError — the branch table
// ---------------------------------------------------------------------------

describe('§B mapScoringRpcError', () => {
  it('42501 → 403 and does NOT leak the RPC function name', () => {
    const result = mapScoringRpcError(
      { code: '42501', message: 'scoring_fork_template: not a commissioner of this league' },
      'template_id',
    )
    expect(result.status).toBe(403)
    expect(JSON.stringify(result.body)).not.toContain('scoring_fork_template:')
  })

  it('P0002 → 404', () => {
    const result = mapScoringRpcError(
      { code: 'P0002', message: 'scoring_update_rules: league xyz not found' },
      'rules',
    )
    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: 'League not found' })
  })

  it('a guardrail HINT keys the RPC message to the document dot path', () => {
    const result = mapScoringRpcError(
      {
        code: 'P0001',
        message: 'Bounds (§7.3.3.1): base.receptions is 101…',
        details: 'base.receptions',
        hint: 'bounds',
      },
      'rules',
    )
    expect(result.status).toBe(400)
    expect(fieldErrorsOf(result.body)).toEqual({
      'rules.base.receptions': ['Bounds (§7.3.3.1): base.receptions is 101…'],
    })
  })

  it("103's '(document)' DETAIL keys the document itself, not a path called '(document)'", () => {
    for (const details of ['(document)', null, undefined]) {
      const result = mapScoringRpcError(
        { code: 'P0001', message: 'Document shape (§7.3.3.1): …', details, hint: 'document_shape' },
        'rules',
      )
      expect(Object.keys(fieldErrorsOf(result.body))).toEqual(['rules'])
    }
  })

  it('an EMPTY detail is the empty KEY, not the document — SQL’s injectivity survives (F138)', () => {
    // R602 gave SQL the distinction TS cannot make: `(document)` is the
    // document, an empty DETAIL is the legal-but-unscorable key `''`.
    // Flattening the two here would be a lossy translation of the one layer
    // that knows — and it would report a real field as a whole-document
    // rejection, which is what the editor renders as "your document is
    // broken" instead of lighting an input.
    const result = mapScoringRpcError(
      {
        code: 'P0001',
        message: 'Scorable allowlist (§7.3.3.1(1)): `` is not a scorable key…',
        details: '',
        hint: 'scorable_allowlist',
      },
      'rules',
    )
    expect(Object.keys(fieldErrorsOf(result.body))).toEqual(['rules.'])
  })

  it('on the FORK verb a guardrail lands on template_id — never a path inside a body it has no field for', () => {
    const result = mapScoringRpcError(
      {
        code: 'P0001',
        message: 'Tier cuts (§7.3.3.1(c)): tier_cuts.def_pa …',
        details: 'tier_cuts.def_pa',
        hint: 'tier_cuts',
      },
      'template_id',
    )
    expect(Object.keys(fieldErrorsOf(result.body))).toEqual(['template_id'])
  })

  it('every one of the seven families is recognised as a document rejection', () => {
    for (const hint of SCORING_GUARDRAILS) {
      const result = mapScoringRpcError(
        { code: 'P0001', message: `${hint} violated`, details: 'base.x', hint },
        'rules',
      )
      expect(result.status, hint).toBe(400)
      expect(Object.keys(fieldErrorsOf(result.body)), hint).toEqual(['rules.base.x'])
    }
  })

  it("a hint that is NOT a family falls through — 105's own `tier_cuts_undetectable` is the case", () => {
    // The near-miss that makes the runtime set load-bearing: 105 raises this
    // hint from `scoring_detect_tier_cuts`, it LOOKS like `tier_cuts`, and it
    // is not a per-field document rejection. A prefix test would mis-key it.
    const result = mapScoringRpcError(
      {
        code: 'P0001',
        message: 'scoring_detect_tier_cuts: cannot detect a tier family…',
        details: '(document)',
        hint: 'tier_cuts_undetectable',
      },
      'template_id',
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual({ error: 'scoring_detect_tier_cuts: cannot detect a tier family…' })
  })

  it('the four state refusals answer 409 with the RPC sentence VERBATIM', () => {
    const sentences = [
      'scoring_fork_template: league x is in drafting — scoring can only be customized while the league is in setup or scheduled…',
      'scoring_update_rules: league x is in in_season — scoring can only be edited while the league is in setup or scheduled…',
      'scoring_update_rules: league x is on a shared template — fork first, templates are immutable (§7.3.3.1)',
      'scoring_update_rules: league x references no scoring system — fork a template first (§7.3.3.1 entry point)',
      "scoring_update_rules: league x references scoring system y, which is not this league's own forked custom row…",
    ]
    for (const message of sentences) {
      const result = mapScoringRpcError({ code: 'P0001', message }, 'rules')
      expect(result.status, message).toBe(409)
      expect(result.body, message).toEqual({ error: message })
    }
  })

  it('the template predicate is a field error on the FORK verb — and only there', () => {
    const message =
      'scoring_fork_template: p_template_id must reference one of the scoring templates — …'
    const fork = mapScoringRpcError({ code: 'P0001', message }, 'template_id')
    expect(fork.status).toBe(400)
    expect(fieldErrorsOf(fork.body)).toEqual({ template_id: [message] })

    // The `docField === 'template_id'` conjunct, pinned from the other side:
    // the save verb has no `template_id` input, so keying an error to one
    // would point the editor at a field that does not exist on its form.
    const save = mapScoringRpcError({ code: 'P0001', message }, 'rules')
    expect(save.status).toBe(400)
    expect(save.body).toEqual({ error: message })
  })

  it('an unmatched P0001 surfaces verbatim at 400', () => {
    const message = 'scoring_fork_template: repointing league x matched 0 rows, expected 1'
    expect(mapScoringRpcError({ code: 'P0001', message }, 'template_id')).toEqual({
      status: 400,
      body: { error: message },
    })
  })

  it('22023 and 23514 are client errors; anything else is a 500', () => {
    for (const code of ['22023', '23514']) {
      expect(mapScoringRpcError({ code, message: 'bad argument' }, 'rules').status, code).toBe(400)
    }
    // The branch whose wrong answer is silent: a statement timeout, a
    // connection fault or a NULL code is OUR failure, and answering 400 would
    // tell the commissioner their document was wrong. (CLAUDE.md: prefer loud
    // failure over a plausible-looking client error.)
    for (const code of ['57014', '08006', '', null, undefined]) {
      expect(mapScoringRpcError({ code, message: 'canceling statement…' }, 'rules').status).toBe(500)
    }
  })
})

// ---------------------------------------------------------------------------
// §C The markers, measured against migration 105 itself
// ---------------------------------------------------------------------------

describe('§C the 409 / field markers still match migration 105', () => {
  /** 105's text with SQL's doubled quotes un-escaped, so a literal containing
   *  an apostrophe (`league''s`) compares as the runtime message does. */
  const sql = readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/105_scoring_editor_rpcs.sql'),
    'utf8',
  ).replace(/''/g, "'")

  // These are the strings `scoring-service.ts` matches on. Kept here as
  // literals ON PURPOSE: importing the arrays would make the pin agree with
  // itself. If a marker is edited on one side only, this goes RED.
  const STATE_MARKERS = [
    'scoring can only be',
    'fork first, templates are immutable',
    'fork a template first',
    "is not this league's own forked custom row",
  ]
  const FORK_MARKERS = [
    'p_template_id must reference one of the scoring templates',
    'already carries a "format" member',
  ]

  for (const marker of [...STATE_MARKERS, ...FORK_MARKERS]) {
    it(`105 still raises a message containing "${marker}"`, () => {
      // The silent failure this catches: reword the RPC sentence and the 409
      // quietly becomes a 400 — same body, different contract, no red.
      expect(sql).toContain(marker)
    })
  }

  it('no marker is a substring of another, so first-match is order-independent', () => {
    const all = [...STATE_MARKERS, ...FORK_MARKERS]
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue
        expect(a.includes(b), `${a} ⊃ ${b}`).toBe(false)
      }
    }
  })
})
