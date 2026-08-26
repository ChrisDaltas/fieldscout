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
 *  TS and `(document)` in SQL (the DETAIL sentinel, so PostgREST cannot turn
 *  "the document itself" into `null` and lose the distinction). */
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

/** The whole-corpus assertion: verdict, family and path identical, reported
 *  with the labels of every case that disagreed (a bare count is unreadable). */
const expectParity = async (cases: readonly Case[]): Promise<number> => {
  expect(cases.length).toBeGreaterThan(0) // never a vacuous sweep (F94 shape)
  const sql = await mapLimit(cases, 32, (c) => sqlVerdict(c.doc))
  const disagreements = cases
    .map((c, i) => ({ label: c.label, ts: tsVerdict(c.doc), sql: sql[i] }))
    .filter((r) => r.ts !== r.sql)
  expect(disagreements).toEqual([])
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

const COEFFICIENT_EDGES = [
  100, -100, 100.01, -100.01, 0.01, -0.01, 0.001, 0, 1, 0.1, 0.07, 99.99, 2.5001,
  0.30000000000000004, 1e-7, 1e21, 1e400, -1e400, 1.5, 12.34, 0.005, 50.5,
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
  [0, 7.5, 14], [0, '7', 14], [0, null, 14], [0, true], [0, [7]], [0, 1e400],
  [-1e400, 0], 'x', 42, null, {}, true,
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
  // MEASURED, and it went the other way from how it was first written — the
  // note is here because F59 inherits it (ledger F137). Guardrail 1 (the
  // REGISTRY allowlist) runs ahead of guardrail 2 (the document's own cuts),
  // and §23.5 carries exactly the 20 PUBLISHED tier key names — so a
  // per-league re-cut cannot today name a tier outside those 20, even though
  // §7.3.3.1(a) reserves the cut points per league. BOTH layers agree, which
  // is what these two cases pin; the constraint is the spec's, not a mirror
  // defect.
  {
    label: 'a key the docs OWN re-cut table generates but the registry does not carry',
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
    await expectParity(envelopeCases)
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
// ESPN Standard already carries `pass_yards`, so the appended member is a
// DUPLICATE JSON key — kept deliberately, because `JSON.parse` and `jsonb`
// both take the LAST occurrence, which is what makes the literal reach both
// layers unchanged. (Measured: the 0.30000000000000004 case below refuses,
// which it could only do if the appended value won on the SQL side too.)
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
    { label: 'a cut past the double range (Number.isInteger(Infinity) is false)', cuts: [0, 1e400] },
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
