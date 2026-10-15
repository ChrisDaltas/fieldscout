import { create } from 'zustand'

export type MessagesFilter = 'all' | 'trades'

/**
 * Messages UI state for the session (in memory, never persisted). The
 * prototype keeps the All/Trades choice and the search across visits
 * (`dmFilter` / `dmQuery`, §3), so they live here rather than in the screen.
 *
 * The direct-message parts — read flags and sent messages — stand in for
 * the DM backend that doesn't exist yet, exactly as the desktop rail panel
 * keeps its composer local (`rail/messages-panel.tsx`). They never reach
 * the server. (Trade offers are the leagues' real ones, answered through
 * the trade verbs — nothing about them is kept here.)
 */
interface MessagesStore {
  filter: MessagesFilter
  query: string
  /** DM threads opened this session (their unread dot clears). */
  read: Record<string, true>
  /** Messages sent this session, per DM thread (local only, as the rail). */
  sent: Record<string, string[]>
  /** The thread opened from the list — its Back returns there by history. */
  openedFromList: string | null

  setFilter: (filter: MessagesFilter) => void
  setQuery: (query: string) => void
  markRead: (threadId: string) => void
  addSent: (threadId: string, text: string) => void
  setOpenedFromList: (threadId: string | null) => void
}

export const useMessagesStore = create<MessagesStore>()((set) => ({
  filter: 'all',
  query: '',
  read: {},
  sent: {},
  openedFromList: null,

  setFilter: (filter) => set({ filter }),
  setQuery: (query) => set({ query }),
  markRead: (threadId) => set((s) => (s.read[threadId] ? s : { read: { ...s.read, [threadId]: true } })),
  addSent: (threadId, text) => set((s) => ({ sent: { ...s.sent, [threadId]: [...(s.sent[threadId] ?? []), text] } })),
  setOpenedFromList: (threadId) => set({ openedFromList: threadId }),
}))
