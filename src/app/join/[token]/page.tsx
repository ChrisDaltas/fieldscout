import type { Metadata } from 'next'

import { ClaimInviteCard } from '@/components/leagues/claim-invite-card'
import { parseJoinPreview } from '@/components/leagues/claim-invite-card-ops'
import { Wordmark } from '@/components/shared/wordmark'
import { featureFlags } from '@/lib/feature-flags'
import { createServerClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Join a league · FieldScout',
  description: 'Claim your invite and get seated in your fantasy football league.',
}

/**
 * Pre-auth invite claim page — M1 task L.A2.6 (spec §16.1 route
 * `src/app/join/[token]`; §7.2, §12.23).
 *
 * This route lives OUTSIDE the `(app)/leagues` layout gate — invitees hit it
 * cold, before the app shell — so the leagues feature flag is checked HERE
 * explicitly (the /app/leagues layout's gate does not cover it).
 *
 * A Server Component for the preview fetch (SEO / first paint): it resolves
 * the param via `get_join_preview` (the §4.1 anon EXECUTE carve-out — F2
 * returns ONLY league name + team label + inviter, never the invited email),
 * reads the visitor's auth state, and hands both to the interactive client
 * card. The §16.1 resolution order (seat token → invite_code → invite_slug)
 * is the RPC's own contract — surfaced here, not reimplemented.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  if (!featureFlags.leagues) {
    return (
      <JoinShell>
        <div className="rounded-sm border border-ink bg-white px-card-pad py-10 text-center text-ink shadow-hard-4">
          <p className="text-h5">Leagues aren&apos;t available yet</p>
          <p className="mt-1.5 text-[12px] font-medium text-n-3">
            League invites open up soon — check back shortly.
          </p>
        </div>
      </JoinShell>
    )
  }

  const supabase = await createServerClient()
  const [
    {
      data: { user },
    },
    { data: previewData },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc('get_join_preview', { p_value: token }),
  ])

  const preview = parseJoinPreview(previewData)

  return (
    <JoinShell>
      <ClaimInviteCard token={token} preview={preview} isSignedIn={Boolean(user)} />
    </JoinShell>
  )
}

/** Centered pre-auth shell — mirrors the (auth) layout's wordmark + card
 *  language for a visitor who arrives before the app shell exists. */
function JoinShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-page px-4 py-10">
      <div className="mb-7 text-center">
        <h1 className="text-4xl text-ink">
          <Wordmark />
        </h1>
        <p className="mt-1.5 text-[13px] font-medium text-n-3">Fantasy football, ranked.</p>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
