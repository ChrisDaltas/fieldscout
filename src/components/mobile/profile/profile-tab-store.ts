import { create } from 'zustand'

import { DEFAULT_ME_TAB, type MeTab } from '@/components/mobile/profile/profile-ops'

/**
 * Profile's "My stuff" segment for the session (handoff §3: `meTab` persists
 * in component state, so coming back to Profile keeps the last segment; a
 * full reload starts on Lists again).
 */
interface ProfileTabStore {
  tab: MeTab
  setTab: (tab: MeTab) => void
}

export const useProfileTabStore = create<ProfileTabStore>((set) => ({
  tab: DEFAULT_ME_TAB,
  setTab: (tab) => set({ tab }),
}))
