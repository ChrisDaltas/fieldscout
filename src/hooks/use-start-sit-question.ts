'use client'

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import type { SsQuestionDetail } from '@/components/mobile/profile/profile-ops'
import { SS_QUESTION_SELECT, one, toSsQuestion, type Embedded } from '@/hooks/use-mobile-profile-start-sit'
import { createBrowserClient } from '@/lib/supabase/client'

/** Any 8-4-4-4-12 hex id — what Postgres' `uuid` accepts. */
const questionIdSchema = z.guid()

interface Poster {
  id: string
  username: string
  avatar_url: string | null
}

/**
 * The read behind `useStartSitQuestion`: one start/sit question for its own
 * page (`/app/start-or-sit/[id]`). `start_sit_questions` is public to read
 * under RLS, so anyone signed in can open anyone's question. The same
 * columns My start/sit reads, plus who asked it and the scoring system's
 * name.
 *
 * `null` means there is no such question to show, and only for a reason the
 * read proves: the id isn't an id at all (never sent — Postgres would refuse
 * it as an error), or no row came back (gone, or voided — My start/sit
 * leaves voided questions out too). A failed read throws instead, so the
 * page says it couldn't load rather than "not here".
 */
export async function readStartSitQuestion(questionId: string): Promise<SsQuestionDetail | null> {
  if (!questionIdSchema.safeParse(questionId).success) return null
  const supabase = createBrowserClient()
  const { data, error } = await supabase
    .from('start_sit_questions')
    .select(
      `${SS_QUESTION_SELECT}, poster:profiles!start_sit_questions_poster_id_fkey(id, username, avatar_url), scoring:scoring_systems!start_sit_questions_scoring_system_id_fkey(name)`,
    )
    .eq('id', questionId)
    .not('is_voided', 'is', true)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const where = 'Start or sit'
  const question = toSsQuestion(data, where)
  // The poster is a NOT NULL foreign key and profiles are public to read: a
  // missing one is a broken read, not an anonymous question.
  const poster = one(data.poster as Embedded<Poster>)
  if (!poster) throw new Error(`${where}: question ${data.id} is missing its poster`)
  // A member's own scoring system is private to them — then the name can't
  // be read and the page says just the week.
  const scoring = one(data.scoring as Embedded<{ name: string | null }>)
  return {
    ...question,
    poster: { id: poster.id, username: poster.username, avatarUrl: poster.avatar_url },
    scoringName: scoring?.name ?? null,
  }
}

/** One start/sit question for its own page (`readStartSitQuestion`). */
export function useStartSitQuestion(questionId: string) {
  return useQuery({
    queryKey: ['start-sit-question', questionId],
    queryFn: () => readStartSitQuestion(questionId),
  })
}
