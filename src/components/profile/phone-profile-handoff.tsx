'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useAuth } from '@/hooks/use-auth'
import { detectMode } from '@/hooks/use-layout-mode'

/**
 * On a public person page (`/u/[username]`, its Followers / Following): a
 * SIGNED-IN visitor on a phone is handed to the same thing as a phone screen
 * inside the app (`to` — `phoneProfileHref` / `phoneFollowsHref`), replacing
 * this page so Back doesn't return to it. Links inside the app already go
 * there; this covers the ways in from outside it (a shared link, a public
 * list's owner).
 *
 * Everyone else stays: search engines and signed-out visitors (the page is
 * server-rendered for them, and the app would ask them to sign in), and
 * desktop. Renders nothing.
 */
export function PhoneProfileHandoff({ to }: { to: string }) {
  const { user } = useAuth()
  const router = useRouter()
  const signedIn = Boolean(user)
  useEffect(() => {
    if (signedIn && detectMode() === 'mobile') router.replace(to)
  }, [signedIn, router, to])
  return null
}
