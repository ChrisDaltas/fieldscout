'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useDeferredValue, useState, type KeyboardEvent } from 'react'

import { UsernameLink } from '@/components/shared/username-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAdminLeagueDetail } from '@/hooks/use-admin-league-detail'
import { useAdminLeagueTable } from '@/hooks/use-admin-league-table'
import {
  canBeMadeCommissioner,
  commissionerBeforeAfter,
  LEAGUE_PAGE_SIZE,
  pageWords,
  recordWords,
  roleWords,
  restoreLeagueConfirm,
  setCommissionerUrl,
  type LeagueSort,
  type OpLeagueDetail,
  type OpLeagueList,
  type OpLeagueRow,
} from '@/lib/admin/league-table'
import { cn } from '@/lib/utils'

import { AdminEmpty, AdminError, AdminHeader, AdminLoading, AdminSection, when, type ConfirmSpec } from './admin-parts'

// ---------------------------------------------------------------------------
// /app/admin/leagues — every league on the platform (193 `op_list_leagues`).
// ---------------------------------------------------------------------------

function day(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const COLUMNS: { key: string; label: string; sort?: LeagueSort; numeric?: boolean }[] = [
  { key: 'name', label: 'League', sort: 'name' },
  { key: 'status', label: 'Phase', sort: 'status' },
  { key: 'season', label: 'Season', sort: 'season', numeric: true },
  { key: 'commissioner', label: 'Commissioner', sort: 'commissioner' },
  { key: 'members', label: 'Managers', sort: 'members', numeric: true },
  { key: 'open', label: 'Open seats', numeric: true },
  { key: 'draft', label: 'Draft' },
  { key: 'week', label: 'Week' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'roster', label: 'Roster', numeric: true },
  { key: 'waivers', label: 'Waivers' },
  { key: 'trades', label: 'Trade review' },
  { key: 'playoffs', label: 'Playoffs' },
  { key: 'created', label: 'Created', sort: 'created' },
]

/** `/app/admin/leagues` — the all-leagues table. */
export function AdminLeagueTablePage() {
  const router = useRouter()
  const [text, setText] = useState('')
  const q = useDeferredValue(text.trim())
  const [sort, setSort] = useState<LeagueSort>('created')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [offset, setOffset] = useState(0)
  const [deleted, setDeleted] = useState(false)
  const table = useAdminLeagueTable({ q, sort, dir, offset, deleted })

  const onSort = (s: LeagueSort) => {
    if (s === sort) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSort(s)
      setDir(s === 'name' || s === 'commissioner' || s === 'status' ? 'asc' : 'desc')
    }
    setOffset(0)
  }

  return (
    <div className="flex flex-col gap-5" data-admin-page="leagues">
      <AdminHeader title="Admin" />
      <AdminSection
        title="All leagues"
        hint="Every league on FieldScout. Search by league name or commissioner. Open a league for its members, settings and live state."
        data-admin-section="league-table"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setOffset(0)
            }}
            placeholder="League or commissioner"
            aria-label="Search leagues"
            maxLength={80}
            className="min-w-0 flex-1 basis-56"
          />
          <div className="flex items-center gap-2">
            <Checkbox
              id="admin-leagues-deleted"
              checked={deleted}
              onCheckedChange={(v) => {
                setDeleted(v === true)
                setOffset(0)
              }}
            />
            <Label htmlFor="admin-leagues-deleted" className="text-[11px] font-medium text-n-3">
              Show archived
            </Label>
          </div>
        </div>
        {table.isLoading ? (
          <AdminLoading rows={6} label="league-table" />
        ) : table.error ? (
          <AdminError error={table.error} onRetry={() => table.refetch()} what="the leagues" />
        ) : table.data ? (
          <LeagueTableBody
            list={table.data}
            sort={sort}
            dir={dir}
            onSort={onSort}
            onOpen={(id) => router.push(`/app/admin/leagues/${id}`)}
            onPage={setOffset}
            fetching={table.isFetching}
          />
        ) : null}
      </AdminSection>
    </div>
  )
}

