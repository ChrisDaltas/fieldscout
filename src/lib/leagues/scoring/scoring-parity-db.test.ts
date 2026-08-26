/**
 * scoring-parity-db.test.ts — **the TS≡SQL parity fixture** (SE.4(4); D168(1)).
 *
 * D168 puts one guardrail validator in each language and ties them with "one
 * shared table of accept/reject docs run through both, so the mirrors cannot
 * drift silently". This is that tie, against the LOCAL Supabase stack over the
 * exact wire path production uses (PostgREST → `scoring_rules_validate`), so
 * the thing under test is the deployed function and not a re-implementation of
 * it.
 *
 * **Both directions, or it is half a fixture.** Every document is asserted on
 * three axes, not one:
 *   • the VERDICT agrees (accept ⟺ accept),
 *   • the guardrail FAMILY agrees (TS `violation.code` ⟺ SQL `error.hint`),
 *   • the dot PATH agrees (TS `violation.path` ⟺ SQL `error.details`).
 * A mirror that refuses the same documents for different reasons has already
 * drifted; it just has not been caught yet.
 *
 * **And the arms, not the names.** D269(12) is the lesson this suite is built
 * around: a parity fixture written as "one document per family" certifies a
 * checklist of NAMES. So beyond `ONE_FAMILY_EACH` (one document per ARM, both
 * formats) the suite sweeps, through BOTH layers:
 *   • all 61 registry keys, at `base` and in a flat document — so the SQL
 *     transcription of the scorable allowlist is proved against TS's registry
 *     rather than eyeballed;
 *   • the full 6 × 48 position matrix — same, for the position → legal-keys map;
 *   • coefficient edges at all three layers, the position vocabulary, hostile
 *     key names, every `tier_cuts` residual arm, and every envelope shape.
 *
 * **The one-sided property.** Beyond agreement, the suite asserts the direction
 * that matters if the two ever DO differ: `SQL accepts ⟹ TS accepts`. SQL is
 * the wall (SE.4b); a SQL that is stricter fails loudly at the save, a SQL that
 * is looser admits the document D175 says must be unrepresentable.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) — the
 * same precondition `npm run test:db` and `templates-db.test.ts` have. FAILS
 * loudly when the stack is down; never skips (§4.3 falsifiability; D59(5)).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { STAT_KEYS } from '../stats/stat-keys'
import {
  ACCEPTANCE_FLOOR,
  ONE_FAMILY_EACH,
  espnFork,
  template,
  withBase,
  withCuts,
  withOverride,
} from './parity-fixture'
import { SCORING_POSITIONS, forkTemplateDoc } from './rules-doc'
import { SCORING_TEMPLATES } from './templates'
import {
  DEF_PA_PREFIX,
  DEF_YA_PREFIX,
  ESPN_PA_CUTS,
  SHARED_PA_CUTS,
  YA_CUTS,
  tierKeysFromCuts,
} from './tier-cuts'
import { SCORABLE_KEYS, validateScoringRulesDoc } from './validate-rules-doc'

// The Supabase CLI's fixed local development URL + demo keys (printed by
// `npx supabase status`; identical for every local stack — not secrets).
const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

// `anon` is REVOKEd (migration 103, the 038/059 precedent), so the parity path
// runs as service_role — the role SE.4b's triggers will fire under from the
// server's own writers.
const db: SupabaseClient = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY)

/* ────────────────────────────────────────────────────────────────────────
 * The two oracles, reduced to one comparable string each
 * ──────────────────────────────────────────────────────────────────────── */

/** `ACCEPT` | `REJECT|<family>|<path>` — TS. A document-level path is `''` in
 *  TS.
 *
 *  **The `''` → `(document)` mapping is DELIBERATELY ASYMMETRIC, and that is a
 *  finding, not a convenience (R602).** SQL now distinguishes the two cases:
 *  a document-level refusal carries DETAIL `(document)`, and the (legal) JSON
 *  key `""` carries an empty DETAIL. TS cannot — `violation.path` is `''` for
 *  both. So this helper maps TS's `''` to `(document)`, which is right for
 *  every document in the corpus except one, and that one is pinned explicitly
 *  in "the empty-string key" block below rather than smoothed over here. The
 *  earlier version of this comment claimed the sentinel preserved the
 *  distinction; it did not, and the fixture could not see that it did not,
 *  because it erased the distinction before comparing. */
const tsVerdict = (doc: unknown): string => {
  const r = validateScoringRulesDoc(doc)
  if (r.valid) return 'ACCEPT'
  const v = r.violations[0]
  return `REJECT|${v.code}|${v.path === '' ? '(document)' : v.path}`
}

/** The same string, from the deployed SQL function over PostgREST. */
const sqlVerdict = async (doc: unknown): Promise<string> => {
  const { error } = await db.rpc('scoring_rules_validate', {
    p_rules: doc as never,
  })
  if (!error) return 'ACCEPT'
  if (error.code !== 'P0001') {
    // A guardrail refusal is P0001 by construction. Anything else (42501, a
    // plpgsql runtime error, a network failure) is a DIFFERENT event and must
    // never be read as "the validator refused it" — that is exactly the
    // never-let-"nothing happened"-mean-"it worked" shape, inverted.
    return `ERROR|${error.code}|${error.message}`
  }
  return `REJECT|${error.hint}|${error.details}`
}

/** Run `fn` over `items` with bounded concurrency — 576 sequential round trips
 *  would make this suite slow enough to be skipped, which is how pins die. */
const mapLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

interface Case {
  label: string
  doc: unknown
}

