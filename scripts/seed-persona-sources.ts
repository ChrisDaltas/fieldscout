/**
 * Seed persona_sources from the roster's content-feed registry
 * (spec-ai-content-engine.md, Slice A). Free, non-paywalled feeds only —
 * roster.ts ships with empty `sources` until each feed is confirmed free.
 *
 *   npm run seed:persona-sources
 *
 * Idempotent: skips (persona, url) pairs that already exist; never touches
 * change-detection state or takedown flags on existing rows.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

import { PERSONA_ROSTER } from '../src/lib/personas/roster'

config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main(): Promise<void> {
  const { data: personas, error } = await supabase
    .from('ai_personas')
    .select('id, username')
    .is('deleted_at', null)
  if (error) throw error
  const idByUsername = new Map(
    (personas ?? []).map((p) => [p.username as string, p.id as string]),
  )

  let inserted = 0
  let skipped = 0
  for (const persona of PERSONA_ROSTER) {
    const personaId = idByUsername.get(persona.username)
    if (!personaId) {
      console.warn(`- ${persona.username} not in DB (run npm run seed:personas first)`)
      continue
    }
    if (persona.sources.length === 0) {
      console.log(`- ${persona.username}: no confirmed free sources yet`)
      continue
    }

    for (const source of persona.sources) {
      // The existence check is the only duplicate guard — a swallowed read
      // error here would turn into duplicate inserts, so fail loudly.
      const { data: existing, error: checkError } = await supabase
        .from('persona_sources')
        .select('id')
        .eq('ai_persona_id', personaId)
        .eq('url', source.url)
        .maybeSingle()
      if (checkError) throw checkError
      if (existing) {
        skipped++
        continue
      }

      const { error: insertError } = await supabase.from('persona_sources').insert({
        ai_persona_id: personaId,
        type: source.type,
        url: source.url,
        label: source.label ?? null,
        is_paywalled: false,
        is_active: true,
      })
      if (insertError) throw insertError
      inserted++
      console.log(`  + ${persona.username}: ${source.type} ${source.url}`)
    }
  }

  console.log(`\nDone — ${inserted} source(s) inserted, ${skipped} already present.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
