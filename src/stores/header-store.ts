import { create } from 'zustand'

// Page-scoped header content. Pages register a title/actions via the
// <PageHeader> component; the shell's sticky header renders it. Falls back
// to a route-derived title for screens that haven't been reskinned yet.
interface HeaderStore {
  title: React.ReactNode | null
  actions: React.ReactNode | null
  setHeader: (title: React.ReactNode, actions?: React.ReactNode) => void
  clearHeader: () => void
}

export const useHeaderStore = create<HeaderStore>()((set) => ({
  title: null,
  actions: null,
  setHeader: (title, actions) => set({ title, actions: actions ?? null }),
  clearHeader: () => set({ title: null, actions: null }),
}))