/**
 * The one place the two layers are ALLOWED to differ, and it is a refinement,
 * not a divergence (R602): TS reports path `''` both for a document-level
 * refusal and for the legal JSON key `""`; SQL distinguishes them, saying
 * `(document)` for the first and an empty DETAIL for the second. So an SQL
 * empty DETAIL is a legal refinement of TS's `''`. Nothing else is relaxed —
 * and every sweep asserts HOW MANY of its cases used the relaxation, so it
 * cannot quietly grow into a hole.
 */
const refines = (ts: string, sql: string): boolean =>
  ts === sql || (ts.endsWith('|(document)') && sql === `${ts.slice(0, -'(document)'.length)}`)

/** The whole-corpus assertion: verdict, family and path identical (or the one
 *  named refinement above), reported with the labels of every case that
 *  disagreed — a bare count is unreadable when it reds. Returns
 *  `[caseCount, refinedCount]`. */
const expectParity = async (
  cases: readonly Case[],
  expectedRefinements = 0,
): Promise<number> => {
  expect(cases.length).toBeGreaterThan(0) // never a vacuous sweep (F94 shape)
  const sql = await mapLimit(cases, 32, (c) => sqlVerdict(c.doc))
  const rows = cases.map((c, i) => ({ label: c.label, ts: tsVerdict(c.doc), sql: sql[i] }))
  expect(rows.filter((r) => !refines(r.ts, r.sql))).toEqual([])
  expect(
    rows.filter((r) => r.ts !== r.sql).map((r) => r.label),
    'the R602 refinement is used exactly where it is expected, and nowhere else',
  ).toHaveLength(expectedRefinements)
  return cases.length
}

/* ────────────────────────────────────────────────────────────────────────
 * The sweep corpora — built from the registry and the shipped templates, so a
 * change on either side moves the sweep instead of leaving it stale beside one
 * ──────────────────────────────────────────────────────────────────────── */

const fork = () => espnFork()
const espnFlat = () => template('ESPN Standard')

const registryCases: Case[] = [
  ...STAT_KEYS.map((d) => ({
    label: `base.${d.key} (${d.scoring_surface})`,
    doc: withBase(fork(), { [d.key]: 1 }),
  })),
  ...STAT_KEYS.map((d) => ({
    label: `flat ${d.key} (${d.scoring_surface})`,
    doc: { ...espnFlat(), [d.key]: 1 },
  })),
]

const scorableKeys = [...SCORABLE_KEYS].sort()
const positionMatrixCases: Case[] = SCORING_POSITIONS.flatMap((position) =>
  scorableKeys.map((key) => ({
    label: `positions.${position}.${key}`,
    // 0.25 rather than a template value: never accidentally a normal-form
    // no-op, which would measure guardrail 4 instead of guardrail 3.
    doc: { ...fork(), positions: { [position]: { [key]: 0.25 } } },
  })),
)

// ⚠ EVERY VALUE HERE GOES OUT THROUGH `JSON.stringify`, so a value that
// literal cannot render faithfully never reaches SQL at all. `1e400` used to
// sit in this list labelled "a coefficient past the double range"; it
// serialises to `null`, so it measured the finiteness arm and not the
// magnitude one. It is kept, honestly relabelled — a `null` coefficient IS a
// real arm — and the number-model edges it was meant to cover are measured
// over raw bytes in "the number-model edges" block below. **The lane rule
// this earned: a parity claim about a number literal must be measured over
// raw bytes, never over a serializing client.**
const COEFFICIENT_EDGES = [
  100, -100, 100.01, -100.01, 0.01, -0.01, 0.001, 0, 1, 0.1, 0.07, 99.99, 2.5001,
  0.30000000000000004, 1e-7, 1e21, 1.5, 12.34, 0.005, 50.5,
]
const coefficientCases: Case[] = COEFFICIENT_EDGES.flatMap((n) => [
  { label: `base.pass_tds = ${n}`, doc: withBase(fork(), { pass_tds: n }) },
  {
    label: `positions.QB.pass_tds = ${n}`,
    doc: { ...fork(), positions: { QB: { pass_tds: n } } },
  },
  { label: `flat pass_tds = ${n}`, doc: { ...espnFlat(), pass_tds: n } },
])

const NON_NUMBERS: unknown[] = ['4', true, false, null, [], {}, [1], { a: 1 }]
const nonNumberCases: Case[] = NON_NUMBERS.map((v) => ({
  label: `base.pass_tds = ${JSON.stringify(v)}`,
  doc: withBase(fork(), { pass_tds: v }),
}))

const HOSTILE_KEYS = [
  '__proto__', 'constructor', 'prototype', 'toString', 'valueOf', '',
  ' pass_tds', 'pass_tds ', 'PASS_TDS', 'Pass_Tds', 'pass-tds', 'pass.tds',
  'def_pa_', 'def_ya_', 'def_pa_0_', 'def_pa_00', 'def_pa_14_20 ',
  'format', 'base', 'positions', 'tier_cuts', 'targets ', 'null', 'undefined',
]
const hostileKeyCases: Case[] = [
  ...HOSTILE_KEYS.map((k) => ({
    label: `base[${JSON.stringify(k)}]`,
    doc: withBase(fork(), { [k]: 1 }),
  })),
  ...HOSTILE_KEYS.map((k) => ({
    label: `positions.QB[${JSON.stringify(k)}]`,
    doc: { ...fork(), positions: { QB: { [k]: 1 } } },
  })),
]

const POSITION_NAMES = [
  'QB', 'RB', 'WR', 'TE', 'K', 'DST',
  'qb', 'Qb', 'dst', 'Dst', 'DEF', 'D/ST', ' QB', 'QB ', 'FLEX', '',
  '__proto__', 'constructor',
]
const positionNameCases: Case[] = POSITION_NAMES.map((p) => ({
  label: `positions[${JSON.stringify(p)}].pass_tds`,
  doc: { ...fork(), positions: { [p]: { pass_tds: 5 } } },
}))

