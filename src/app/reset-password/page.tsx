import type { Metadata } from 'next'

import { LandingPage } from '@/components/landing/landing-page'

export const metadata: Metadata = { title: 'Set new password — FieldScout' }

/** The landing page; the Set new password modal over it renders in app/@modal (see AuthModal). */
export default function Page() {
  return <LandingPage />
}