/** Presentational — exported for the render tests. */
export function LeagueTableBody({
  list,
  sort,
  dir,
  onSort,
  onOpen,
  onPage,
  fetching = false,
}: {
  list: OpLeagueList
  sort: LeagueSort
  dir: 'asc' | 'desc'
  onSort: (s: LeagueSort) => void
  onOpen: (id: string) => void
  onPage: (offset: number) => void
  fetching?: boolean
}) {
  if (list.leagues.length === 0) {
    return (
      <AdminEmpty label="league-table">
        {list.q
          ? `No league or commissioner matches “${list.q}”.`
          : list.total > 0
            ? 'This page is past the last league.'
            : 'There are no leagues yet.'}
      </AdminEmpty>
    )
  }
  const limit = list.limit || LEAGUE_PAGE_SIZE
  const cut = list.more || list.offset > 0
  return (
    <div className={cn('flex flex-col gap-2', fetching && 'opacity-70')} data-league-table>
      <p className="text-[11px] font-semibold text-n-3" data-league-total={list.total}>
        {pageWords(list)}
        {list.include_deleted ? ' (archived included)' : ''}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((c, i) => (
              <TableHead
                key={c.key}
                className={cn(
                  'whitespace-nowrap',
                  c.numeric && 'text-right',
                  i === 0 && 'sticky left-0 z-[1] bg-white',
                )}
                aria-sort={c.sort === sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {c.sort ? (
                  <button
                    type="button"
                    onClick={() => onSort(c.sort as LeagueSort)}
                    className={cn('inline-flex items-center gap-1 hover:text-ink', c.sort === sort && 'text-ink')}
                    data-sort={c.sort}
                  >
                    {c.label}
                    {c.sort === sort && <span aria-hidden>{dir === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                ) : (
                  c.label
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.leagues.map((l) => (
            <LeagueTableRow key={l.id} league={l} onOpen={onOpen} />
          ))}
        </TableBody>
      </Table>
      {cut && (
        <div className="flex flex-wrap items-center gap-2" data-overflow="league-table">
          <Button size="sm" variant="stroke" disabled={list.offset === 0} onClick={() => onPage(Math.max(0, list.offset - limit))}>
            Previous
          </Button>
          <Button size="sm" variant="stroke" disabled={!list.more} onClick={() => onPage(list.offset + limit)}>
            Next
          </Button>
          <span className="text-[10px] font-medium text-n-6">
            {limit} per page · {list.total} in all
          </span>
        </div>
      )}
    </div>
  )
}

function LeagueTableRow({ league: l, onOpen }: { league: OpLeagueRow; onOpen: (id: string) => void }) {
  const s = l.settings_summary
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(l.id)
  }
  return (
    <TableRow
      className="group cursor-pointer"
      onClick={() => onOpen(l.id)}
      onKeyDown={onKey}
      tabIndex={0}
      data-league-row={l.id}
    >
      <TableCell className="sticky left-0 z-[1] max-w-[14rem] bg-white group-hover:bg-surface-sunken">
        <Link
          href={`/app/admin/leagues/${l.id}`}
          onClick={(e) => e.stopPropagation()}
          className="block truncate font-semibold text-ink hover:underline"
        >
          {l.name}
        </Link>
        {/* 212 (F716): `deleted_at` is the archived-at stamp — leagues are
            archived by their commissioner, never deleted. */}
        {l.deleted_at && (
          <Badge variant="pink" className="mt-0.5" data-archived>
            Archived {day(l.deleted_at)}
          </Badge>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">{l.phase}</TableCell>
      <TableCell className="fs-num text-right">{l.season}</TableCell>
      <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        {l.commissioner ? <UsernameLink username={l.commissioner} className="font-medium" /> : <span className="text-n-6">None</span>}
      </TableCell>
      <TableCell className="fs-num whitespace-nowrap text-right">
        {l.members} / {l.team_count}
      </TableCell>
      <TableCell className={cn('fs-num text-right', l.open_seats > 0 && 'font-semibold text-caution-strong')}>
        {l.open_seats}
      </TableCell>
      <TableCell className="whitespace-nowrap">{l.draft?.summary ?? <span className="text-n-6">No draft yet</span>}</TableCell>
      <TableCell className="whitespace-nowrap">{l.current_week?.summary ?? <span className="text-n-6">—</span>}</TableCell>
      <TableCell className="whitespace-nowrap">{s.scoring}</TableCell>
      <TableCell className="fs-num text-right" title={s.roster}>
        {s.roster_size}
      </TableCell>
      <TableCell className="whitespace-nowrap">{s.waivers}</TableCell>
      <TableCell className="whitespace-nowrap">{s.trade_review}</TableCell>
      <TableCell className="whitespace-nowrap">{s.playoffs}</TableCell>
      <TableCell className="whitespace-nowrap">{day(l.created_at)}</TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// The admin league page's Members + Settings sections (193 `op_league_detail`).
// ---------------------------------------------------------------------------

export function AdminLeagueDetailSections({
  leagueId,
  onConfirm,
}: {
  leagueId: string
  /** Opens the console's confirm dialog (Make commissioner — F750). */
  onConfirm?: (spec: ConfirmSpec) => void
}) {
  const q = useAdminLeagueDetail(leagueId)
  if (q.isLoading) {
    return (
      <AdminSection title="Members" data-admin-section="league-members">
        <AdminLoading rows={4} label="league-detail" />
      </AdminSection>
    )
  }
  if (q.error) {
    return (
      <AdminSection title="Members and settings" data-admin-section="league-members">
        <AdminError error={q.error} onRetry={() => q.refetch()} what="this league’s members and settings" />
      </AdminSection>
    )
  }
  return q.data ? <LeagueDetailBody detail={q.data} onConfirm={onConfirm} /> : null
}

/** Every stored setting, flat: the columns, then the settings blob, then the roster shape. */
export function rawSettings(detail: OpLeagueDetail): [string, unknown][] {
  const { settings, roster_settings, ...columns } = detail.settings
  return [...Object.entries(columns), ...Object.entries(settings ?? {}), ['roster_settings', roster_settings]]
}

/** Presentational — exported for the render tests. */
export function LeagueDetailBody({
  detail,
  onConfirm,
}: {
  detail: OpLeagueDetail
  onConfirm?: (spec: ConfirmSpec) => void
}) {
  const l = detail.league
  const s = l.settings_summary
  // F750 / migration 208: FieldScout replaces a missing commissioner. Only a
  // person who is not already the commissioner is offered the control.
  const makeCommissioner = (m: OpLeagueDetail['members'][number]) => {
    const who = m.username ?? m.team_name ?? 'this member'
    onConfirm?.({
      title: `Make ${who} the commissioner`,
      ...commissionerBeforeAfter(m, detail.members),
      confirmLabel: 'Make commissioner',
      url: setCommissionerUrl(l.id),
      body: { member_id: m.member_id },
    })
  }
  return (
    <>
      <AdminSection
        title="Members"
        hint={
          <>
            <span className="fs-num">{l.members}</span> {l.members === 1 ? 'manager' : 'managers'} in{' '}
            <span className="fs-num">{l.team_count}</span> seats ·{' '}
            <span className="fs-num">{l.open_seats}</span> open · {l.phase}
            {l.deleted_at && <> · archived {day(l.deleted_at)}</>}
          </>
        }
        data-admin-section="league-members"
      >
        {/* F851 (212): an archived league can be restored by FieldScout — its
            commissioner may be the one who is gone. */}
        {l.deleted_at && (
          <div className="flex flex-wrap items-center gap-2.5 rounded-message bg-surface-sunken px-3 py-2" data-archived-notice>
            <span className="mr-auto text-[11px] font-semibold text-ink">
              Archived {day(l.deleted_at)} — hidden from its members, and nothing in it changes.
            </span>
            {onConfirm && (
              <Button size="sm" variant="stroke" onClick={() => onConfirm(restoreLeagueConfirm(l))} data-restore-league={l.id}>
                Restore league
              </Button>
            )}
          </div>
        )}
        {detail.record_error && (
          <p className="text-[11px] font-semibold text-caution-strong" data-record-error>
            Records not shown: {recordErrorWords(detail.record_error)}
          </p>
        )}
        {detail.members.length === 0 ? (
          <AdminEmpty label="league-members">No one has joined this league.</AdminEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-[1] bg-white">Team</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Record</TableHead>
                {onConfirm && <TableHead className="sr-only">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.members.map((m) => (
                <TableRow key={m.member_id} data-member={m.member_id}>
                  <TableCell className="sticky left-0 z-[1] max-w-[12rem] truncate bg-white font-semibold text-ink">
                    {m.team_name ?? <span className="font-medium text-n-6">No team yet</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {m.username ? <UsernameLink username={m.username} className="font-medium" /> : <span className="text-n-6">—</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{roleWords(m.role)}</TableCell>
                  <TableCell className="whitespace-nowrap">{day(m.joined_at)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="inline-flex gap-1">
                      {m.vacant && (
                        <Badge variant="yellow" data-vacant>
                          Vacant
                        </Badge>
                      )}
                      {m.autopilot && (
                        <Badge variant="stroke-purple" data-autopilot>
                          Autopilot
                        </Badge>
                      )}
                      {!m.vacant && !m.autopilot && <span className="text-n-6">Active</span>}
                    </span>
                  </TableCell>
                  <TableCell className="fs-num text-right">{recordWords(m.record)}</TableCell>
                  {onConfirm && (
                    <TableCell className="whitespace-nowrap text-right">
                      {canBeMadeCommissioner(m, l) && (
                        <Button size="sm" variant="stroke" onClick={() => makeCommissioner(m)} data-make-commissioner={m.member_id}>
                          Make commissioner
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminSection>

      <AdminSection title="Settings" hint={<>As of {when(detail.as_of)}</>} data-admin-section="league-settings">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2" data-settings-summary>
          {(
            [
              ['Season', String(l.season)],
              ['Scoring', s.scoring],
              ['Roster', `${s.roster_size} spots — ${s.roster}`],
              ['Waivers', s.waivers],
              ['Trade review', s.trade_review],
              ['Trade deadline', s.trade_deadline],
              ['Schedule', s.schedule],
              ['Season length', s.season_length],
              ['Playoffs', s.playoffs],
              ['Draft', l.draft?.summary ?? 'No draft yet'],
              ['Current week', l.current_week?.summary ?? '—'],
              ['Created', day(l.created_at)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex min-w-0 gap-2 text-[12px]">
              <dt className="w-28 shrink-0 font-medium text-n-6">{k}</dt>
              <dd className="min-w-0 break-words font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <details className="pt-1" data-settings-raw>
          <summary className="cursor-pointer text-[11px] font-semibold text-accent">Every stored setting</summary>
          <dl className="mt-2 flex flex-col gap-1">
            {rawSettings(detail)
              .map(([k, v]) => (
                <div key={k} className="flex min-w-0 gap-2 text-[11px]">
                  <dt className="w-44 shrink-0 font-mono text-n-6">{k}</dt>
                  <dd className="min-w-0 break-all font-mono text-ink">
                    {v === null ? 'none' : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </dd>
                </div>
              ))}
          </dl>
        </details>
      </AdminSection>
    </>
  )
}

/** 193's detail read still says "deleted" for a league whose `deleted_at` is
 *  set (SQL text pinned by pgTAP 141); since 212 (F716) that stamp means
 *  ARCHIVED, so the operator reads the word that is true. Anything else
 *  passes through unchanged. */
export function recordErrorWords(text: string): string {
  return text === 'The league is deleted, so it has no standings.' ? 'The league is archived, so its standings aren’t shown.' : text
}
