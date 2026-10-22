import type { Metadata } from 'next'

import { LandingPage } from '@/components/landing/landing-page'

const title = 'FieldScout — AI powered fantasy football'
const description =
  'Full leagues, live drafts, expert and consensus rankings, waiver wire reports, start or sit and advanced stats. All powered by Scout AI.'

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: 'website', siteName: 'FieldScout' },
}

/**
 * Public landing page for signed-out visitors. Signed-in users are sent to
 * the app by `src/middleware.ts` before this renders (F744): this page must
 * stay static — no cookies, headers or session reads here — so Next puts its
 * <title>, description and Open Graph tags in <head>. A per-request render
 * streams them into <body> instead. `page-metadata.test.ts` pins that.
 */
export default function GuestHomePage() {
  return <LandingPage />
}
