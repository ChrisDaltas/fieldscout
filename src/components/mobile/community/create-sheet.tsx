'use client'

import { useRouter } from 'next/navigation'

import { CREATE_LIST_HREF, CREATE_RANKING_HREF } from '@/components/mobile/community/community-ops'
import { MIcon, M_ICON } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'

/**
 * Community "Create" sheet (handoff m-composer §2.1 / m-community §2.13):
 * "Create" title, no sub-line and no close button, option rows with a 44px
 * coloured icon tile, label, sub-line and chevron.
 *
 * - **Ranking** opens the new-ranking wizard (`/app/weekly-ranks?new=1`, on
 *   the current week — the handoff's `#new-ranking`). Hidden while weekly
 *   rankings are flagged off (that route redirects home).
 * - **List** opens the mobile New list screen (`/app/lists/new`, step 1 —
 *   the composer's "name your list"). Once its players are saved it comes
 *   back here with "List created" (gap list §3 #8).
 * - **Start or sit** is left out: start/sit questions have no backend, and
 *   the design gives that row no "coming next" state.
 */
interface CreateOption {
  label: string
  sub: string
  path: string
  tile: string
  onSelect: () => void
}

export function CreateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  const options: CreateOption[] = [
    ...(featureFlags.weeklyRanks
      ? [
          {
            label: 'Ranking',
            sub: 'Rank players for a week, rest of season or the draft',
            path: M_ICON.rank,
            tile: 'bg-accent',
            onSelect: () => go(CREATE_RANKING_HREF),
          },
        ]
      : []),
    {
      label: 'List',
      sub: 'Group players for research, targets or stashes',
      path: M_ICON.lists,
      // The handoff's t1 tile turns white (under a white icon) in dark mode;
      // ink keeps it dark in both.
      tile: 'bg-m-ink',
      onSelect: () => go(CREATE_LIST_HREF),
    },
  ]

  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Create">
      <div className="flex flex-col gap-0.5 px-3 pb-[6px]">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={o.onSelect}
            className="flex min-h-16 items-center gap-3 rounded-[14px] p-2 text-left active:bg-m-b2"
          >
            <span className={cn('flex h-11 w-11 flex-none items-center justify-center rounded-[12px] text-white', o.tile)}>
              <svg
                viewBox="0 0 16 16"
                width={20}
                height={20}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={o.path} />
              </svg>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold text-m-t1">{o.label}</span>
              <span className="text-pretty text-[12px] font-medium text-m-t3">{o.sub}</span>
            </span>
            <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
          </button>
        ))}
      </div>
    </MobileSheet>
  )
}
