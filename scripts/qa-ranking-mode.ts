/**
 * QA script for the ranking_mode migration + list-form-dialog flow.
 *
 *   npx tsx scripts/qa-ranking-mode.ts
 *
 * Validates:
 *   1. Pure-function helper round-trips for all 3 ranking modes
 *   2. Zod schema accepts the new field and the legacy fields
 *   3. Migration backfilled every existing list row consistently
 *   4. CHECK constraint rejects an invalid ranking_mode value
 *   5. Insert + select round-trips for all 3 ranking modes
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

import {
  createListSchema,
  rankingModeToLegacyFlags,
  RANKING_MODES,
  type RankingMode,
} from '../src/types/schemas/lists'

config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const FAILURES: string[] = []

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`)
    FAILURES.push(label)
  }
}

async function findAnyOwner(): Promise<string> {
  // Prefer the seed user so test rows live somewhere logical, but fall back
  // to the first available profile for round-trip tests.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  const dev = data.users.find((u) => u.email === 'dev@fieldscout.local')
  if (dev) return dev.id
  const any = data.users[0]
  if (!any) {
    throw new Error('No users found in auth.users — cannot run insert round-trip.')
  }
  // Make sure they have a profile row (lists.owner_id FKs to profiles).
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', any.id)
    .maybeSingle()
  if (!profile) {
    throw new Error(`Auth user ${any.id} has no profile row — pick a different user.`)
  }
  return any.id
}

async function testHelper() {
  console.log('\n1. rankingModeToLegacyFlags helper')
  const expected: Record<RankingMode, { hide_order: boolean; tiers_enabled: boolean }> = {
    unranked: { hide_order: true, tiers_enabled: false },
    ranked: { hide_order: false, tiers_enabled: false },
    rank_and_tier: { hide_order: false, tiers_enabled: true },
  }
  for (const mode of RANKING_MODES) {
    const out = rankingModeToLegacyFlags(mode)
    check(
      `${mode} → hide_order=${expected[mode].hide_order}, tiers_enabled=${expected[mode].tiers_enabled}`,
      out.hide_order === expected[mode].hide_order &&
        out.tiers_enabled === expected[mode].tiers_enabled,
      `got ${JSON.stringify(out)}`,
    )
  }
}

function testSchema() {
  console.log('\n2. createListSchema validation')
  const valid = createListSchema.safeParse({
    title: 'QA test',
    ranking_mode: 'rank_and_tier',
    is_private: false,
  })
  check('accepts ranking_mode field', valid.success)

  const legacy = createListSchema.safeParse({
    title: 'QA legacy',
    hide_order: true,
    tiers_enabled: false,
    is_private: true,
  })
  check('accepts legacy hide_order / tiers_enabled', legacy.success)

  const bad = createListSchema.safeParse({
    title: 'QA bad',
    ranking_mode: 'nonsense',
  })
  check('rejects invalid ranking_mode value', !bad.success)

  const empty = createListSchema.safeParse({ title: '' })
  check('rejects empty title', !empty.success)
}

async function testBackfill() {
  console.log('\n3. Migration backfill on live data')
  const { data, error, count } = await supabase
    .from('lists')
    .select('id, ranking_mode, hide_order, tiers_enabled', { count: 'exact' })
  if (error) throw error
  if (!data) throw new Error('No data returned')

  check(`total lists scanned: ${count}`, true)

  const missing = data.filter((row) => row.ranking_mode == null)
  check('every list has ranking_mode populated', missing.length === 0, `${missing.length} missing`)

  const mismatches = data.filter((row) => {
    const expected = row.hide_order
      ? 'unranked'
      : row.tiers_enabled
        ? 'rank_and_tier'
        : 'ranked'
    return row.ranking_mode !== expected
  })
  check(
    'ranking_mode matches derived value from legacy booleans',
    mismatches.length === 0,
    `${mismatches.length} mismatched`,
  )
}

async function testCheckConstraint(ownerId: string) {
  console.log('\n4. CHECK constraint rejects invalid ranking_mode')
  const { error } = await supabase.from('lists').insert({
    owner_id: ownerId,
    title: 'qa-check-violation',
    slug: `qa-check-violation-${Date.now()}`,
    ranking_mode: 'definitely-not-a-mode',
  })
  check(
    'CHECK rejects invalid value',
    !!error,
    error ? `(got expected error: ${error.code})` : '(no error thrown — CHECK is missing!)',
  )
}

async function testRoundTrip(ownerId: string) {
  console.log('\n5. Insert + select round-trip per mode')
  const createdIds: string[] = []
  try {
    for (const mode of RANKING_MODES) {
      const flags = rankingModeToLegacyFlags(mode)
      const slug = `qa-${mode}-${Date.now()}`
      const { data, error } = await supabase
        .from('lists')
        .insert({
          owner_id: ownerId,
          title: `QA ${mode}`,
          slug,
          ranking_mode: mode,
          hide_order: flags.hide_order,
          tiers_enabled: flags.tiers_enabled,
        })
        .select()
        .single()
      if (error) {
        check(`insert ${mode}`, false, error.message)
        continue
      }
      if (!data) {
        check(`insert ${mode}`, false, 'no row returned')
        continue
      }
      createdIds.push(data.id)
      check(
        `insert ${mode}: row.ranking_mode === ${mode}`,
        data.ranking_mode === mode,
        `got ${data.ranking_mode}`,
      )
      check(
        `insert ${mode}: legacy flags consistent`,
        data.hide_order === flags.hide_order && data.tiers_enabled === flags.tiers_enabled,
        `got hide_order=${data.hide_order}, tiers_enabled=${data.tiers_enabled}`,
      )
    }
  } finally {
    if (createdIds.length > 0) {
      const { error: cleanupErr } = await supabase
        .from('lists')
        .delete()
        .in('id', createdIds)
      if (cleanupErr) {
        console.log(`  ! cleanup failed: ${cleanupErr.message}`)
      } else {
        console.log(`  • cleaned up ${createdIds.length} test rows`)
      }
    }
  }
}

async function main() {
  console.log('QA: ranking_mode migration + form-dialog plumbing')
  await testHelper()
  testSchema()
  await testBackfill()
  const ownerId = await findAnyOwner()
  await testCheckConstraint(ownerId)
  await testRoundTrip(ownerId)

  console.log('\n---')
  if (FAILURES.length === 0) {
    console.log('All checks passed.')
  } else {
    console.log(`${FAILURES.length} failure(s):`)
    for (const f of FAILURES) console.log(`  - ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
