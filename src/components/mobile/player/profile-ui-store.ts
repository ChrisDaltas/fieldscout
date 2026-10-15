import { create } from 'zustand'

/**
 * The mobile player profile's session memory (m-pprofile §4 "Arrival"):
 * opening a profile resets its tab and season, but the collapsed Summary
 * sections and the Transactions league filter carry over from one profile
 * to the next for the session. Not persisted.
 *
 * It also carries the draft seat a profile was opened from (the draft
 * room's card context — the modal store's target has no place for it), so
 * the profile keeps the draft card's one action, Queue.
 */
export type ProfileSection = 'key' | 'games'

/** The draft room's card context, for the player it was opened on. */
export interface ProfileDraftContext {
  playerId: string
  draftId: string
  teamId: string
  /** Null for a mock draft. */
  leagueId: string | null
}

interface ProfileUiStore {
  collapsed: Partial<Record<ProfileSection, boolean>>
  toggle: (section: ProfileSection) => void
  /** 'all' or a league id. */
  txFilter: string
  setTxFilter: (filter: string) => void
  draft: ProfileDraftContext | null
  setDraft: (draft: ProfileDraftContext | null) => void
}

export const useProfileUiStore = create<ProfileUiStore>()((set) => ({
  collapsed: {},
  toggle: (section) => set((s) => ({ collapsed: { ...s.collapsed, [section]: !s.collapsed[section] } })),
  txFilter: 'all',
  setTxFilter: (txFilter) => set({ txFilter }),
  draft: null,
  setDraft: (draft) => set({ draft }),
}))
