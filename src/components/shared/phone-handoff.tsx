'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useAuth } from '@/hooks/use-auth'
import { detectMode } from '@/hooks/use-layout-mode'

/**
 * On a public page that has a phone screen inside the app: a SIGNED-IN
 * visitor on a phone is handed to that phone screen (`to`), replacing this
 * page so Back doesn't return to it. Links inside the app already go there;
 * this covers the ways in from outside it (a shared link, a link on another
 * public page).
 *
 *  - A person (`/u/[username]`, its Followers / Following) → their phone
 *    profile (`phoneProfileHref` / `phoneFollowsHref`, audit profile-1).
 *  - A shared list (`/u/[username]/lists/[listSlug]`) → its phone screen
 *    (audit lists-2): your own on the List view with Edit (`listHref`);
 *    someone else's where every phone link to it goes (`postHref`) —
 *    Community's list page while Community is on, else the List view.
 *
 * Everyone else stays: search engines and signed-out visitors (the page is
 * server-rendered for them, and the app would ask them to sign in), and
 * desktop. Renders nothing.
 */
export function PhoneHandoff({ to }: { to: string }) {
  const { user } = useAuth()
  const router = useRouter()
  const signedIn = Boolean(user)
  useEffect(() => {
    if (signedIn && detectMode() === 'mobile') router.replace(to)
  }, [signedIn, router, to])
  return null
}
