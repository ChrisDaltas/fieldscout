import { create } from 'zustand'
import type { ClientProfile } from '@/types/database'

interface AuthStore {
  profile: ClientProfile | null
  setProfile: (profile: ClientProfile | null) => void
  updateProfile: (updates: Partial<ClientProfile>) => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  profile: null,
  setProfile: (profile) => set({ profile }),
  updateProfile: (updates) =>
    set((state) => ({
      profile: state.profile ? { ...state.profile, ...updates } : null,
    })),
}))
