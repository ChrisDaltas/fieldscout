import { create } from 'zustand'

// Page-scoped header content. Pages register a title/actions (and an optional
// sub-nav row) via the <PageHeader> component; the shell's sticky header
// renders it. Falls back to a route-derived title for screens that haven't
// been reskinned yet.
interface HeaderStore {
  title: React.ReactNode | null
  actions: React.ReactNode | null
  /** Optional second header row (e.g. the league workspace sub-nav). */
  subnav: React.ReactNode | null
  setHeader: (
    title: React.ReactNode,
    actions?: React.ReactNode,
    subnav?: React.ReactNode,
  ) => void
  clearHeader: () => void
  /**
   * The league workspace's header (league layout — `LeagueShell`): an
   * identity row ABOVE the main row, the league sub-nav as the main row, and
   * the commissioner's override indicator on the right. While it is set it
   * OWNS the bar: a page's own `PageHeader` title/actions are not shown, so
   * a league page can never stack a second header under it.
   */
  league: { above: React.ReactNode; nav: React.ReactNode; actions: React.ReactNode } | null
  setLeagueHeader: (league: { above: React.ReactNode; nav: React.ReactNode; actions: React.ReactNode }) => void
  clearLeagueHeader: () => void
}

export const useHeaderStore = create<HeaderStore>()((set) => ({
  title: null,
  actions: null,
  subnav: null,
  setHeader: (title, actions, subnav) =>
    set({ title, actions: actions ?? null, subnav: subnav ?? null }),
  clearHeader: () => set({ title: null, actions: null, subnav: null }),
  league: null,
  setLeagueHeader: (league) => set({ league }),
  clearLeagueHeader: () => set({ league: null }),
}))
