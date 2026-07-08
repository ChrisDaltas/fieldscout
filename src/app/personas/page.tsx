import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { PersonaCard } from '@/components/personas/persona-card'
import { Card, CardContent } from '@/components/ui/card'
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
      <div className="mx-auto max-w-4xl space-y-8">
        <header>
          <h1 className="text-2xl font-bold">The AI Experts</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Fictional, AI-generated analyst personas — each with its own
            ranking style and always-fresh boards. Parody, not affiliated with
            or endorsed by any real person.
          </p>
        </header>

        {!personas || personas.length === 0 ? (
          <Card className="border-bg-elevated-2 bg-bg-elevated">
            <CardContent className="p-6 text-center text-sm text-text-secondary">
              The experts are warming up — check back soon.
            </CardContent>
          </Card>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
