import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import type { GenerateListRequest, GenerateListResponse } from '@/types/schemas/ai'

/**
 * The in-flight "AI is building this list" job. Created by the generate modal
 * right before it navigates to the List Detail page; consumed there by
 * useAiListBuild, which runs the generate → add players → order sequence and
 * reports progress back here so the page can narrate it.
 *
 * Persisted to sessionStorage (per-tab) because the modal→detail handoff must
 * survive a full-document navigation — Next falls back to one when an RSC
 * prefetch fails — and a reload mid-build should resume the show, not
 * abandon a half-built list.
 */

export type AiBuildPhase =
  | 'pending'
  | 'generating'
  | 'adding'
  | 'ordering'
  | 'error'

export interface AiBuildJob {
  listId: string
  request: GenerateListRequest
  phase: AiBuildPhase
  /** The AI's proposal — kept so a retry resumes without re-generating
   *  (and without burning another daily-limit call). */
  result: GenerateListResponse | null
  /** player_ids confirmed on the list; a retry skips these. */
  addedIds: string[]
  error: string | null
  /** The failure is not retryable right now (today's AI allowance is spent),
   *  so the banner offers dismiss instead of retry. */
  blocked: boolean
}

interface AiBuildStore {
  job: AiBuildJob | null
  /** Queue a build for a just-created list. Replaces any previous job, which
   *  also cancels its loop (the loop checks it still owns `job`). */
  start: (listId: string, request: GenerateListRequest) => void
  /** pending → generating exactly once, so React StrictMode's double effect
   *  can't launch the build twice. */
  claim: (listId: string) => boolean
  setPhase: (listId: string, phase: AiBuildPhase) => void
  setResult: (listId: string, result: GenerateListResponse) => void
  markAdded: (listId: string, playerId: string) => void
  fail: (listId: string, error: string, opts?: { blocked?: boolean }) => void
  /** error → pending, so the orchestrator picks the job back up. */
  retry: () => void
  clear: () => void
}

/** Apply `update` only if the job still belongs to `listId` — writes from a
 *  superseded build loop must not touch a newer job. */
const ifCurrent =
  (update: (job: AiBuildJob) => Partial<AiBuildJob>) =>
  (listId: string) =>
  (state: { job: AiBuildJob | null }) =>
    state.job?.listId === listId ? { job: { ...state.job, ...update(state.job) } } : state

export const useAiBuildStore = create<AiBuildStore>()(
  persist(
    (set, get) => ({
      job: null,
      start: (listId, request) =>
        set({
          job: {
            listId,
            request,
            phase: 'pending',
            result: null,
            addedIds: [],
            error: null,
            blocked: false,
          },
        }),
      claim: (listId) => {
        const job = get().job
        if (!job || job.listId !== listId || job.phase !== 'pending') return false
        set({ job: { ...job, phase: 'generating', error: null } })
        return true
      },
      setPhase: (listId, phase) => set(ifCurrent(() => ({ phase }))(listId)),
      setResult: (listId, result) => set(ifCurrent(() => ({ result }))(listId)),
      markAdded: (listId, playerId) =>
        set(
          ifCurrent((job) => ({
            addedIds: job.addedIds.includes(playerId)
              ? job.addedIds
              : [...job.addedIds, playerId],
          }))(listId),
        ),
      fail: (listId, error, opts) =>
        set(
          ifCurrent(() => ({
            phase: 'error' as const,
            error,
            blocked: opts?.blocked ?? false,
          }))(listId),
        ),
      retry: () =>
        set((state) =>
          state.job?.phase === 'error'
            ? { job: { ...state.job, phase: 'pending', error: null } }
            : state,
        ),
      clear: () => set({ job: null }),
    }),
    {
      name: 'fieldscout.ai-build',
      storage: createJSONStorage(() => sessionStorage),
      // A rehydrated job has no loop running behind it — requeue non-error
      // phases so useAiListBuild claims the job again and resumes from
      // `result`/`addedIds`. Safe to mutate directly: sessionStorage hydration
      // runs during store creation, before anything subscribes.
      onRehydrateStorage: () => (state) => {
        if (state?.job && state.job.phase !== 'error') {
          state.job = { ...state.job, phase: 'pending' }
        }
      },
    },
  ),
)
