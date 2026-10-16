'use client'

import Link from 'next/link'

import { useAdminOperatorLog, type OperatorLogPage } from '@/hooks/use-admin-operator-log'

import { AdminEmpty, AdminError, AdminHeader, AdminLoading, AdminSection, when } from './admin-parts'
import { receiptDetail, verbWords } from './admin-console-ops'

/** `/app/admin/log` — the newest operator receipts (`platform_operator_actions`, 182). */
export function AdminLog() {
  const q = useAdminOperatorLog()
  return (
    <div className="flex flex-col gap-5" data-admin-page="log">
      <AdminHeader title="Admin" />
      <AdminSection title="Operator log" hint="Every FieldScout action that changed something. Nothing here can be edited or deleted." data-admin-section="log">
        {q.isLoading && <AdminLoading rows={6} label="log" />}
        {q.error && <AdminError error={q.error} onRetry={() => q.refetch()} what="the operator log" />}
        {q.data && <LogBody page={q.data} />}
      </AdminSection>
    </div>
  )
}

/** Presentational — exported for the render tests. */
export function LogBody({ page }: { page: OperatorLogPage }) {
  if (page.actions.length === 0) return <AdminEmpty label="log">No operator actions yet.</AdminEmpty>
  return (
    <>
      <ol className="flex flex-col divide-y divide-n-4">
        {page.actions.map((r) => {
          const detail = receiptDetail(r)
          return (
            <li key={r.id} className="flex flex-col gap-0.5 py-2" data-log-row={r.verb}>
              <span className="text-[12px] font-semibold text-ink">
                {verbWords(r.verb)}
                {detail && <span className="font-medium text-n-3"> · {detail}</span>}
              </span>
              <span className="break-words text-[10px] font-medium text-n-6">
                {when(r.created_at)} ·{' '}
                {r.league_id ? (
                  <Link href={`/app/admin/leagues/${r.league_id}`} className="font-semibold text-accent hover:underline">
                    one league
                  </Link>
                ) : (
                  'platform-wide'
                )}
                {r.reason && <> · “{r.reason}”</>}
              </span>
            </li>
          )
        })}
      </ol>
      {page.total > page.actions.length && (
        <p className="text-[10px] font-semibold text-caution-strong" data-overflow="log">
          Showing the newest {page.actions.length} of {page.total}.
        </p>
      )}
    </>
  )
}