const CUT_LISTS: unknown[] = [
  [0, 1, 7, 14, 18, 28, 35, 46], [0, 1, 7, 14, 21, 28, 35], [0, 7], [0, 100],
  [0], [], [0, 7, 7], [0, 7, 6], [7, 14], [-1, 0, 7], [1, 7, 14],
  [0, 7.5, 14], [0, '7', 14], [0, null, 14], [0, true], [0, [7]],
  // `[0, 1e400]` and `[-1e400, 0]` used to live here labelled as the
  // double-range arm. `JSON.stringify([0, 1e400])` is `[0,null]`, so what
  // actually crossed the wire was the non-number arm one line up. Written as
  // `null` now, and the real double-range and 2^53 cases are measured over raw
  // bytes below (R601).
  [0, null], [null, 0], 'x', 42, null, {}, true,
]
const tierCutCases: Case[] = [
  ...CUT_LISTS.map((c) => ({
    label: `tier_cuts.def_pa = ${JSON.stringify(c)}`,
    doc: withCuts(fork(), { def_pa: c }),
  })),
  ...CUT_LISTS.map((c) => ({
    label: `tier_cuts.def_ya = ${JSON.stringify(c)}`,
    doc: withCuts(fork(), { def_ya: c }),
  })),
  {
    label: 'tier_cuts missing entirely',
    doc: { format: 2, base: fork().base, positions: {} },
  },
  {
    label: 'tier_cuts with def_pa only (R577: both tables are always written)',
    doc: {
      format: 2,
      base: fork().base,
      positions: {},
      tier_cuts: { def_pa: ESPN_PA_CUTS },
    },
  },
  {
    label: 'tier_cuts with a stray table (a fixed point of the normal form)',
    doc: withCuts(fork(), { def_zz: [0, 1] } as { def_pa?: unknown }),
  },
]

const envelopeCases: Case[] = [
  { label: 'stray member: postions', doc: { ...fork(), postions: {} } },
  { label: 'stray member: Positions', doc: { ...fork(), Positions: {} } },
  { label: 'stray member: receptions at top level', doc: { ...fork(), receptions: 1 } },
  {
    label: 'envelope with the format member deleted',
    doc: { base: fork().base, positions: {}, tier_cuts: fork().tier_cuts },
  },
  { label: 'format: 1', doc: { ...fork(), format: 1 } },
  { label: 'format: 3', doc: { ...fork(), format: 3 } },
  { label: 'format: 2.0', doc: { ...fork(), format: 2.0 } },
  { label: 'format: "2"', doc: { ...fork(), format: '2' } },
  { label: 'format: null', doc: { ...fork(), format: null } },
  { label: 'base: null', doc: { ...fork(), base: null } },
  { label: 'base: []', doc: { ...fork(), base: [] } },
  { label: 'base: 5', doc: { ...fork(), base: 5 } },
  { label: 'positions: null', doc: { ...fork(), positions: null } },
  { label: 'positions: []', doc: { ...fork(), positions: [] } },
  { label: 'positions.QB: []', doc: { ...fork(), positions: { QB: [] } } },
  { label: 'positions.QB: 5', doc: { ...fork(), positions: { QB: 5 } } },
  { label: 'positions.QB: null', doc: { ...fork(), positions: { QB: null } } },
  { label: 'positions.QB: {} (empty override)', doc: { ...fork(), positions: { QB: {} } } },
  { label: 'the document itself is null', doc: null },
  { label: 'the document itself is an array', doc: [] },
  { label: 'the document itself is a number', doc: 42 },
  { label: 'the document itself is a string', doc: 'rules' },
  { label: 'the document is {}', doc: {} },
  // R602: `""` is a legal JSON key. These three are in the CORPUS (not only in
  // the dedicated block) so the whole-corpus family/path comparison sees them.
  { label: 'flat {"": 1} — a field violation at the empty key', doc: { '': 1 } },
  { label: 'a format-2 stray member named ""', doc: { ...fork(), '': 1 } },
  { label: 'a format-2 base key named ""', doc: withBase(fork(), { '': 1 }) },
]

const normalFormCases: Case[] = [
  {
    label: 'override repeating the base value (a no-op)',
    doc: withOverride(fork(), 'TE', { receptions: 1 }),
  },
  {
    label: 'override differing from the base value (legal)',
    doc: withOverride(fork(), 'TE', { receptions: 1.5 }),
  },
  {
    label: 'override of a key ABSENT from base, at 0 (never a no-op — D268(5))',
    doc: withOverride(fork(), 'QB', { pat_missed: 0 }),
  },
  {
    // NOTE, so the label does not overclaim: `JSON.stringify(-0)` is `"0"`,
    // so SQL is handed 0 and the -0 never crosses the wire. What this pins is
    // that TS treats -0 as a no-op over a base 0 (`===`, not `Object.is`) and
    // that the layer agrees on the value SQL actually receives.
    label: 'override at -0 over a base 0 (serialised as 0 — both see a no-op)',
    doc: withOverride(withBase(fork(), { rec_2pt: 0 }), 'WR', { rec_2pt: -0 }),
  },
]

