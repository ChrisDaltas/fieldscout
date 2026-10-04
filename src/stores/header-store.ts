import { create } from 'zustand'

/**
 * What a page puts in the shell's standard header (`PageHeader`). Every
 * option renders inside the ONE 58px title row — none of them changes its
 * height, padding or type (F577, D487).
 */
export interface PageHeaderContent {
  /** The page name. A string renders as the standard `text-h5` heading. */
  title: React.ReactNode
  /** Right-aligned page actions. */
  actions?: React.ReactNode
  /** Optional second header row (e.g. a sub-nav) rendered under the title row. */
  subnav?: React.ReactNode
  /** One muted line under the title (a count, a handle, a status). */
  subtitle?: React.ReactNode
  /** Inline controls right after the title (a mode switch, tabs). */
  aside?: React.ReactNode
  /**
   * Makes a string title editable in place: click it, type, Enter / Esc /
   * blur to finish. `onChange` fires per keystroke (the page owns the value).
   */
  editableTitle?: {
    onChange: (next: string) => void
    label: string
    maxLength?: number
    placeholder?: string
  }
}

// Page-scoped header content. Pages register it via the <PageHeader>
// component; the shell's sticky header renders it. Falls back to a
// route-derived title while nothing is registered.
interface HeaderStore {
  page: PageHeaderContent | null
  setHeader: (page: PageHeaderContent) => void
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
  page: null,
  setHeader: (page) => set({ page }),
  clearHeader: () => set({ page: null }),
  league: null,
  setLeagueHeader: (league) => set({ league }),
  clearLeagueHeader: () => set({ league: null }),
}))
