'use client'

import { OVERRIDE_ON_INDICATOR } from '@/components/leagues/league-shell-ops'
import { useLeague } from '@/hooks/use-league'
import { cn } from '@/lib/utils'
import { useCommishOverrideStore, useOverrideMode, useOverrideSaving } from '@/stores/commish-override-store'

/**
 * "Commissioner override on · Turn off" for the mobile league screens — the
 * phone's copy of the desktop league header's indicator, so a commissioner
 * in override mode always sees it and can leave it from any league screen.
 * Renders nothing unless override is on and the viewer runs the league.
 */
export function MobileOverrideStrip({ leagueId, className }: { leagueId: string; className?: string }) {
  const detail = useLeague(leagueId)
  const on = useOverrideMode(leagueId)
  const exit = useCommishOverrideStore((s) => s.exit)
  const busy = useOverrideSaving()
  const role = detail.data?.my_role
  const isCommish = role === 'commissioner' || role === 'co_commissioner'
  if (!on || !isCommish) return null
  return (
    <div
      className={cn('mx-3 mt-1.5 flex items-center justify-between gap-3 rounded-[12px] bg-m-gg px-3 py-2', className)}
      role="status"
      data-override-indicator
    >
      <span className="text-[13px] font-semibold text-m-tg">{OVERRIDE_ON_INDICATOR}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!busy) exit()
        }}
        className="flex-none text-[13px] font-semibold text-accent disabled:text-m-t5"
        title={busy ? 'Wait for the save to finish.' : undefined}
        data-override-off
      >
        Turn off
      </button>
    </div>
  )
}