const exclusivityCases: Case[] = [
  { label: 'F21 literal, flat', doc: { def_pa_14_20: 4, def_pa_18_27: 3 } },
  {
    label: 'F21 literal, format-2 base (its own cuts are ESPN)',
    doc: withBase(fork(), { def_pa_14_20: 4 }),
  },
  {
    label: 'F21 literal, format-2 DST override (R593 — one layer down)',
    doc: withOverride(fork(), 'DST', { def_pa_14_20: 4 }),
  },
  {
    label: 'the four SHARED key names alone (D269(3)s relaxed reading)',
    doc: { def_pa_0: 5, def_pa_1_6: 4, def_pa_7_13: 3, def_pa_28_34: -1 },
  },
  { label: 'a YA key the published cut list does not generate', doc: { def_ya_0_50: 1 } },
  // F137, and the mechanism is SCOPE — not order (an earlier draft of this
  // note said "guardrail 1 runs AHEAD of guardrail 2", which is true and is
  // not the cause). Measured: the first document draws exactly ONE violation,
  // because `def_pa_0_13` IS in the set its own cuts generate, so guardrail 2
  // has no complaint at any position in the sequence — reordering the families
  // would change nothing. Guardrail 1 is a membership test against §23.5's
  // CLOSED 20-name registry list, so it refuses a re-cut name wherever it
  // runs. That is why resolution (b) follows from the diagnosis. BOTH layers
  // agree; the constraint is the spec's, not a mirror defect. PROGRESS §3 Q26.
  {
    label: 'SCOPE: a key the docs OWN re-cut table generates but the registry does not carry',
    doc: withBase(withCuts({ ...fork(), base: {} }, { def_pa: [0, 14, 28] }), {
      def_pa_0_13: 5,
    }),
  },
  {
    label: 'a PUBLISHED key the docs own re-cut table does not generate',
    doc: withBase(withCuts({ ...fork(), base: {} }, { def_pa: [0, 14, 28] }), {
      def_pa_1_6: 5,
    }),
  },
  {
    // The one document here that breaks TWO families, so it is the only one
    // that actually exercises precedence — the property the pair above was
    // described as pinning and does not (neither of them violates two).
    label: 'PRECEDENCE: a registry-absent key under the PUBLISHED cuts (TS: 2 violations)',
    doc: withBase({ ...fork(), base: {} }, { def_pa_0_13: 5 }),
  },
  {
    // R607: §7.3.3.1(c)'s OWN printed example cut list. The list is legal and
    // its six published tiers are payable; what is refused is the FIRST tier
    // it generates.
    label: 'the specs own printed cut list, paying the first tier it generates',
    doc: withBase(withCuts({ ...fork(), base: {} }, { def_pa: [0, 7, 14, 18, 28, 35, 46] }), {
      def_pa_0_6: 5,
    }),
  },
  {
    label: 'the specs own printed cut list, paying only its PUBLISHED tiers',
    doc: withBase(withCuts({ ...fork(), base: {} }, { def_pa: [0, 7, 14, 18, 28, 35, 46] }), {
      def_pa_7_13: 3, def_pa_14_17: 1, def_pa_18_27: 0,
      def_pa_28_34: -1, def_pa_35_45: -3, def_pa_46_plus: -5,
    }),
  },
]

/** The E75 discriminator per family — the same seven patterns SE.3 pins in
 *  `validate-rules-doc.test.ts`, applied to the SQL messages. */
