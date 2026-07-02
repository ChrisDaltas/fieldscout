/**
 * On-demand persona context builder (spec-ai-content-engine.md, Slice A —
 * thin CLI over refreshPersonaContext; the daily ingestion cron uses the
 * same engine).
 *
 *   npm run build:persona-context             # all active personas
 *   npm run build:persona-context bathew-merry-ai   # one persona
 *
 * Behavior: with ingested material, synthesizes with Claude (requires
 * ANTHROPIC_API_KEY); with none, writes a deterministic seed context from
 * the style_profile — unless a context row already exists (never downgrade
 * a synthesized context to a seed).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

import {
  refreshPersonaContext,
  type PersonaForContext,
} from '../src/lib/personas/context'

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
  const usernameFilter = process.argv[2]

  let query = supabase
    .from('ai_personas')
    .select('id, username, display_name, style_profile')
    .eq('is_active', true)
    .is('deleted_at', null)
  if (usernameFilter) query = query.eq('username', usernameFilter)

  const { data, error } = await query
  if (error) throw error
  const personas = (data ?? []) as unknown as PersonaForContext[]
  if (personas.length === 0) {
    console.error(
      usernameFilter
        ? `No active persona found for username "${usernameFilter}"`
        : 'No active personas found — run npm run seed:personas first.',
    )
    process.exit(1)
  }

  for (const persona of personas) {
    console.log(`\n${persona.display_name}`)
    try {
      const result = await refreshPersonaContext(supabase, persona)
      if (result.action === 'skipped') {
        console.log(`  ✓ skipped — ${result.reason}`)
      } else {
        if ((result.droppedUngrounded ?? 0) > 0) {
          console.warn(
            `  ! dropped ${result.droppedUngrounded} ungrounded stance(s)/movement(s)`,
          )
        }
        console.log(
          `  + ${result.action} v${result.version} — ${result.stances} stances${result.materialChange ? ' (material change)' : ''}`,
        )
      }
    } catch (err) {
      console.error(`  ✗ ${persona.username} failed:`, err instanceof Error ? err.message : err)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
