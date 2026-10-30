/**
 * Admin › Reports — reading C9's `content_reports` (migration 214) for the
 * admin page (Community launch plan C10). Server-only: the table has RLS on
 * and no client policy, so `/api/admin/reports` reads it with the service
 * role after `requireAdminUser`, then looks up what each report is about —
 * the list or comment, who wrote it, who reported it, who reviewed it — and
 * shapes one row per report. No report text ever leaves for anyone but an
 * admin.
 *
 * DEPLOY BEFORE PUSH: until 214 is on the database the table is missing
 * (PGRST205 / 42P01 naming `content_reports`) and the read answers
 * `unavailable` — the page then says reports aren't available yet, never a
 * fake "no reports".
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingSchemaObject } from '@/lib/supabase/postgrest-errors'

/** The newest this many reports are shown; the total says how many there are. */
export const ADMIN_REPORTS_LIMIT = 200

export const REPORTS_UNAVAILABLE = 'Reports aren’t available yet. They start once the reports database update is pushed.'

export type AdminReportKind = 'list' | 'comment' | 'start_sit'
export type AdminReportReason = 'spam' | 'abusive' | 'other'

/** What the reported list (or the reported comment's list) is now. */
export type AdminReportListState = 'live' | 'private' | 'deleted' | 'missing'

export interface AdminReportList {
  id: string
  /** Null when the list is gone (`missing`). */
  title: string | null
  /** The list belongs to the admin reading the page (it opens in his Lists). */
  own: boolean
  state: AdminReportListState
}

export interface AdminReport {
  id: string
  kind: AdminReportKind
  reason: AdminReportReason | null
  note: string | null
  created_at: string
  reviewed_at: string | null
  /** Usernames — null when that account is gone. */
  reviewer: string | null
  reporter: string | null
  /** Who wrote the reported thing (the list's owner, the comment's author, the question's asker). */
  author: string | null
  list: AdminReportList | null
  /** A reported comment: its words, and whether it has been removed. Null when the comment is gone. */
  comment: { body: string; removed: boolean } | null
}

export interface AdminReportsPayload {
  reports: AdminReport[]
  /** Every report, reviewed or not. */
  total: number
  /** Reports nobody has reviewed yet — "N new reports". */
  open: number
  limit: number
}

export type AdminReportsRead =
  | { ok: true; payload: AdminReportsPayload }
  | { ok: false; status: 503 | 500; error: string }

