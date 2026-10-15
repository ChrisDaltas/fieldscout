'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { ByLayout } from '@/components/mobile/by-layout'
import { useLayoutModeValue } from '@/hooks/use-layout-mode'

import { MobileMessagesList } from './messages-list-screen'
import { MobileThreadScreen } from './thread-screen'

/**
 * Desktop has no Messages page (before this route existed, /app/messages
 * was a 404 there). A desktop visit — e.g. after switching the layout back
 * from mobile on this screen — goes Home, as the app's other gated screens
 * do; nothing else changes (the right-side bar is left as it was). Only
 * once the layout is KNOWN to be desktop: during hydration the mode is
 * unknown and a phone must not be redirected.
 */
function DesktopMessagesRedirect() {
  const mode = useLayoutModeValue()
  const router = useRouter()
  useEffect(() => {
    if (mode === 'desktop') router.replace('/app')
  }, [mode, router])
  return null
}

/** /app/messages — the Messages list on mobile. */
export function MessagesListRoute() {
  return <ByLayout desktop={<DesktopMessagesRedirect />} mobile={<MobileMessagesList />} />
}

/** /app/messages/[threadId] — one conversation on mobile. */
export function MessagesThreadRoute({ threadId }: { threadId: string }) {
  return <ByLayout desktop={<DesktopMessagesRedirect />} mobile={<MobileThreadScreen threadId={threadId} />} />
}
