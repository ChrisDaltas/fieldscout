'use client'

import Link from 'next/link'
import { useState } from 'react'

import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { posLabel } from '@/components/mobile/ui/m-pos-chip'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
import type { BuilderPlayer } from '@/components/lists/builder/types'
import { useMobileHomeTrending } from '@/hooks/use-mobile-home-trending'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { signedDelta, type TrendEntry } from './home-ops'
import { HomeNote, HomeRowSkeletons, HomeSectionTitle } from './home-section'

type TrendTab = 'risers' | 'fallers'

/**
 * "Trending players" (m-home §2A.7–9): a two-way segmented control over five
 * rows. The design's Adds/Drops are add/drop counts with rostered %, which
 * the app has no source for; its one trend signal is projection vs last
 * season, so the segments name what the numbers are — Risers / Fallers —
 * and each row says both figures. A row opens the player's profile.
 * "See all" opens League › Players on Available (`seeAllHref`, only while
 * the user has a league to open — the leagues release), whose Trending
 * section ranks the same projection risers.
 */
export function HomeTrending({ seeAllHref }: { seeAllHref: string | null }) {
  const [tab, setTab] = useState<TrendTab>('risers')
  const trend = useMobileHomeTrending(5)
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const entries = tab === 'risers' ? trend.risers : trend.fallers
  return (
    <section>
      <HomeSectionTitle
        title="Trending players"
        align="center"
        className="mt-6"
        right={
          seeAllHref ? (
            // 16px line box as designed; the padding grows the tap area to 30px without moving it.
            <Link href={seeAllHref} className="-my-[7px] py-[7px] text-[13px] font-semibold leading-[16px] text-accent">
              See all
            </Link>
          ) : null
        }
      />
      <MSegmented
        label="Trending players"
        options={[
          { value: 'risers', label: 'Risers' },
          { value: 'fallers', label: 'Fallers' },
        ]}
        value={tab}
        onChange={setTab}
        className="mt-[10px]"
        itemClassName="rounded-md transition-none leading-[16px]"
      />
      {trend.isPending ? (
        <HomeRowSkeletons count={5} height={47} />
      ) : trend.isError ? (
        <HomeNote tone="error" action={{ label: 'Try again', onClick: () => void trend.refetch() }}>
          Couldn’t load trending players.
        </HomeNote>
      ) : entries.length === 0 ? (
        <HomeNote>{tab === 'risers' ? 'No risers yet' : 'No fallers yet'} — trends need last season’s stats.</HomeNote>
      ) : (
        <div className="mt-1 flex flex-col">
          {entries.map((e) => (
            <TrendRow key={e.player.id} entry={e} onOpen={() => openPlayer(e.player.id)} />
          ))}
        </div>
      )}
    </section>
  )
}

function TrendRow({ entry, onOpen }: { entry: TrendEntry<BuilderPlayer>; onOpen: () => void }) {
  const p = entry.player
  const up = entry.delta >= 0
  const meta = [posLabel(p.position), p.team, `Proj ${(p.projected_pts ?? 0).toFixed(1)}`, `Last yr ${p.last_pts.toFixed(1)}`]
    .filter(Boolean)
    .join(' · ')
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 border-b border-m-b2 py-[9px] text-left">
      <MHeadshot player={p} size={36} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[14px] font-semibold leading-[17px] text-m-t1">{p.full_name}</span>
        <span className="truncate text-[11px] font-medium leading-[14px] text-m-t3 tabular-nums">{meta}</span>
      </span>
      <span className={cn('flex-none text-[14px] font-semibold leading-[17px] tabular-nums', up ? 'text-m-green' : 'text-m-red')}>
        {signedDelta(entry.delta)}
      </span>
    </button>
  )
}