interface ReportRow {
  id: string
  reporter_id: string
  target_type: string
  target_id: string
  list_id: string | null
  reason: string | null
  note: string | null
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

interface ListRow {
  id: string
  title: string
  owner_id: string
  is_private: boolean
  deleted_at: string | null
}

interface CommentRow {
  id: string
  author_id: string
  body: string
  deleted_at: string | null
}

interface QuestionRow {
  id: string
  poster_id: string
}

interface ProfileRow {
  id: string
  username: string | null
}

const REASONS: readonly string[] = ['spam', 'abusive', 'other']

function listState(row: ListRow | undefined): AdminReportListState {
  if (!row) return 'missing'
  if (row.deleted_at) return 'deleted'
  if (row.is_private) return 'private'
  return 'live'
}

/** One row per report, from the report rows and the lookups. Pure. */
export function shapeAdminReports(
  rows: readonly ReportRow[],
  lookups: {
    lists: readonly ListRow[]
    comments: readonly CommentRow[]
    questions: readonly QuestionRow[]
    profiles: readonly ProfileRow[]
  },
  viewerId: string,
): AdminReport[] {
  const lists = new Map(lookups.lists.map((l) => [l.id, l]))
  const comments = new Map(lookups.comments.map((c) => [c.id, c]))
  const questions = new Map(lookups.questions.map((q) => [q.id, q]))
  const names = new Map(lookups.profiles.map((p) => [p.id, p.username]))
  const name = (id: string | null | undefined) => (id ? (names.get(id) ?? null) : null)

  return rows.map((r) => {
    const kind: AdminReportKind = r.target_type === 'comment' ? 'comment' : r.target_type === 'start_sit' ? 'start_sit' : 'list'
    const listRow = r.list_id ? lists.get(r.list_id) : undefined
    const list: AdminReportList | null = r.list_id
      ? { id: r.list_id, title: listRow?.title ?? null, own: listRow?.owner_id === viewerId, state: listState(listRow) }
      : null
    const commentRow = kind === 'comment' ? comments.get(r.target_id) : undefined
    const author =
      kind === 'comment'
        ? name(commentRow?.author_id)
        : kind === 'start_sit'
          ? name(questions.get(r.target_id)?.poster_id)
          : name(listRow?.owner_id)
    return {
      id: r.id,
      kind,
      reason: r.reason && REASONS.includes(r.reason) ? (r.reason as AdminReportReason) : null,
      note: r.note,
      created_at: r.created_at,
      reviewed_at: r.reviewed_at,
      reviewer: name(r.reviewed_by),
      reporter: name(r.reporter_id),
      author,
      list,
      comment: commentRow ? { body: commentRow.body, removed: Boolean(commentRow.deleted_at) } : null,
    }
  })
}

type ReadError = { code?: string | null; message: string } | null

function unique(values: Iterable<string | null | undefined>): string[] {
  return [...new Set([...values].filter((v): v is string => typeof v === 'string' && v !== ''))]
}

/**
 * Every report, newest first (the newest `ADMIN_REPORTS_LIMIT`), with what
 * each is about. `admin` is the service-role client; `viewerId` the admin
 * reading. Any failed read is loud (500), the missing table is `unavailable`
 * (503) — never an empty list.
 */
export async function readAdminReports(admin: SupabaseClient, viewerId: string): Promise<AdminReportsRead> {
  const missing = (error: ReadError) => isMissingSchemaObject(error, ['content_reports'])

  const reportsRead = await admin
    .from('content_reports')
    .select('id, reporter_id, target_type, target_id, list_id, reason, note, created_at, reviewed_at, reviewed_by', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(ADMIN_REPORTS_LIMIT)
  if (reportsRead.error) {
    if (missing(reportsRead.error)) return { ok: false, status: 503, error: REPORTS_UNAVAILABLE }
    return { ok: false, status: 500, error: reportsRead.error.message }
  }
  if (typeof reportsRead.count !== 'number') {
    return { ok: false, status: 500, error: 'The reports read came back without a count.' }
  }

  const openRead = await admin
    .from('content_reports')
    .select('id', { count: 'exact', head: true })
    .is('reviewed_at', null)
  if (openRead.error) {
    if (missing(openRead.error)) return { ok: false, status: 503, error: REPORTS_UNAVAILABLE }
    return { ok: false, status: 500, error: openRead.error.message }
  }
  if (typeof openRead.count !== 'number') {
    return { ok: false, status: 500, error: 'The new-reports count came back empty.' }
  }

  const rows = (reportsRead.data ?? []) as ReportRow[]
  const listIds = unique(rows.map((r) => r.list_id))
  const commentIds = unique(rows.filter((r) => r.target_type === 'comment').map((r) => r.target_id))
  const questionIds = unique(rows.filter((r) => r.target_type === 'start_sit').map((r) => r.target_id))

  const [listsRead, commentsRead, questionsRead] = await Promise.all([
    listIds.length
      ? admin.from('lists').select('id, title, owner_id, is_private, deleted_at').in('id', listIds)
      : Promise.resolve({ data: [] as ListRow[], error: null }),
    commentIds.length
      ? admin.from('list_comments').select('id, author_id, body, deleted_at').in('id', commentIds)
      : Promise.resolve({ data: [] as CommentRow[], error: null }),
    questionIds.length
      ? admin.from('start_sit_questions').select('id, poster_id').in('id', questionIds)
      : Promise.resolve({ data: [] as QuestionRow[], error: null }),
  ])
  for (const read of [listsRead, commentsRead, questionsRead]) {
    if (read.error) return { ok: false, status: 500, error: read.error.message }
  }
  const lists = (listsRead.data ?? []) as ListRow[]
  const comments = (commentsRead.data ?? []) as CommentRow[]
  const questions = (questionsRead.data ?? []) as QuestionRow[]

  const profileIds = unique([
    ...rows.map((r) => r.reporter_id),
    ...rows.map((r) => r.reviewed_by),
    ...lists.map((l) => l.owner_id),
    ...comments.map((c) => c.author_id),
    ...questions.map((q) => q.poster_id),
  ])
  const profilesRead = profileIds.length
    ? await admin.from('profiles').select('id, username').in('id', profileIds)
    : { data: [] as ProfileRow[], error: null }
  if (profilesRead.error) return { ok: false, status: 500, error: profilesRead.error.message }

  return {
    ok: true,
    payload: {
      reports: shapeAdminReports(rows, { lists, comments, questions, profiles: (profilesRead.data ?? []) as ProfileRow[] }, viewerId),
      total: reportsRead.count,
      open: openRead.count,
      limit: ADMIN_REPORTS_LIMIT,
    },
  }
}
