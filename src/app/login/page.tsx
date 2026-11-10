import type { Metadata } from 'next'

import { LandingPage } from '@/components/landing/landing-page'

// The landing page shows the current NFL week; re-render it hourly (still a
// static page — no per-request work).
export const revalidate = 3600

export const metadata: Metadata = { title: 'Sign in — FieldScout' }

/** The landing page; the Sign in modal over it renders in app/@modal (see AuthModal). */
export default function Page() {
  return <LandingPage />
}
