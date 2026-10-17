import { MessagesThreadRoute } from '@/components/mobile/messages/messages-route'

export const metadata = { title: 'Messages · FieldScout' }

interface ThreadRouteProps {
  params: Promise<{ threadId: string }>
}

/**
 * One conversation — FieldScout Mobile (m-messages §2.2). `league-<id>` is
 * that league's message board; any other id is a direct message.
 */
export default async function MessagesThreadPage({ params }: ThreadRouteProps) {
  const { threadId } = await params
  return <MessagesThreadRoute threadId={safeDecode(threadId)} />
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
