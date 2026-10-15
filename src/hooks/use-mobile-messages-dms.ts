'use client'

import { useMemo } from 'react'

import type { RailDmThread } from '@/components/layout/rail/messages-panel'
import { MY_COLOR, initialOf, keyColor, previewText, type MChatMessage } from '@/components/mobile/messages/messages-ops'
import { useMessagesStore } from '@/components/mobile/messages/messages-store'
import { featureFlags } from '@/lib/feature-flags'

/** A direct-message conversation as the mobile Messages screens render it. */
export interface MDmConversation {
  id: string
  name: string
  initial: string
  avatarUrl: string | null
  colorClass: string
  teamName: string
  leagueName: string
  unread: boolean
  messages: MChatMessage[]
  preview: string | null
  time: string | null
}

/**
 * League DMs have no backend (no conversation, message or read-marker
 * tables): the desktop rail panel renders its `threads` prop, which is empty
 * until a messages API feeds it (`rail/messages-panel.tsx`,
 * `dmUnreadCount()`). This is that same feed for mobile — empty today — and
 * the same release gate (`featureFlags.messages`). When the API lands, it
 * plugs in here and both surfaces fill together.
 *
 * Trade offers are NOT read from here: the Messages › Trades tab shows the
 * leagues' real offers (`leagueTradeOffers`). A thread's `trade` field is
 * the rail's mock shape with no server behind it.
 */
const DM_THREADS: readonly RailDmThread[] = []

/** Pure: the feed + this session's local state → conversations. */
export function dmViewModel(
  threads: readonly RailDmThread[],
  local: {
    read: Record<string, true>
    sent: Record<string, string[]>
  },
): { conversations: MDmConversation[] } {
  const conversations = threads.map((t): MDmConversation => {
    const color = keyColor(t.id)
    const fromFeed = t.messages.map(
      (m): MChatMessage => ({
        id: m.id,
        fromMe: m.fromMe,
        senderKey: m.fromMe ? 'me' : t.id,
        senderName: m.fromMe ? 'You' : t.gmName,
        senderUsername: null,
        senderAvatarUrl: m.fromMe ? null : t.gmAvatarUrl,
        senderColorClass: m.fromMe ? MY_COLOR : color,
        text: m.text,
        at: null,
      }),
    )
    const sent = local.sent[t.id] ?? []
    const mine = sent.map(
      (text, i): MChatMessage => ({
        id: `${t.id}-sent-${i}`,
        fromMe: true,
        senderKey: 'me',
        senderName: 'You',
        senderUsername: null,
        senderAvatarUrl: null,
        senderColorClass: MY_COLOR,
        text,
        at: null,
      }),
    )
    const messages = [...fromFeed, ...mine]
    const last = messages[messages.length - 1]
    return {
      id: t.id,
      name: t.gmName,
      initial: initialOf(t.gmName),
      avatarUrl: t.gmAvatarUrl,
      colorClass: color,
      teamName: t.teamName,
      leagueName: t.leagueName,
      unread: t.unread > 0 && !local.read[t.id],
      messages,
      preview: last ? previewText(last, false) : null,
      // A message sent this session makes the time "now" (§5).
      time: sent.length > 0 ? 'now' : t.lastActive || null,
    }
  })

  return { conversations }
}

export function useMobileMessagesDms(): {
  enabled: boolean
  conversations: MDmConversation[]
} {
  const read = useMessagesStore((s) => s.read)
  const sent = useMessagesStore((s) => s.sent)
  const enabled = featureFlags.messages
  const model = useMemo(() => dmViewModel(enabled ? DM_THREADS : [], { read, sent }), [enabled, read, sent])
  return { enabled, ...model }
}
