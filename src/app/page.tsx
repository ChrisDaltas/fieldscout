import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { LandingPage } from '@/components/landing/landing-page'
import { createServerClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'FieldScout — AI powered fantasy football',
  description:
    'Full leagues, live drafts, expert and consensus rankings, waiver wire reports, start or sit and advanced stats. All powered by Scout AI.',
}

/** Public landing page for signed-out visitors; signed-in users go to the app. */
export default async function GuestHomePage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/app')
  }

  return <LandingPage />
}
