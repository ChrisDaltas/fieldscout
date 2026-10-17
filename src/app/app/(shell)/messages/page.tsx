import { MessagesListRoute } from '@/components/mobile/messages/messages-route'

export const metadata = { title: 'Messages · FieldScout' }

/**
 * Messages — FieldScout Mobile (docs/design/mobile/m-messages.md). A mobile
 * screen: desktop has no Messages page, so the client switch sends a
 * desktop visit Home.
 */
export default function MessagesPage() {
  return <MessagesListRoute />
}
