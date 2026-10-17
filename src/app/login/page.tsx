import type { Metadata } from 'next'

import { LandingPage } from '@/components/landing/landing-page'

export const metadata: Metadata = { title: 'Sign in — FieldScout' }

/** The landing page; the Sign in modal over it renders in app/@modal (see AuthModal). */
export default function Page() {
  return <LandingPage />
}
