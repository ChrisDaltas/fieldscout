/**
 * Thin FireCrawl fetch wrapper (no SDK dependency). Used by persona source
 * scraping and (later) content-engine ingestion. Free, non-paywalled sources
 * only — the caller is responsible for the allowlist. Server-only.
 */

const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1/scrape'

export interface FirecrawlScrapeResult {
  markdown: string
  metadata: Record<string, unknown>
}

export function isFirecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY)
}

export async function scrapeUrl(url: string): Promise<FirecrawlScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) {
    throw new Error(
      'Missing FIRECRAWL_API_KEY. Add it to .env.local (see .env.example) to enable scraping.',
    )
  }

  const res = await fetch(FIRECRAWL_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, formats: ['markdown'] }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`FireCrawl scrape failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const payload = (await res.json()) as {
    success?: boolean
    data?: { markdown?: string; metadata?: Record<string, unknown> }
    error?: string
  }

  if (!payload.success || !payload.data?.markdown) {
    throw new Error(`FireCrawl scrape returned no content: ${payload.error ?? 'unknown error'}`)
  }

  return {
    markdown: payload.data.markdown,
    metadata: payload.data.metadata ?? {},
  }
}
