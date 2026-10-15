import { create } from 'zustand'

/**
 * Mobile light/dark preference (Chris, 2026-10-15 — dark mode is mobile-only).
 * Stored under the handoff's own key, `localStorage["fieldscout-theme"]`
 * ("dark" | "light"), so the head script can read it before first paint.
 * Applied to `<html data-theme>` by `useLayoutMode`, and only in the mobile
 * layout.
 */
export const THEME_STORAGE_KEY = 'fieldscout-theme'

function readStored(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark'
  } catch {
    return false
  }
}

interface ThemeStore {
  dark: boolean
  setDark: (dark: boolean) => void
  toggle: () => void
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  dark: readStored(),
  setDark: (dark) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light')
    } catch {
      // Blocked storage — the choice just isn't remembered.
    }
    set({ dark })
  },
  toggle: () => get().setDark(!get().dark),
}))
