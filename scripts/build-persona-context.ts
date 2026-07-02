/**
 * On-demand persona context builder (spec-ai-content-engine.md, Slice A —
 * the manual precursor to the daily ingestion cron).
 *
 *   npm run build:persona-context             # all active personas
 *   npm run build:persona-context bathew-merry-ai   # one persona
 *
 * Per active persona:
 *   - With ingested material (persona_content_items / persona_source_rankings):
 *     synthesize the context with Claude (requires ANTHROPIC_API_KEY).
 *   - With NO material yet: write a deterministic seed context from the
 *     style_profile — no Claude call, no invented stances. Skipped when a
 *     context row already exists (never downgrade a synthesized context).
 *
 * Versioning: the prior context is snapshotted into persona_context_versions
 * and version bumps on every write; last_material_change_at is set only when
 * stances meaningfully changed (the flag Slice B/C listen for).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

import { CLAUDE_GENERATION_MODEL } from '../src/lib/claude/models'
import { logAiCall } from '../src/lib/claude/telemetry'
import {
  CONTEXT_MAX_ITEMS,
  CONTEXT_MAX_RANKINGS,
  hasMaterialChange,
  renderContextMd,
  seedContextFromProfile,
  synthesizePersonaContext,
  type ContentItemForSynthesis,
  type SourceRankingForSynthesis,
} from '../src/lib/personas/context'
import type { PersonaStyleProfile } from '../src/lib/personas/roster'
import {
  personaContextSchema,
  type PersonaContext,
} from '../src/types/schemas/persona-context'

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

interface PersonaRow {
  id: string
  username: string
  display_name: string
  style_profile: PersonaStyleProfile
}

interface ExistingContext {
  context: PersonaContext | null
  version: number
  raw: unknown
  last_material_change_at: string | null
}

async function loadExistingContext(personaId: string): Promise<ExistingContext | null> {
  const { data, error } = await supabase
    .from('persona_context')
    .select('context, version, last_material_change_at')
    .eq('ai_persona_id', personaId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const parsed = personaContextSchema.safeParse(data.context)
  return {
    context: parsed.success ? parsed.data : null,
    version: (data.version as number | null) ?? 1,
    raw: data.context,
    last_material_change_at: data.last_material_change_at as string | null,
  }
}

async function writeContext(
  persona: PersonaRow,
  next: PersonaContext,
  sourceItemCount: number,
  existing: ExistingContext | null,
): Promise<void> {
  const material = hasMaterialChange(existing?.context ?? null, next)
  const now = new Date().toISOString()
  const renderedMd = renderContextMd(persona.display_name, next)

  if (existing) {
    // Snapshot the prior version before overwriting (audit trail). Guarded
    // against re-inserts: a run that snapshotted and then failed the update
    // must not duplicate the snapshot on retry.
    const { data: priorSnap, error: snapCheckError } = await supabase
      .from('persona_context_versions')
      .select('id')
      .eq('ai_persona_id', persona.id)
      .eq('version', existing.version)
      .limit(1)
      .maybeSingle()
    if (snapCheckError) throw snapCheckError
    if (!priorSnap) {
      const { error: snapError } = await supabase.from('persona_context_versions').insert({
        ai_persona_id: persona.id,
        version: existing.version,
        context: existing.raw as never,
      })
      if (snapError) throw snapError
    }

    const { error } = await supabase
      .from('persona_context')
      .update({
        context: next,
        rendered_md: renderedMd,
        version: existing.version + 1,
        source_item_count: sourceItemCount,
        last_material_change_at: material ? now : existing.last_material_change_at,
        updated_at: now,
      })
      .eq('ai_persona_id', persona.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('persona_context').insert({
      ai_persona_id: persona.id,
      context: next,
      rendered_md: renderedMd,
      version: 1,
      source_item_count: sourceItemCount,
      last_material_change_at: material ? now : null,
      updated_at: now,
    })
    if (error) throw error
  }

  console.log(
    `  + v${(existing?.version ?? 0) + 1} — ${next.current_stances.length} stances, ${next.themes_in_play.length} themes${material ? ' (material change)' : ''}`,
  )
}

async function buildForPersona(persona: PersonaRow): Promise<void> {
  console.log(`\n${persona.display_name}`)

  const [itemsRes, rankingsRes, existing] = await Promise.all([
    supabase
      .from('persona_content_items')
      .select('source_url, source_type, title, published_at, ingested_at, extracted')
      .eq('ai_persona_id', persona.id)
      .order('ingested_at', { ascending: false })
      .limit(CONTEXT_MAX_ITEMS),
    supabase
      .from('persona_source_rankings')
      .select('source_url, source_published_at, position, scoring, raw_rankings')
      .eq('ai_persona_id', persona.id)
      .order('scraped_at', { ascending: false })
      .limit(CONTEXT_MAX_RANKINGS),
    loadExistingContext(persona.id),
  ])
  if (itemsRes.error) throw itemsRes.error
  if (rankingsRes.error) throw rankingsRes.error

  const items = (itemsRes.data ?? []) as ContentItemForSynthesis[]
  const rankings = (rankingsRes.data ?? []) as SourceRankingForSynthesis[]
  const asOf = new Date().toISOString().slice(0, 10)

  if (items.length === 0 && rankings.length === 0) {
    if (existing) {
      console.log('  ✓ no source material; existing context left unchanged')
      return
    }
    console.log('  · no source material — writing deterministic seed context')
    await writeContext(persona, seedContextFromProfile(persona.style_profile, asOf), 0, null)
    return
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  ! source material exists but ANTHROPIC_API_KEY is unset — skipping')
    return
  }

  try {
    const { context, droppedUngrounded, inputTokens, outputTokens, latencyMs } =
      await synthesizePersonaContext({
        displayName: persona.display_name,
        styleProfile: persona.style_profile,
        items,
        rankings,
        asOf,
      })
    if (droppedUngrounded > 0) {
      console.warn(
        `  ! dropped ${droppedUngrounded} ungrounded stance(s)/movement(s) (source_url not in supplied material)`,
      )
    }
    await logAiCall({
      feature: 'content_ingest',
      model: CLAUDE_GENERATION_MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: latencyMs,
      success: true,
    })
    await writeContext(persona, context, items.length, existing)
  } catch (err) {
    await logAiCall({
      feature: 'content_ingest',
      model: CLAUDE_GENERATION_MODEL,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

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
  const personas = (data ?? []) as unknown as PersonaRow[]
  if (personas.length === 0) {
    console.error(
      usernameFilter
        ? `No active persona found for username "${usernameFilter}"`
        : 'No active personas found — run npm run seed:personas first.',
    )
    process.exit(1)
  }

  for (const persona of personas) {
    try {
      await buildForPersona(persona)
    } catch (err) {
      console.error(`  ✗ ${persona.username} failed:`, err instanceof Error ? err.message : err)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
