import type { Metadata } from 'next'

import { LandingPage } from '@/components/landing/landing-page'
import { SignInModal } from '@/components/landing/sign-in-modal'

export const metadata: Metadata = { title: 'Sign in — FieldScout' }

/**
 * Direct /login (bookmark, protected-route redirect): the landing page with
 * the sign-in modal open over it. A "Sign in" click on `/` is intercepted by
 * app/@modal/(.)login instead, so the homepage stays mounted underneath.
 * Signed-in users never get here — middleware bounces them to /app.
 */
export default function LoginPage() {
  return (
    <>
      <LandingPage />
      <SignInModal />
    </>
  )
}
