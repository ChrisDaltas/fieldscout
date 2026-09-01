/**
 * templates-db.test.ts — the L.A1.9(5) TS↔DB equivalence link (mechanical,
 * not honor-system): SELECTs each of the 8 seeded template rows from the
 * LOCAL Supabase stack and deep-equals `row.rules` against the
 * corresponding `templates.ts` export (values, not just keys) — so the
 * rules the parity gate tests in TS (L.A1.10) are provably the rules
 * production snapshots freeze from the DB (§7.3.3). Joins the M1 gate
 * suite (L.A1.16, gate item (c)).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * the same precondition `npm run test:db` already has. Deliberately reads
 * via the ANON key so the world-readable template surface (058 policy,
 * D34 — the picker's pre-auth path) is exercised end-to-end. If the stack
 * is down the suite FAILS (never skips — §4.3 falsifiability; D59).
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { SCORING_TEMPLATES } from './templates'

// The Supabase CLI's fixed local development URL + demo anon key (printed by
// `npx supabase status`; not a secret — it is the same for every local
// stack). Overridable for a non-default local setup.
const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

interface TemplateRow {
  name: string
  description: string | null
  rules: Record<string, number>
  owner_id: string | null
  is_template: boolean
  is_system_default: boolean | null
}

describe('TS↔DB template equivalence (L.A1.9(5) — local stack, anon read path)', () => {
  const fetchRows = async (): Promise<TemplateRow[]> => {
    const supabase = createClient(LOCAL_URL, LOCAL_ANON_KEY)
    const { data, error } = await supabase
      .from('scoring_systems')
      .select('name, description, rules, owner_id, is_template, is_system_default')
      .eq('is_template', true)
    if (error) {
      throw new Error(
        `local stack read failed (is \`npx supabase start\` running with migrations applied?): ${error.message}`,
      )
    }
    return data as unknown as TemplateRow[]
  }

  it('the DB holds exactly the eight authored templates, rules deep-equal (values, not just keys)', async () => {
    const rows = await fetchRows()
    expect(rows.map((r) => r.name).sort()).toEqual(
      SCORING_TEMPLATES.map((t) => t.name).sort(),
    )
    for (const template of SCORING_TEMPLATES) {
      const row = rows.find((r) => r.name === template.name)
      expect(row, template.name).toBeDefined()
      // toStrictEqual: value AND key-set equality — a drifted coefficient,
      // a dropped key, or an extra key in the migration all fail here.
      expect(row!.rules, `${template.name} rules`).toStrictEqual(template.rules)
    }
  })

  it('descriptions match the authored ones — the Q9 user-visibility condition survives to the DB', async () => {
    const rows = await fetchRows()
    for (const template of SCORING_TEMPLATES) {
      const row = rows.find((r) => r.name === template.name)
      expect(row!.description, template.name).toBe(template.description)
    }
  })

  it('every template row is owner-less and not a research-surface system default (D34)', async () => {
    const rows = await fetchRows()
    for (const row of rows) {
      expect(row.owner_id, row.name).toBeNull()
      expect(row.is_system_default, row.name).toBe(false)
    }
  })
})
