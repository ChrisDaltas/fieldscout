import { create } from 'zustand'

/**
 * Mobile shell UI state (FieldScout Mobile handoff). `lastLeagueId` keeps the
 * league tab bar on screens reached from inside a league (Notifications,
 * Messages, Live plays, Transactions — handoff navigation §(c)); it clears
 * when the user returns to an account tab. `menuOpen` / `switchOpen` are the
 * league Menu and Switch league sheets.
 */
interface MobileNavStore {
  lastLeagueId: string | null
  setLastLeagueId: (id: string | null) => void
  menuOpen: boolean
  setMenuOpen: (open: boolean) => void
  switchOpen: boolean
  setSwitchOpen: (open: boolean) => void
}

export const useMobileNavStore = create<MobileNavStore>((set) => ({
  lastLeagueId: null,
  setLastLeagueId: (lastLeagueId) => set({ lastLeagueId }),
  menuOpen: false,
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  switchOpen: false,
  setSwitchOpen: (switchOpen) => set({ switchOpen }),
}))
