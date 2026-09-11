import { create } from 'zustand'

/**
 * COMMISSIONER OVERRIDE MODE — one league at a time, in memory only.
 *
 * **Ruled by Chris 2026-09-11 (PROGRESS §3 STANDING RULE (h)):** *"what I
 * would prefer is the commissioner going into 'override mode' which lets them
 * act like any GM in the league, and then when they're done they exit override
 * mode. when override mode is active there is some visual indications that
 * it's on."*
 *
 * **Why a store and not `useState` in the team page.** The sitting the ruling
 * came out of was four teams in a row (5, 6, 7, 8) — each one its own route,
 * each mount its own component state. A per-page flag would make him re-enter
 * the mode on every navigation, which is the "per transaction" shape he
 * rejected. Keyed by league, so entering it for one league leaves every other
 * league alone.
 *
 * **In memory only — never persisted.** A mode that survives a reload would be
 * on without anyone turning it on, which is the opposite of a deliberate
 * switch. Closing the tab ends it; so does a refresh.
 *
 * This holds NO authority. The server decides who may call
 * `commish_edit_lineup`; this only says which verb the editor offers, and the
 * surface still gates the control on the viewer's commissioner role.
 */
interface CommishOverrideStore {
  /** The league override mode is ON for, or null. */
  leagueId: string | null
  enter: (leagueId: string) => void
  exit: () => void
}

export const useCommishOverrideStore = create<CommishOverrideStore>((set) => ({
  leagueId: null,
  enter: (leagueId: string) => set({ leagueId }),
  exit: () => set({ leagueId: null }),
}))

/** Is override mode on for THIS league? */
export function useOverrideMode(leagueId: string): boolean {
  return useCommishOverrideStore((s) => s.leagueId === leagueId)
}
