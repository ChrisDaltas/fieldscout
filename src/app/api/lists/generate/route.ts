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
import { findAnalyticalStyle, renderStyleDescription } from '@/lib/claude/styles'
import { countAiCallsToday, logAiCall } from '@/lib/claude/telemetry'
import { assertNoRealAnalystNames } from '@/lib/personas/blocklist'
import type { PersonaStyleProfile } from '@/lib/personas/roster'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  generateListRequestSchema,
  generatedListSchema,
  type GenerateListResponse,
} from '@/types/schemas/ai'

/**
 * POST /api/lists/generate — "Generate with AI" (spec-ai-list-generation.md).
 * Pro-gated, rate-limited, structured-output, server-side ID resolution.
 * Deliberately does NOT persist anything: the user saves explicitly via the
 * existing POST /api/lists + /api/lists/[id]/players flow.
 */

interface ResolvedStyle {
  label: string
  description: string
  /** Set when the style is a persona — enables source-rank mirroring. */
  personaId?: string
}

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
  const { position, scoring, style, player_count } = parsed.data

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

  // Resolve the ranking style: analytical bias config, or an active persona.
  let resolved: ResolvedStyle | null = null
  const analytical = findAnalyticalStyle(style)
  if (analytical) {
    resolved = { label: analytical.label, description: analytical.description }
  } else {
    // Two .eq() lookups instead of .or(): style is user input and persona
    // display names contain characters PostgREST's or-syntax reserves.
    const personaQuery = () =>
      supabase
        .from('ai_personas')
        .select('id, username, display_name, style_profile')
        .eq('is_active', true)
        .is('deleted_at', null)
    let { data: persona } = await personaQuery()
      .eq('username', style)
      .maybeSingle()
    if (!persona) {
      const byDisplayName = await personaQuery()
        .eq('display_name', style)
        .limit(1)
        .maybeSingle()
      persona = byDisplayName.data
    }
    if (persona) {
      resolved = {
        label: persona.display_name as string,
        description: renderStyleDescription(
          persona.style_profile as unknown as PersonaStyleProfile,
        ),
        personaId: persona.id as string,
      }
    }
  }
  if (!resolved) {
    return NextResponse.json(
      { error: `Unknown ranking style: ${style}` },
      { status: 400 },
    )
  }

  // Persona styles mirror the analyst's latest scraped ranks when available;
  // absent source data degrades gracefully to the style profile alone.
  let sourceRanks: SourceRankEntry[] | undefined
  if (resolved.personaId) {
    const admin = createAdminClient()
    const { data: ranks } = await admin
      .from('persona_source_rankings')
      .select('raw_rankings')
      .eq('ai_persona_id', resolved.personaId)
      .eq('position', position)
      .order('scraped_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const raw = ranks?.raw_rankings as SourceRankEntry[] | undefined
    if (Array.isArray(raw) && raw.length > 0) sourceRanks = raw
  }

  try {
    const packet = await buildPlayerPacket(supabase, {
      position,
      scoring,
      playerCount: player_count,
    })

    const prompt = buildGenerationPrompt({
      position,
      scoring,
      style: resolved.label,
      styleDescription: resolved.description,
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
      style: resolved.label,
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