const FAMILY_NAME_IN_MESSAGE = {
  document_shape: /Document shape \(§7\.3\.3\.1/,
  scorable_allowlist: /Scorable allowlist \(§7\.3\.3\.1 guardrail 1\)/,
  tier_exclusivity: /Tier exclusivity \(§7\.3\.3\.1 guardrail 2\)/,
  position_scope: /Position scope \(§7\.3\.3\.1 guardrail 3\)/,
  normal_form: /Normal form \(§7\.3\.3\.1 guardrail 4\)/,
  bounds: /Bounds \(§7\.3\.3\.1 guardrail 5\)/,
  tier_cuts: /Tier cuts \(§7\.3\.3\.1/,
} as const

/* ────────────────────────────────────────────────────────────────────────
 * §A — the shared fixture, both directions
 * ──────────────────────────────────────────────────────────────────────── */

describe('SE.4(4) the TS≡SQL parity fixture — the refusals', () => {
  it.each(ONE_FAMILY_EACH.map((c, i) => ({ ...c, i })))(
    '[$i] $code — TS and SQL refuse it, name the same guardrail, at the same path',
    async ({ code, doc }) => {
      // The TS half of the contract, restated here so the SQL assertion below
      // is anchored to a MEASURED expectation and not to the same intuition
      // that wrote the SQL.
      const ts = validateScoringRulesDoc(doc)
      expect(ts.violations.map((v) => v.code)).toEqual([code])

      const { error } = await db.rpc('scoring_rules_validate', { p_rules: doc as never })
      expect(error, 'SQL accepted a document TS refuses').not.toBeNull()
      expect(error!.code).toBe('P0001')
      expect(error!.hint).toBe(code)
      expect(error!.details).toBe(ts.violations[0].path === '' ? '(document)' : ts.violations[0].path)
      // E75: the refusal names its own guardrail, in SQL as in TS.
      expect(error!.message).toMatch(FAMILY_NAME_IN_MESSAGE[code])
    },
  )

  it('the fixture still covers every family and BOTH formats (no hole, no drift)', () => {
    expect([...new Set(ONE_FAMILY_EACH.map((c) => c.code))].sort()).toEqual(
      (Object.keys(FAMILY_NAME_IN_MESSAGE) as Array<keyof typeof FAMILY_NAME_IN_MESSAGE>).sort(),
    )
    const formats = ONE_FAMILY_EACH.map(({ doc }) =>
      typeof doc === 'object' && doc !== null && 'format' in doc ? 2 : 1,
    )
    expect(formats).toContain(1)
    expect(formats).toContain(2)
    // The size is a stored literal so that a silent SHRINK of the fixture —
    // the way a parity suite actually rots — has to be a deliberate edit here.
    expect(ONE_FAMILY_EACH).toHaveLength(22)
  })
})


describe('SE.4(4) the TS≡SQL parity fixture — the acceptances', () => {
  it.each(ACCEPTANCE_FLOOR)('$label — TS and SQL both accept it', async ({ doc }) => {
    expect(validateScoringRulesDoc(doc).violations).toEqual([])
    const { error } = await db.rpc('scoring_rules_validate', { p_rules: doc as never })
    expect(error, 'SQL refused a document TS accepts').toBeNull()
  })

  it('the acceptance floor is the six templates, their six forks, and one legal edit', () => {
    expect(ACCEPTANCE_FLOOR).toHaveLength(SCORING_TEMPLATES.length * 2 + 1)
    expect(SCORING_TEMPLATES).toHaveLength(6)
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * §B — the ARM sweeps (D269(12): a fixture of names certifies names)
 * ──────────────────────────────────────────────────────────────────────── */

describe('the sweeps — where a transcription could have drifted from the registry', () => {
  it('all 61 registry keys agree, at `base` and in a flat document (guardrail 1)', async () => {
    expect(STAT_KEYS).toHaveLength(61)
    expect(await expectParity(registryCases)).toBe(122)
  })

  it('the full 6 × 48 position matrix agrees (guardrail 3)', async () => {
    expect(scorableKeys).toHaveLength(48)
    expect(await expectParity(positionMatrixCases)).toBe(288)
  })

  it('coefficient edges agree at base, at an override, and flat (guardrail 5)', async () => {
    await expectParity(coefficientCases)
  })

  it('non-number coefficients agree (guardrail 5s finiteness arm)', async () => {
    await expectParity(nonNumberCases)
  })

  it('hostile key names agree at both layers (guardrail 1, incl. the prototype class)', async () => {
    await expectParity(hostileKeyCases)
  })

  it('the position vocabulary agrees — exactly six names, case-sensitive (R594)', async () => {
    await expectParity(positionNameCases)
  })

  it('every tier_cuts residual arm agrees, on both tables (§7.3.3.1(c) + R592)', async () => {
    await expectParity(tierCutCases)
  })

  it('every envelope shape agrees, including the front door (R588/R597)', async () => {
    // 2 refinements, both the R602 empty-key case: TS says `''` (ambiguous),
    // SQL says an empty DETAIL (a field path). Named here so the allowance is
    // a fact about two documents rather than a hole in the comparator.
    await expectParity(envelopeCases, 2)
  })

  it('the normal form agrees (guardrail 4 — the strip has one definition)', async () => {
    await expectParity(normalFormCases)
  })

  it('tier exclusivity agrees on the F21 literal at every layer (guardrail 2)', async () => {
    await expectParity(exclusivityCases)
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * §C — the direction that matters, and the one measured divergence
 * ──────────────────────────────────────────────────────────────────────── */

const WHOLE_CORPUS: Case[] = [
  ...ONE_FAMILY_EACH.map((c, i) => ({ label: `one-family[${i}] ${c.code}`, doc: c.doc })),
  ...ACCEPTANCE_FLOOR,
  ...registryCases,
  ...positionMatrixCases,
  ...coefficientCases,
  ...nonNumberCases,
  ...hostileKeyCases,
  ...positionNameCases,
  ...tierCutCases,
  ...envelopeCases,
  ...normalFormCases,
  ...exclusivityCases,
]

describe('the one-sided property: SQL is the wall, so it may never be the looser one', () => {
  it('over the whole corpus, SQL accepts ⟹ TS accepts (and both agree, case for case)', async () => {
    const sql = await mapLimit(WHOLE_CORPUS, 32, (c) => sqlVerdict(c.doc))
    const looser = WHOLE_CORPUS.map((c, i) => ({
      label: c.label,
      ts: tsVerdict(c.doc),
      sql: sql[i],
    })).filter((r) => r.sql === 'ACCEPT' && r.ts !== 'ACCEPT')
    expect(looser).toEqual([])
    // The corpus size is a stored literal for the same reason ONE_FAMILY_EACH's
    // is: a parity suite rots by SHRINKING, quietly, and a count that has to be
    // edited by hand makes that a deliberate act.
    expect(WHOLE_CORPUS).toHaveLength(668)
    // Non-vacuity: the corpus contains both verdicts in quantity, so "no
    // looser case" cannot mean "nothing was accepted" (CLAUDE.md: never let
    // "nothing happened" mean "it worked").
    expect(sql.filter((v) => v === 'ACCEPT').length).toBeGreaterThan(50)
    expect(sql.filter((v) => v.startsWith('REJECT|')).length).toBeGreaterThan(200)
    expect(sql.filter((v) => v.startsWith('ERROR|'))).toEqual([])
  })
})

/**
 * The decimal rule is the one place the two number models genuinely differ,
 * and the difference is measured here rather than described.
 *
 * TS asks `/^-?\d+(\.\d{1,2})?$/.test(String(v))` of a parsed IEEE-754 double.
 * SQL asks `scale(trim_scale(v)) <= 2` of the `jsonb` numeric, which preserves
 * the request body's literal byte-exactly — so the two see DIFFERENT objects,
 * and only a raw request body can show it. `supabase-js` would `JSON.stringify`
 * the difference away (that is the point of the probe), so these cases go over
 * `fetch` with a hand-built body.
 */
const rawRpc = async (bodyJson: string): Promise<string> => {
  const res = await fetch(`${LOCAL_URL}/rest/v1/rpc/scoring_rules_validate`, {
    method: 'POST',
    headers: {
      apikey: LOCAL_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: bodyJson,
  })
  if (res.status === 204) return 'ACCEPT'
  const body = (await res.json()) as { code?: string; hint?: string; details?: string }
  return `REJECT|${body.hint}|${body.details}`
}

/** TS's verdict from the SAME raw bytes — `JSON.parse`, so the doubles the
 *  engine will actually score with. */
const tsVerdictRaw = (docJson: string): string => tsVerdict(JSON.parse(docJson))
// ESPN Standard already carries `pass_yards`, so the appended member is a
// DUPLICATE JSON key — kept deliberately, because `JSON.parse` and `jsonb`
// both take the LAST occurrence, which is what makes the literal reach both
// layers unchanged. (Measured: the 0.30000000000000004 case below refuses,
// which it could only do if the appended value won on the SQL side too.)
/** Send an arbitrary raw document body — the transport that actually reaches
 *  the number-model edges. */
const rawValidate = async (docJson: string): Promise<string> =>
  rawRpc(`{"p_rules":${docJson}}`)

const rawDoc = (literal: string): string =>
  `{"p_rules":${JSON.stringify(template('ESPN Standard')).slice(0, -1)},"pass_yards":${literal}}}`

describe('the decimal rule: the trailing-zero class, and the one-sided residue', () => {
  // `scale()` ALONE — D269(6)s literal hand-off — refuses every one of these,
  // while TS accepts them, because `jsonb` keeps the trailing zeros `String()`
  // never prints. `trim_scale()` drops exactly those zeros and the two layers
  // agree. This is the finding SE.4 owed: the hand-off was a tuning parameter
  // away from a real divergence, and it was closed rather than documented.
  it.each(['0.100', '0.10', '1.00', '100.00', '0.070', '4.0', '-2.00', '12.340', '1e2', '1.5e1'])(
    'trailing zeros / exponent form: pass_yards = %s is accepted by BOTH layers',
    async (literal) => {
      const text = rawDoc(literal)
      expect(validateScoringRulesDoc(JSON.parse(text).p_rules)).toEqual({
        valid: true,
        violations: [],
      })
      expect(await rawRpc(text)).toBe('ACCEPT')
    },
  )

  // The residue, stated out loud: a literal carrying MORE decimal places than
  // its nearest double's shortest rendering. SQL refuses it, TS accepts it —
  // SQL is the STRICTER side, which is the direction the wall must fail in
  // (a loud refusal at the save, never a silent admission). It is unreachable
  // from `JSON.stringify`, which never emits more digits than the shortest
  // round-trip: the assertion below measures that, it does not assume it.
  it.each(['1.0000000000000000001', '0.1000000000000000055511151231257827'])(
    'a >17-significant-decimal literal (%s) is refused by SQL and accepted by TS — the SAFE direction, measured',
    async (literal) => {
      const text = rawDoc(literal)
      const parsed = JSON.parse(text).p_rules as Record<string, number>
      expect(validateScoringRulesDoc(parsed).valid).toBe(true)
      expect(await rawRpc(text)).toBe('REJECT|bounds|pass_yards')
      // …and it cannot arrive from a client that serialises normally.
      expect(JSON.stringify(parsed.pass_yards)).not.toBe(literal)
      expect(await rawRpc(rawDoc(JSON.stringify(parsed.pass_yards)))).toBe('ACCEPT')
    },
  )
})

describe('the number-model edges — measured over RAW BYTES, because the client cannot deliver them', () => {
  /**
   * **This block exists because the rest of the suite has exactly one
   * transport, and that transport is `JSON.stringify` (R599/R601).**
   *
   * Anything that literal cannot render faithfully is invisible to all 668
   * corpus documents, to the 80,000-document fuzz, and to all 31 break probes:
   *
   *   JSON.stringify([0, 1e400])              → "[0,null]"
   *   JSON.stringify([0, 9007199254740993])   → "[0,9007199254740992]"   ← a
   *                                             DIFFERENT integer, silently
   *
   * The second one is how a real defect survived every layer of this suite:
   * `numeric` separates integers above 2^53 that IEEE-754 double cannot, so
   * `[0, 2^53, 2^53+1]` ascends in SQL and REPEATS a cut in JS. SQL accepted
   * it (HTTP 204); TS refused it; and `tierKeysFromCuts` — on the production
   * scoring path via `tierBucketsFromCuts` → `deriveTierIndicators` — threw on
   * it. The cap is now 2^53 in both the residual and the generator.
   *
   * Every case below therefore ships its document as **literal text**, parsed
   * by `JSON.parse` for TS and by `jsonb` for SQL, so both layers see the same
   * bytes rather than the same JS value.
   */
  const YA = '[0,100,200,300,350,400,450,500,550]'
  const doc = (base: string, pa: string) =>
    `{"format":2,"base":${base},"positions":{},"tier_cuts":{"def_pa":${pa},"def_ya":${YA}}}`

  const AGREE: Array<{ label: string; json: string; verdict: string }> = [
    {
      label: 'R599: a list that ascends in numeric and REPEATS once parsed as doubles',
      json: doc('{}', '[0,9007199254740992,9007199254740993]'),
      verdict: 'REJECT|tier_cuts|tier_cuts.def_pa',
    },
    {
      label: 'R599 second instance: 1e21 and 1e21+1',
      json: doc('{}', '[0,1e21,1000000000000000000001]'),
      verdict: 'REJECT|tier_cuts|tier_cuts.def_pa',
    },
    {
      label: '2^53 EXACTLY — inside the boundary, and cut-1 is still exact',
      json: doc('{}', '[0,9007199254740992]'),
      verdict: 'ACCEPT',
    },
    {
      label: 'a cut that parses to Infinity (the case [0,1e400] could never deliver)',
      json: doc('{}', '[0,1e400]'),
      verdict: 'REJECT|tier_cuts|tier_cuts.def_pa',
    },
    {
      label: 'a negative cut that parses to -Infinity',
      json: doc('{}', '[-1e400,0]'),
      verdict: 'REJECT|tier_cuts|tier_cuts.def_pa',
    },
    { label: 'the published ESPN list (control)', json: doc('{}', '[0,1,7,14,18,28,35,46]'), verdict: 'ACCEPT' },
  ]

  it.each(AGREE)('$label — both layers agree, family and path', async ({ json, verdict }) => {
    expect(tsVerdictRaw(json)).toBe(verdict)
    expect(await rawValidate(json)).toBe(verdict)
  })

  /**
   * Above 2^53 the two number models genuinely cannot be reconciled, so SQL is
   * deliberately the STRICTER side — the wall fails loud rather than admitting
   * a list the engine would read as a different list. Stated as measurement,
   * with witnesses, exactly like the >17-significant-decimal residue.
   */
  const SQL_STRICTER: Array<{ label: string; json: string; ts: string; sql: string }> = [
    {
      label: '2^53 + 1 as a single cut',
      json: doc('{}', '[0,9007199254740993]'),
      ts: 'ACCEPT',
      sql: 'REJECT|tier_cuts|tier_cuts.def_pa',
    },
    {
      label: '1.5e308 — a finite JS integer above 2^53',
      json: doc('{}', '[0,1.5e308]'),
      ts: 'ACCEPT',
      sql: 'REJECT|tier_cuts|tier_cuts.def_pa',
    },
    {
      label: '1e20 — reachable through plain JSON.stringify, and it used to fork the KEY NAMES',
      json: doc('{}', '[0,100000000000000000000]'),
      ts: 'ACCEPT',
      sql: 'REJECT|tier_cuts|tier_cuts.def_pa',
    },
    {
      // Both refuse; the FAMILY differs, because TS considers the list sound
      // and refuses at guardrail 2 while SQL voids the list at the residual.
      label: '1.5e308 while paying def_pa_0 — both refuse, different family',
      json: doc('{"def_pa_0":1}', '[0,1.5e308]'),
      ts: 'REJECT|tier_exclusivity|base.def_pa_0',
      sql: 'REJECT|tier_cuts|tier_cuts.def_pa',
    },
  ]

  it.each(SQL_STRICTER)('$label — SQL is the stricter side, measured', async ({ json, ts, sql }) => {
    expect(tsVerdictRaw(json)).toBe(ts)
    expect(await rawValidate(json)).toBe(sql)
  })

  it('THE PROPERTY, restated over the edges that broke it: SQL accepts ⟹ TS accepts', async () => {
    const all = [...AGREE.map((c) => c.json), ...SQL_STRICTER.map((c) => c.json)]
    for (const json of all) {
      const sql = await rawValidate(json)
      if (sql === 'ACCEPT') expect(tsVerdictRaw(json), json).toBe('ACCEPT')
    }
    // Non-vacuity: the set really does contain accepts on the SQL side.
    const accepts = await Promise.all(all.map((j) => rawValidate(j)))
    expect(accepts.filter((v) => v === 'ACCEPT').length).toBeGreaterThan(0)
  })

  it('the generator refuses above 2^53 too — the same cap at the other door', async () => {
    const keys = await fetch(`${LOCAL_URL}/rest/v1/rpc/scoring_tier_keys_from_cuts`, {
      method: 'POST',
      headers: {
        apikey: LOCAL_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{"p_prefix":"def_pa","p_cuts":[0,9007199254740993]}',
    })
    expect(keys.status).toBe(400)
    const body = (await keys.json()) as { code?: string; message?: string }
    expect(body.code).toBe('22023')
    // R600's E75 half: the refusal names MAGNITUDE, not integrality. The first
    // cut of this clause told a caller that 1.5e308 "must be an integer".
    expect(body.message).toMatch(/exactly-representable integer range/)
  })
})

describe('the empty-string key: SQL distinguishes what TS cannot (R602)', () => {
  // `""` is a legal JSON key. The DETAIL sentinel used to be "empty path ⇒
  // (document)", so this concrete field violation was reported to SE.5/SE.6 as
  // a document-level refusal. The fixture could not see it, because the parity
  // helper normalises `'' → (document)` before comparing — it erased the
  // distinction under test.
  it('a flat {"": 1} is a FIELD violation in SQL, with an empty path — not (document)', async () => {
    const ts = validateScoringRulesDoc({ '': 1 })
    expect(ts.violations.map((v) => [v.code, v.path])).toEqual([['scorable_allowlist', '']])
    expect(await rawValidate('{"":1}')).toBe('REJECT|scorable_allowlist|')
  })

  it('…and a genuine document-level refusal still says (document), so the two differ', async () => {
    expect(await rawValidate('{"def_pa_14_20":4,"def_pa_18_27":3}')).toBe(
      'REJECT|tier_exclusivity|(document)',
    )
  })

  it('TS is the layer that still cannot tell them apart — named, and routed to F138', () => {
    // Both come back with path ''. This is a `validate-rules-doc.ts` contract
    // that SE.6's route layer consumes, so SE.4 does not change it from under
    // it; it is filed instead (ledger F138), together with the `base.` path a
    // format-2 empty key produces, whose `split('.')` has an empty segment.
    expect(validateScoringRulesDoc({ '': 1 }).violations[0].path).toBe('')
    expect(
      validateScoringRulesDoc({ def_pa_14_20: 4, def_pa_18_27: 3 }).violations[0].path,
    ).toBe('')
    expect(
      validateScoringRulesDoc({
        format: 2,
        base: { '': 1 },
        positions: {},
        tier_cuts: { def_pa: ESPN_PA_CUTS, def_ya: YA_CUTS },
      }).violations[0].path,
    ).toBe('base.')
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * §D — the generator twin (SE.4(2)) and the deployed form
 * ──────────────────────────────────────────────────────────────────────── */

describe('scoring_tier_keys_from_cuts ≡ tierKeysFromCuts (SE.4(2))', () => {
  const FAMILIES: Array<[string, readonly number[]]> = [
    [DEF_PA_PREFIX, SHARED_PA_CUTS],
    [DEF_PA_PREFIX, ESPN_PA_CUTS],
    [DEF_YA_PREFIX, YA_CUTS],
  ]

  it.each(FAMILIES.map(([prefix, cuts]) => ({ prefix, cuts })))(
    '$prefix $cuts — the SQL twin regenerates the family byte-exactly',
    async ({ prefix, cuts }) => {
      const { data, error } = await db.rpc('scoring_tier_keys_from_cuts', {
        p_prefix: prefix,
        p_cuts: cuts as never,
      })
      expect(error).toBeNull()
      expect(data).toEqual(tierKeysFromCuts(prefix, cuts))
    },
  )

  // Shapes the three published families do NOT contain, so the two
  // implementations of the naming rule are compared where they could differ:
  // an interior single-value tier, a negative first cut, a two-cut list, and
  // an integer written with a decimal point (`${7}` is "7" in JS; `7.0::text`
  // is "7.0", which would silently mint `def_pa_7.0_13`).
  const SHAPES: Array<readonly number[]> = [
    [0, 1], [0, 1, 2], [-5, 0, 5], [0, 10, 11, 20], [3, 4, 100], [0, 2, 3, 4, 5],
  ]
  it.each(SHAPES.map((cuts) => ({ cuts })))(
    'generation shape $cuts agrees with the TS generator',
    async ({ cuts }) => {
      const { data, error } = await db.rpc('scoring_tier_keys_from_cuts', {
        p_prefix: 'def_pa',
        p_cuts: cuts as never,
      })
      expect(error).toBeNull()
      expect(data).toEqual(tierKeysFromCuts('def_pa', cuts))
    },
  )

  it('an integer written as 7.0 renders as `7`, not `7.0` (the rendering trap)', async () => {
    // OVER RAW `fetch`, and that is the whole point: `supabase-js` would
    // `JSON.stringify` the literal to `7` before it left the process, so an
    // `.rpc()` call here would assert nothing about the trap it names. The
    // measurement: with `trim_scale` removed from the generator's rendering
    // this test goes RED; with the literal serialised normally it cannot.
    const res = await fetch(`${LOCAL_URL}/rest/v1/rpc/scoring_tier_keys_from_cuts`, {
      method: 'POST',
      headers: {
        apikey: LOCAL_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{"p_prefix":"def_pa","p_cuts":[0,7.0,14.00]}',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(['def_pa_0_6', 'def_pa_7_13', 'def_pa_14_plus'])
  })

  it.each([
    { label: '1 cut (one unit below the ≥ 2 floor)', cuts: [0] },
    { label: 'a flat pair', cuts: [0, 7, 7] },
    { label: 'a descending pair', cuts: [0, 7, 6] },
    { label: 'a non-integer cut', cuts: [0, 7.5] },
    // NOT `[0, 1e400]`: supabase-js sends `[0,null]`, which refuses for a
    // different reason than the label claimed (R601). 2^53 + 1 is a number the
    // serializer DOES preserve... as a different integer — so even this case
    // is only honest because the assertion is about the refusal, not the value.
    // The value-exact version is in "the number-model edges" block.
    { label: 'a null cut (what [0, 1e400] actually serialises to)', cuts: [0, null] },
  ])('$label raises 22023 rather than generating a plausible name', async ({ cuts }) => {
    const { error } = await db.rpc('scoring_tier_keys_from_cuts', {
      p_prefix: 'def_pa',
      p_cuts: cuts as never,
    })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('22023')
    expect(error!.message).toMatch(/§7\.3\.3\.1\(c\)/)
  })

  it('2 cuts — one unit ABOVE the floor — generate two tiers (D146)', async () => {
    const { data, error } = await db.rpc('scoring_tier_keys_from_cuts', {
      p_prefix: 'def_pa',
      p_cuts: [0, 7] as never,
    })
    expect(error).toBeNull()
    expect(data).toEqual(['def_pa_0_6', 'def_pa_7_plus'])
  })
})

describe('the deployed form (D18/D23 grants doctrine, end to end)', () => {
  it('anon cannot execute either function — the REVOKE is real over the wire', async () => {
    const anonDb = createClient(LOCAL_URL, LOCAL_ANON_KEY)
    const validate = await anonDb.rpc('scoring_rules_validate', {
      p_rules: template('ESPN Standard') as never,
    })
    expect(validate.error?.code).toBe('42501')
    const keys = await anonDb.rpc('scoring_tier_keys_from_cuts', {
      p_prefix: 'def_pa',
      p_cuts: ESPN_PA_CUTS as never,
    })
    expect(keys.error?.code).toBe('42501')
  })

  it('the six templates AS STORED IN THE DATABASE pass — not the TS copies', async () => {
    const { data, error } = await db
      .from('scoring_systems')
      .select('name, rules')
      .eq('is_template', true)
    expect(error).toBeNull()
    const rows = (data ?? []) as Array<{ name: string; rules: Record<string, number> }>
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      const result = await db.rpc('scoring_rules_validate', { p_rules: row.rules as never })
      expect(result.error, `stored template ${row.name} was refused`).toBeNull()
      expect(validateScoringRulesDoc(row.rules).violations).toEqual([])
      // …and a fork of the STORED rules passes the format-2 arm too, which is
      // the document SE.5's fork RPC will actually insert.
      const forked = forkTemplateDoc(row.rules)
      const forkResult = await db.rpc('scoring_rules_validate', { p_rules: forked as never })
      expect(forkResult.error, `fork of stored template ${row.name} was refused`).toBeNull()
    }
  })
})
