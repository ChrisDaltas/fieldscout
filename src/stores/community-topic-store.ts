import { create } from 'zustand'

/**
 * Desktop Community's topic — the feed's one topic filter (`ExploreFeed`'s
 * topic pills). It lives here, not in the feed, so the right column's
 * Trending tags card sets the same filter in the app instead of leaving for
 * the public /tag page (plan C4: what Community shows follows one rule).
 * `null` is All. The feed clears it when Community closes, so coming back
 * starts on All, as before.
 */
interface CommunityTopicStore {
  tagId: string | null
  setTagId: (tagId: string | null) => void
}

export const useCommunityTopicStore = create<CommunityTopicStore>((set) => ({
  tagId: null,
  setTagId: (tagId) => set({ tagId }),
}))
