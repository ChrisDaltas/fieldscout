'use client'

import { useMutation } from '@tanstack/react-query'

import { reportContent, type ReportInput, type ReportOutcome } from '@/lib/community/report-content'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Report a list, a comment or a start/sit question as the signed-in person
 * (Community launch plan C9, migration 214) — the mutation C10's Report menus
 * use. It resolves with the database's answer as a `ReportOutcome` (reported,
 * already reported, the hourly limit's wait, a plain-words refusal, or
 * "Reporting isn't available yet" before 214 is pushed) so the caller shows
 * it as it is; only an unexpected failure (`kind: 'error'`) rejects, so it
 * reaches the caller's error toast and is never mistaken for a sent report.
 */
export function useReportContent() {
  return useMutation<ReportOutcome, Error, ReportInput>({
    mutationFn: async (input) => {
      const outcome = await reportContent(createBrowserClient(), input)
      if (outcome.kind === 'error') throw new Error(outcome.message)
      return outcome
    },
  })
}
