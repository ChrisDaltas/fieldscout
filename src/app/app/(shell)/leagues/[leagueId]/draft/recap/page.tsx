import { DraftRecap } from '@/components/draft/draft-recap'

export const metadata = { title: 'Draft recap · FieldScout' }

interface DraftRecapPageProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<{ draft?: string | string[] }>
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Draft recap — §16.1 `/draft/recap`, real & mock (M2 task L.B3.5).
 * `?draft=<id>` targets a specific completed draft in THIS league (the mock
 * path — recaps are the launcher's, reached from the launcher list and the
 * mock room's completion moment); absent ⇒ the league's completed REAL
 * draft. Unknown/foreign/unfinished ids all land on one honest empty state
 * (no leak — the component's RLS-derived resolution).
 */
export default async function DraftRecapPage({ params, searchParams }: DraftRecapPageProps) {
  const { leagueId } = await params
  const { draft } = await searchParams
  const draftParam = Array.isArray(draft) ? draft[0] : draft
  const draftIdParam = draftParam && UUID_RE.test(draftParam) ? draftParam : undefined

  return <DraftRecap leagueId={leagueId} draftIdParam={draftIdParam} />
}
