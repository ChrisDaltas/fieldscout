'use client'

import { CenterNote } from '@/components/mobile/lists/lists-parts'
import { QuestionCard } from '@/components/mobile/profile/my-start-sit-screen'
import { ssQuestionMeta } from '@/components/mobile/profile/profile-ops'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MobileScreen, MPageBar } from '@/components/mobile/ui/mobile-header'
import { useStartSitQuestion } from '@/hooks/use-start-sit-question'

/** Where both question pages' Back goes when nothing in the app is behind:
 *  their URL parent, the phone's My start/sit. */
export const START_SIT_PARENT = '/app/start-or-sit'

/** Copy shared by the screens and their tests. */
export const ASK_START_SIT_COPY = {
  title: 'Ask a question',
  noteTitle: 'Asking is coming soon',
  noteBody: 'Pick the players, ask the community who to start, and see how they vote before kickoff.',
} as const

export const START_SIT_QUESTION_COPY = {
  title: 'Start or sit',
  missingTitle: 'This question isn’t here',
  missingBody: 'It may have been taken down, or the link is wrong.',
  error: 'Couldn’t load this question',
  retry: 'Try again',
} as const

/**
 * Ask a question on the phone (`/app/start-or-sit/new`, gap list §4 item
 * 112) — the same page as desktop's, which can't post yet: there is no way
 * to save a question (no route, and the handoff's 2–6 player composer needs
 * storage the app doesn't have — gap list §2). So the screen is desktop's
 * honest "coming soon" in the phone's language rather than a composer whose
 * Post does nothing (CLAUDE.md: features with no backend are left out, not
 * stubbed): the G-page bar (blue back, "Ask a question" — the handoff's
 * button label) over the Lists-style centred note. Back goes to where you
 * came from, else My start/sit.
 */
export function MobileAskStartSit() {
  const goBack = useGoBack()
  return (
    <MobileScreen
      header={<MPageBar title={ASK_START_SIT_COPY.title} onBack={() => goBack(START_SIT_PARENT)} />}
      className="leading-[normal]"
    >
      <div className="px-4 pb-8" data-start-sit-ask>
        <CenterNote title={ASK_START_SIT_COPY.noteTitle} body={ASK_START_SIT_COPY.noteBody} className="py-16" />
      </div>
    </MobileScreen>
  )
}

/**
 * A start/sit question on the phone (`/app/start-or-sit/[id]`, gap list §4
 * item 112). Desktop's page holds the spot where "community votes land …
 * with the start/sit split"; the phone shows that split on the question's
 * real row (`useStartSitQuestion` — the same public read My start/sit uses),
 * in My start/sit's question card with Community's author row on top: who
 * asked (their @handle opens their profile) and when, the week, the Start
 * 1 of 2 and Open / Closed pills, the question, both players' vote bars and
 * the vote count.
 *
 * The handoff draws no question page, so it extends the G pages: the page
 * bar (blue back, "Start or sit") over the card. Voting is left out — the
 * app has no way to cast a vote yet (gap list §2) — so the card reads the
 * way it does in My start/sit. States: a card-shaped loading block; "This
 * question isn't here" when the id isn't one or no question comes back
 * (gone, or voided); a failed read says so with Try again. Back goes to
 * where you came from, else My start/sit.
 */
export function MobileStartSitQuestion({ questionId }: { questionId: string }) {
  const goBack = useGoBack()
  const { data, isError, refetch } = useStartSitQuestion(questionId)
  // Read once per render — open/closed and "2h" are a moment in time.
  const now = Date.now()

  return (
    <MobileScreen
      header={<MPageBar title={START_SIT_QUESTION_COPY.title} onBack={() => goBack(START_SIT_PARENT)} />}
      className="leading-[normal]"
    >
      <div className="px-4 pb-8 pt-4" data-start-sit-question>
        {data === undefined ? (
          isError ? (
            <CenterNote
              title={START_SIT_QUESTION_COPY.error}
              action={
                <button type="button" onClick={() => void refetch()} className="text-[13px] font-semibold text-accent">
                  {START_SIT_QUESTION_COPY.retry}
                </button>
              }
              className="py-16"
            />
          ) : (
            <span aria-busy="true" aria-label="Loading" className="block h-[226px] rounded-[18px] bg-m-b1" />
          )
        ) : data === null ? (
          <CenterNote
            title={START_SIT_QUESTION_COPY.missingTitle}
            body={START_SIT_QUESTION_COPY.missingBody}
            className="py-16"
          />
        ) : (
          <QuestionCard
            q={data}
            now={now}
            author={{
              profileId: data.poster.id,
              username: data.poster.username,
              avatarUrl: data.poster.avatarUrl,
              meta: ssQuestionMeta(data),
            }}
          />
        )}
      </div>
    </MobileScreen>
  )
}
