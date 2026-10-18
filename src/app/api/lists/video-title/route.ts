/**
 * GET /api/lists/video-title?id=<YouTube video id> — a pasted video's real
 * title, BEFORE it is attached (gap list §3 #4).
 *
 * The phone's New list holds its videos as a draft until the list exists, and
 * Edit details holds new ones until Done; this lets each draft row show the
 * video's real title straight away instead of nothing. It is the same lookup
 * the attach route makes (`lib/lists/youtube-title.ts`: YouTube's official
 * oEmbed endpoint, server-side, 3s cap — Chris, 2026-10-15, gap list #11), so
 * the title shown is the title stored.
 *
 *   200 → { id, title, reason }   title: the real one, or null with the reason
 *                                  ("the real title or nothing" — never a
 *                                  placeholder; the row then shows no title)
 *   400 → not an 11-character YouTube id
 *   401 → signed out (this is not an open proxy to YouTube)
 *
 * Only the id comes in, and only the canonical watch URL goes out — never the
 * user's raw link.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { lookUpYouTubeTitle } from '@/lib/lists/youtube-title'
import { createServerClient } from '@/lib/supabase/server'
import { youTubeWatchUrl } from '@/utils/youtube'

const querySchema = z.object({ id: z.string().regex(/^[\w-]{11}$/) })

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = querySchema.safeParse({ id: new URL(request.url).searchParams.get('id') })
  if (!parsed.success) {
    return NextResponse.json({ error: 'That is not a YouTube video id.' }, { status: 400 })
  }

  const result = await lookUpYouTubeTitle(youTubeWatchUrl(parsed.data.id))
  if (result.title === null) {
    console.warn(
      `[video-title] YouTube title lookup failed (${result.reason}${result.detail ? `: ${result.detail}` : ''})`,
    )
  }
  return NextResponse.json({ id: parsed.data.id, title: result.title, reason: result.reason })
}
