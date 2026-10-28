import { create } from 'zustand'

import type { PlayerModalTarget } from '@/stores/player-modal-store'

/**
 * The mobile player profile's session memory (m-pprofile §4 "Arrival"):
 * opening a profile resets its tab and season, but the collapsed Summary
 * sections and the Transactions league filter carry over from one profile
 * to the next for the session. Not persisted.
 *
 * It also carries the draft seat a profile was opened from (the draft
 * room's card context — the modal store's target has no place for it), so
 * the profile keeps the draft card's one action, Queue.
 *
 * And the profile's own small stack (Chris, #45 + #27, 2026-10-15): a name
 * tapped on the Team tab's depth chart opens that player's profile in place,
 * and Back returns to the profile it was opened from, on the tab it was
 * left on. Mobile only — the desktop modal never reads this store.
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

/** One step down the profile stack: the profile left (as it was opened,
 *  its name and the tab it was on) and the player opened from it. */
export interface ProfileTrailStep {
  from: PlayerModalTarget
  fromName: string
  fromTab: string
  to: string
}

/**
 * A profile left for its NFL team page (`profile-team-door.ts`): the profile
 * as it was — the player as opened, the tab it was on, its stack and draft
 * seat — so coming Back to the page under it opens it again just so. `id`
 * matches the mark left on that page's history entry.
 */
export interface ProfileResume {
  id: string
  target: PlayerModalTarget
  tab: string
  trail: ProfileTrailStep[]
  draft: ProfileDraftContext | null
}

interface ProfileUiStore {
  collapsed: Partial<Record<ProfileSection, boolean>>
  toggle: (section: ProfileSection) => void
  /** 'all' or a league id. */
  txFilter: string
  setTxFilter: (filter: string) => void
  draft: ProfileDraftContext | null
  setDraft: (draft: ProfileDraftContext | null) => void
  /** The profiles under the one showing, oldest first. */
  trail: ProfileTrailStep[]
  pushTrail: (step: ProfileTrailStep) => void
  /** Removes and returns the newest step (null when there is none). */
  popTrail: () => ProfileTrailStep | null
  clearTrail: () => void
  /** The tab a profile reopens on when Back returns to it. */
  restore: { playerId: string; tab: string } | null
  setRestore: (restore: { playerId: string; tab: string } | null) => void
  /** The profile left for its team page, until Back returns to it. Closing
   *  the profile (which leaving does) keeps it. */
  resume: ProfileResume | null
  setResume: (resume: ProfileResume | null) => void
}

export const useProfileUiStore = create<ProfileUiStore>()((set, get) => ({
  collapsed: {},
  toggle: (section) => set((s) => ({ collapsed: { ...s.collapsed, [section]: !s.collapsed[section] } })),
  txFilter: 'all',
  setTxFilter: (txFilter) => set({ txFilter }),
  draft: null,
  setDraft: (draft) => set({ draft }),
  trail: [],
  pushTrail: (step) => set((s) => ({ trail: [...s.trail, step] })),
  popTrail: () => {
    const trail = get().trail
    const step = trail[trail.length - 1] ?? null
    if (step) set({ trail: trail.slice(0, -1) })
    return step
  },
  clearTrail: () => set((s) => (s.trail.length === 0 && s.restore === null ? s : { trail: [], restore: null })),
  restore: null,
  setRestore: (restore) => set({ restore }),
  resume: null,
  setResume: (resume) => set({ resume }),
}))

/** Whether Back on the profile showing returns to another profile: the
 *  newest step opened exactly this player. */
export function trailBackTo(trail: readonly ProfileTrailStep[], playerId: string | null): ProfileTrailStep | null {
  const step = trail[trail.length - 1]
  return step && playerId !== null && step.to === playerId ? step : null
}
