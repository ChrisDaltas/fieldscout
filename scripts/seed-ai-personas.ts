/**
 * Seed the AI expert persona roster (spec-ai-expert-personas.md):
 *   1. Ensure the system expert owner account exists (auth user + profile
 *      'fieldscout-ai') — the owner of every persona list.
 *   2. Upsert the persona roster from src/lib/personas/roster.ts.
 *   3. Generate initial persona lists with Claude (requires ANTHROPIC_API_KEY
 *      and a synced players table — skipped with a notice when unavailable).
 *
 *   npm run seed:personas
 *
 * Idempotent: personas upsert on username; lists are skipped when their slug
 * already exists for the system owner.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import {
  PERSONA_LIST_PLAYER_COUNT,
  PERSONA_MAX_LISTS_PER_RUN,
} from '../src/lib/claude/limits'
import { CLAUDE_GENERATION_MODEL } from '../src/lib/claude/models'
import {
  generatePersonaList,
  type SourceRankEntry,
} from '../src/lib/claude/persona-gen'
import {
  buildPlayerPacket,
  resolveGeneratedPlayers,
} from '../src/lib/claude/player-packet'
import { logAiCall } from '../src/lib/claude/telemetry'
import { generateUniqueSlug, slugify } from '../src/lib/lists/helpers'
import { findRealAnalystNames } from '../src/lib/personas/blocklist'
import { PERSONA_ROSTER, type PersonaSeed } from '../src/lib/personas/roster'
import type { AiPosition } from '../src/types/schemas/ai'

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

/** System expert owner (migration 020 comment documents this decision):
 * a seeded profiles row, resolved by username — no hardcoded UUID. */
const SYSTEM_OWNER = {
  email: 'ai-system@fieldscout.local',
  username: 'fieldscout-ai',
  displayName: 'FieldScout AI',
}

/** Positions seeded per persona, capped by the per-run safety valve. */
const SEED_POSITIONS: AiPosition[] = (
  ['Overall', 'RB', 'WR', 'QB'] as AiPosition[]
).slice(0, PERSONA_MAX_LISTS_PER_RUN)

async function ensureSystemOwner(): Promise<string> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  const existing = data.users.find((u) => u.email === SYSTEM_OWNER.email)

  let userId = existing?.id
  if (!userId) {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: SYSTEM_OWNER.email,
      // Never used to log in — personas can't be signed into.
      password: randomBytes(24).toString('base64url'),
      email_confirm: true,
      user_metadata: { username: SYSTEM_OWNER.username, full_name: SYSTEM_OWNER.displayName },
    })
    if (createError) throw createError
    if (!created.user) throw new Error('createUser returned no user for system owner')
    userId = created.user.id
    console.log(`+ created system owner ${SYSTEM_OWNER.email}`)
  } else {
    console.log(`✓ system owner ${SYSTEM_OWNER.email} already exists`)
  }

  // is_pro so free-tier caps never interfere with system-written lists.
  const { error: profileError } = await supabase.from('profiles').upsert(
    {
      id: userId,
      username: SYSTEM_OWNER.username,
      display_name: SYSTEM_OWNER.displayName,
      bio: 'System account that owns FieldScout AI persona content.',
      is_pro: true,
      subscription_status: 'active',
    },
    { onConflict: 'id' },
  )
  if (profileError) throw profileError

  return userId
}

/** Personas eligible for list generation: active, not deleted. */
async function upsertPersonas(): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  for (const persona of PERSONA_ROSTER) {
    const hits = findRealAnalystNames(JSON.stringify(persona))
    if (hits.length > 0) {
      throw new Error(
        `Parody firewall violation in roster entry ${persona.username}: ${hits.join(', ')}`,
      )
    }

    // Check-then-insert/update rather than upsert: a re-run must NEVER
    // resurrect a persona taken down via is_active = FALSE or deleted_at
    // (the documented takedown path in migration 020).
    const { data: existing, error: lookupError } = await supabase
      .from('ai_personas')
      .select('id, is_active, deleted_at')
      .eq('username', persona.username)
      .maybeSingle()
    if (lookupError) throw lookupError

    if (existing) {
      if (!existing.is_active || existing.deleted_at) {
        console.log(`- persona ${persona.display_name} is taken down — leaving untouched`)
        continue
      }
      const { error } = await supabase
        .from('ai_personas')
        .update({
          display_name: persona.display_name,
          bio: persona.bio,
          style_profile: persona.style_profile,
        })
        .eq('id', existing.id)
      if (error) throw error
      ids.set(persona.username, existing.id as string)
    } else {
      const { data, error } = await supabase
        .from('ai_personas')
        .insert({
          username: persona.username,
          display_name: persona.display_name,
          bio: persona.bio,
          style_profile: persona.style_profile,
          is_active: true,
        })
        .select('id')
        .single()
      if (error) throw error
      ids.set(persona.username, data.id as string)
    }
    console.log(`✓ persona ${persona.display_name}`)
  }
  return ids
}

