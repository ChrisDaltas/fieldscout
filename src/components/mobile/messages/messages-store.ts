import { create } from 'zustand'

/**
 * Messages UI state for the session (in memory, never persisted). The
 * prototype keeps the search across visits (`dmQuery`, §3), so it lives here
 * rather than in the screen. (Messages is conversations only — Chris, ruling
 * #22, 2026-10-15 — so the prototype's All / Trades choice, `dmFilter`, is
 * gone with the Trades tab.)
 *
 * The direct-message parts — read flags and sent messages — stand in for
 * the DM backend that doesn't exist yet, exactly as the desktop rail panel
 * keeps its composer local (`rail/messages-panel.tsx`). They never reach
 * the server.
 *
 * (Which screen a thread was opened from is not kept: its Back goes back
 * through history to wherever that was — Chris, #27, 2026-10-15.)
 */
interface MessagesStore {
  query: string
  /** DM threads opened this session (their unread dot clears). */
  read: Record<string, true>
  /** Messages sent this session, per DM thread (local only, as the rail). */
  sent: Record<string, string[]>

  setQuery: (query: string) => void
  markRead: (threadId: string) => void
  addSent: (threadId: string, text: string) => void
}

export const useMessagesStore = create<MessagesStore>()((set) => ({
  query: '',
  read: {},
  sent: {},

  setQuery: (query) => set({ query }),
  markRead: (threadId) => set((s) => (s.read[threadId] ? s : { read: { ...s.read, [threadId]: true } })),
  addSent: (threadId, text) => set((s) => ({ sent: { ...s.sent, [threadId]: [...(s.sent[threadId] ?? []), text] } })),
}))
