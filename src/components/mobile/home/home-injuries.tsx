'use client'

import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { posLabel } from '@/components/mobile/ui/m-pos-chip'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { useMobileHomeInjuries, type HomeInjury } from '@/hooks/use-mobile-home-injuries'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { injuryNote, injuryPillClass } from './home-ops'
import { HomeNote, HomeRowSkeletons, HomeSectionTitle } from './home-section'

/**
 * "Injury news" (m-home §2A.10–11): five injured players — the user's own
 * first, with "On your roster · {team}" in blue — each with the feed's
 * designation pill and injury detail. A row opens the player's profile.
 */
export function HomeInjuries({ leagues, ready }: { leagues: readonly MyLeagueRow[]; ready: boolean }) {
  const injuries = useMobileHomeInjuries(leagues, { rows: 5, ready })
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  return (
    <section>
      <HomeSectionTitle title="Injury news" className="mt-6" />
      {injuries.isPending ? (
        <HomeRowSkeletons count={5} height={53} />
      ) : injuries.isError ? (
        <HomeNote tone="error" action={{ label: 'Try again', onClick: injuries.refetch }}>
          Couldn’t load injury news.
        </HomeNote>
      ) : injuries.items.length === 0 ? (
        <HomeNote>No injury designations right now.</HomeNote>
      ) : (
        <div className="mt-1 flex flex-col">
          {injuries.items.map((p) => (
            <InjuryRow key={p.id} p={p} onOpen={() => openPlayer(p.id)} />
          ))}
        </div>
      )}
    </section>
  )
}

function InjuryRow({ p, onOpen }: { p: HomeInjury; onOpen: () => void }) {
  const note = injuryNote(p)
  const meta = [posLabel(p.position), p.team].filter(Boolean).join(' · ')
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 border-b border-m-b2 py-[10px] text-left">
      <MHeadshot player={p} size={40} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold leading-[17px] text-m-t1">
          {p.full_name} <span className="text-[11px] font-medium text-m-t3">{meta}</span>
        </span>
        {note && <span className="truncate text-[12px] font-medium leading-[15px] text-m-t2">{note}</span>}
        {p.myTeams.length > 0 && (
          <span className="truncate text-[11px] font-semibold leading-[14px] text-accent">On your roster · {p.myTeams.join(', ')}</span>
        )}
      </span>
      <span className="flex flex-none flex-col items-end gap-1">
        <span className={cn('flex h-[22px] items-center whitespace-nowrap rounded-pill px-2 text-[11px] font-semibold', injuryPillClass(p.status))}>
          {p.status}
        </span>
      </span>
    </button>
  )
}
