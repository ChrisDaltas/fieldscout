import Anthropic from '@anthropic-ai/sdk'

/**
 * Server-only Claude client singleton. All Claude calls run in route handlers,
 * scripts, or Edge Functions — NEVER import this from a client component.
 * Reads ANTHROPIC_API_KEY; throws a clear error when it's missing so AI routes
 * can surface "not configured" instead of an opaque SDK failure.
 */

let cached: Anthropic | null = null

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export function getClaudeClient(): Anthropic {
  if (typeof window !== 'undefined') {
    throw new Error('getClaudeClient() must never be called in the browser.')
  }
  if (cached) return cached
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'Missing ANTHROPIC_API_KEY. Add it to .env.local (see .env.example) to enable AI features.',
    )
  }
  cached = new Anthropic({ apiKey })
  return cached
}