async function latestSourceRanks(
  personaId: string,
  position: AiPosition,
): Promise<SourceRankEntry[] | undefined> {
  const { data } = await supabase
    .from('persona_source_rankings')
    .select('raw_rankings')
    .eq('ai_persona_id', personaId)
    .eq('position', position)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const raw = data?.raw_rankings as SourceRankEntry[] | undefined
  return Array.isArray(raw) && raw.length > 0 ? raw : undefined
}

async function seedListsForPersona(
  ownerId: string,
  persona: PersonaSeed,
  personaId: string,
): Promise<void> {
  for (const position of SEED_POSITIONS) {
    const scoring = persona.style_profile.scoring_default
    const desiredSlug = slugify(`${persona.username}-${position}`)

    // UNIQUE(owner_id, slug) is absolute — a soft-deleted list still holds
    // its slug, so check without the deleted_at filter and re-slug if needed.
    const { data: existing } = await supabase
      .from('lists')
      .select('id, deleted_at')
      .eq('owner_id', ownerId)
      .eq('slug', desiredSlug)
      .maybeSingle()
    if (existing && !existing.deleted_at) {
      console.log(`  ✓ ${persona.username}/${position} already seeded`)
      continue
    }
    const slug = existing
      ? await generateUniqueSlug(supabase, ownerId, desiredSlug)
      : desiredSlug

    const packet = await buildPlayerPacket(supabase, {
      position,
      scoring,
      playerCount: PERSONA_LIST_PLAYER_COUNT,
    })
    const sourceRanks = await latestSourceRanks(personaId, position)

    let result
    try {
      result = await generatePersonaList({
        displayName: persona.display_name,
        styleProfile: persona.style_profile,
        position,
        scoring,
        playerCount: PERSONA_LIST_PLAYER_COUNT,
        packetRendered: packet.rendered,
        sourceRanks,
      })
    } catch (err) {
      await logAiCall({
        feature: 'persona_seed',
        model: CLAUDE_GENERATION_MODEL,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }

    await logAiCall({
      feature: 'persona_seed',
      model: CLAUDE_GENERATION_MODEL,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      latency_ms: result.latencyMs,
      success: true,
    })

    const resolvedAll = resolveGeneratedPlayers(result.list.players, packet.players)
    const players = resolvedAll.players.slice(0, PERSONA_LIST_PLAYER_COUNT)
    const unresolved = resolvedAll.unresolved
    if (unresolved.length > 0) {
      console.warn(
        `  ! ${persona.username}/${position}: dropped unresolved names: ${unresolved.join(', ')}`,
      )
    }
    if (players.length === 0) {
      console.warn(`  ! ${persona.username}/${position}: no resolvable players, skipping`)
      continue
    }

    // Title reflects what was actually inserted, not the requested count.
    const title = `Top ${players.length} ${position} — ${scoring}`

    const { data: list, error: listError } = await supabase
      .from('lists')
      .insert({
        owner_id: ownerId,
        ai_persona_id: personaId,
        title,
        slug,
        description: result.list.style_note,
        position_filter: position === 'Overall' ? null : position,
        ranking_mode: 'ranked',
        is_private: false,
      })
      .select('id')
      .single()
    if (listError) throw listError

    const { error: playersError } = await supabase.from('list_players').insert(
      players.map((p) => ({
        list_id: list.id as string,
        player_id: p.player_id,
        position: p.rank,
        overall_rank: p.rank,
        notes: p.rationale,
      })),
    )
    if (playersError) {
      // Don't leave an empty persona list behind.
      await supabase.from('lists').delete().eq('id', list.id as string)
      throw playersError
    }

    console.log(
      `  + ${persona.username}/${position}: ${players.length} players (${result.outputTokens} output tokens)`,
    )
  }
}

async function main(): Promise<void> {
  const ownerId = await ensureSystemOwner()
  const personaIds = await upsertPersonas()

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      '\nANTHROPIC_API_KEY not set — personas seeded without lists. Add the key and re-run to generate them.',
    )
    return
  }

  const { count } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
  if (!count) {
    console.log(
      '\nplayers table is empty — run "npm run sync:players" first, then re-run to generate persona lists.',
    )
    return
  }

  for (const persona of PERSONA_ROSTER) {
    const personaId = personaIds.get(persona.username)
    if (!personaId) continue
    console.log(`\nGenerating lists for ${persona.display_name}…`)
    try {
      await seedListsForPersona(ownerId, persona, personaId)
    } catch (err) {
      console.error(`  ✗ ${persona.username} failed:`, err instanceof Error ? err.message : err)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
