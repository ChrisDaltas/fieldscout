import { NextResponse } from 'next/server'

import { requireProUser } from '@/lib/auth/require-pro'
import { isClaudeConfigured } from '@/lib/claude/client'
import { AI_LIST_GENERATION_DAILY_LIMIT } from '@/lib/claude/limits'
import { CLAUDE_GENERATION_MODEL } from '@/lib/claude/models'
import {
  buildGenerationPrompt,
  type SourceRankEntry,
} from '@/lib/claude/persona-gen'
import {
  buildPlayerPacket,
  resolveGeneratedPlayers,
} from '@/lib/claude/player-packet'
import { structuredClaudeCall } from '@/lib/claude/structured'
import {
  renderStyleDescription,
  renderWeightedStyleDescription,
  styleByKey,
} from '@/lib/claude/styles'
import { countAiCallsToday, logAiCall } from '@/lib/claude/telemetry'
import { assertNoRealAnalystNames } from '@/lib/personas/blocklist'
import {
  getPersonaContext,
  renderContextForPrompt,
} from '@/lib/personas/context'
import type { PersonaStyleProfile } from '@/lib/personas/roster'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  generateListRequestSchema,
  generatedListSchema,
  type GenerateListResponse,
  type StyleWeight,
} from '@/types/schemas/ai'

/**
 * POST /api/lists/generate — "Generate with AI" (spec-ai-list-generation.md).
 * Pro-gated, rate-limited, structured-output, server-side ID resolution.
 * Deliberately does NOT persist anything: the user saves explicitly via the
 * existing POST /api/lists + /api/lists/[id]/players flow.
 */

export async function POST(request: Request) {
  const gate = await requireProUser()
  if (!gate.ok) return gate.response
  const { user, supabase } = gate

  if (!isClaudeConfigured()) {
    return NextResponse.json(
      { error: 'AI generation is not configured on this server.', code: 'AI_NOT_CONFIGURED' },
      { status: 503 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = generateListRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { position, scoring, player_count } = parsed.data

  const used = await countAiCallsToday(user.id, 'list_generation')
  if (used >= AI_LIST_GENERATION_DAILY_LIMIT) {
    return NextResponse.json(
      {
        error: `Daily limit reached (${AI_LIST_GENERATION_DAILY_LIMIT} AI generations per day). Try again tomorrow.`,
        code: 'RATE_LIMITED',
      },
      { status: 429 },
    )
  }

  // Weighted ranking styles: dedupe by key (last entry wins).
  const weightByKey = new Map<StyleWeight['key'], StyleWeight>()
  for (const w of parsed.data.style_weights ?? []) weightByKey.set(w.key, w)
  const weights = [...weightByKey.values()]

  // Optional AI expert. Two .eq() lookups instead of .or(): the value is user
  // input and persona display names contain characters PostgREST's or-syntax
  // reserves.
  interface ResolvedPersona {
    id: string
    display_name: string
    style_profile: PersonaStyleProfile
  }
  let persona: ResolvedPersona | null = null
  if (parsed.data.persona) {
    const personaQuery = () =>
      supabase
        .from('ai_personas')
        .select('id, username, display_name, style_profile')
        .eq('is_active', true)
        .is('deleted_at', null)
    let { data: found } = await personaQuery()
      .eq('username', parsed.data.persona)
      .maybeSingle()
    if (!found) {
      const byDisplayName = await personaQuery()
        .eq('display_name', parsed.data.persona)
        .limit(1)
        .maybeSingle()
      found = byDisplayName.data
    }
    if (!found) {
      return NextResponse.json(
        { error: `Unknown AI expert: ${parsed.data.persona}` },
        { status: 400 },
      )
    }
    persona = {
      id: found.id as string,
      display_name: found.display_name as string,
      style_profile: found.style_profile as unknown as PersonaStyleProfile,
    }
  }

  // Assemble {style_description}: persona voice/stances and weighted
  // priorities are independent, composable, and both optional — neither
  // present degrades to a plain consensus board.
  const descriptionParts: string[] = []
  if (persona) descriptionParts.push(renderStyleDescription(persona.style_profile))
  if (weights.length > 0) descriptionParts.push(renderWeightedStyleDescription(weights))
  if (descriptionParts.length === 0) {
    descriptionParts.push(styleByKey('consensus').description)
  }
  const styleLabel =
    persona && weights.length > 0
      ? `${persona.display_name} Blend`
      : persona
        ? persona.display_name
        : weights.length > 0
          ? 'Custom Blend'
          : 'Consensus'

  // Personas are grounded in their living context (current sourced stances,
  // movements, themes) and mirror the analyst's latest scraped ranks when
  // available (spec-ai-content-engine.md §Use Case 1). Both tables are
  // service-role only; absent data degrades gracefully.
  let sourceRanks: SourceRankEntry[] | undefined
  if (persona) {
    const admin = createAdminClient()
    const [ranksRes, context] = await Promise.all([
      admin
        .from('persona_source_rankings')
        .select('raw_rankings')
        .eq('ai_persona_id', persona.id)
        .eq('position', position)
        .order('scraped_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      getPersonaContext(admin, persona.id),
    ])
    const raw = ranksRes.data?.raw_rankings as SourceRankEntry[] | undefined
    if (Array.isArray(raw) && raw.length > 0) sourceRanks = raw
    if (context) descriptionParts.push(renderContextForPrompt(context))
  }
  const styleDescription = descriptionParts.join('\n\n')

  try {
    const packet = await buildPlayerPacket(supabase, {
      position,
      scoring,
      playerCount: player_count,
    })

    const prompt = buildGenerationPrompt({
      position,
      scoring,
      style: styleLabel,
      styleDescription,
      playerCount: player_count,
      packetRendered: packet.rendered,
      sourceRanks,
    })

    const { data, inputTokens, outputTokens, latencyMs } =
      await structuredClaudeCall({
        model: CLAUDE_GENERATION_MODEL,
        schema: generatedListSchema,
        prompt,
      })

    // Parody firewall applies to all generated prose, persona-styled or not.
    assertNoRealAnalystNames(JSON.stringify(data), 'generated list')

    await logAiCall({
      user_id: user.id,
      feature: 'list_generation',
      model: CLAUDE_GENERATION_MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: latencyMs,
      success: true,
    })

    const resolvedAll = resolveGeneratedPlayers(data.players, packet.players)
    // Enforce "at most N players" server-side; a shortfall is reported via
    // `unresolved` so the client can surface it.
    const players = resolvedAll.players.slice(0, player_count)
    const unresolved = resolvedAll.unresolved
    if (players.length === 0) {
      return NextResponse.json(
        { error: 'Generation produced no resolvable players. Try again.' },
        { status: 500 },
      )
    }

    const response: GenerateListResponse = {
      position,
      scoring,
      style: styleLabel,
      player_count,
      players,
      style_note: data.style_note,
      unresolved,
    }
    return NextResponse.json(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logAiCall({
      user_id: user.id,
      feature: 'list_generation',
      model: CLAUDE_GENERATION_MODEL,
      success: false,
      error: message,
    })
    console.error('[generate] failed:', message)
    return NextResponse.json(
      { error: 'AI generation failed. Please try again.' },
      { status: 500 },
    )
  }
}
