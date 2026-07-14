import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { PersonaCard } from '@/components/personas/persona-card'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Public index of the AI expert personas — the "meet the experts" front door
 * linked from the home shelf. Server-rendered for SEO like /personas/[username].
 */

export const metadata: Metadata = {
  title: 'AI Experts · FieldScout',
  description:
    'Meet the FieldScout AI experts — fictional, AI-generated analyst personas with always-fresh fantasy football rankings.',
}

export default async function PersonasIndexPage() {
  const supabase = await createServerClient()
  const { data: personas } = await supabase
    .from('ai_personas')
    .select('username, display_name, bio, avatar_url')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('display_name')

  return (
    <GuestShell>
      <div className="mx-auto max-w-4xl space-y-[19px]">
        <header>
          <h1 className="text-h3">The AI experts</h1>
          <p className="mt-2 max-w-2xl text-[13px] font-medium text-n-3">
            Fictional, AI-generated analyst personas — each with its own
            ranking style and always-fresh boards. Parody, not affiliated with
            or endorsed by any real person.
          </p>
        </header>

        {!personas || personas.length === 0 ? (
          <div className="rounded-sm border border-ink bg-white px-6 py-14 text-center">
            <h2 className="text-h5">The experts are warming up</h2>
            <p className="mx-auto mt-2 max-w-md text-[13px] font-medium text-n-3">
              New AI analyst boards land here soon — check back shortly.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {personas.map((persona) => (
              <li key={persona.username}>
                <PersonaCard
                  username={persona.username}
                  displayName={persona.display_name}
                  bio={persona.bio}
                  avatarUrl={persona.avatar_url}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </GuestShell>
  )
}
