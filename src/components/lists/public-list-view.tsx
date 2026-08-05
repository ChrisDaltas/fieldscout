import Link from 'next/link'

import { PinListButton } from '@/components/lists/pin-list-button'
import { TagChip } from '@/components/lists/tag-chip'
import { TierBadge, TIER_BAND_BG } from '@/components/lists/tier-badge'
import { PlayerRow } from '@/components/players/player-row'
import { PositionBadge } from '@/components/players/position-badge'
import { UserAvatar } from '@/components/ui/user-avatar'
import { Badge } from '@/components/ui/badge'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

import type { ListTier } from '@/types/database'

const TIERS: ListTier[] = ['S', 'A', 'B', 'C', 'D', 'F']

interface OwnerInfo {
  id: string
  username: string
  avatar_url: string | null
  cred_score: number
  is_pro: boolean
}

interface ListInfo {
  id: string
  title: string
  description: string | null
  position_filter: string | null
  hide_order: boolean
  tiers_enabled: boolean
  is_big_board: boolean
  is_private: boolean
  player_count: number
  like_count: number
  view_count: number
  updated_at: string
  comments_enabled: boolean
}

interface PlayerEntry {
  player_id: string
  position: number
  tier: ListTier | null
  player: {
    id: string
    full_name: string
    position: string
    team: string | null
    headshot_url: string | null
    status: string | null
  }
}

interface TagInfo {
  id: string
  name: string
  slug: string
}

interface PublicListViewProps {
  list: ListInfo
  owner: OwnerInfo
  players: PlayerEntry[]
  tags: TagInfo[]
  /** Show the Pin button — true for any viewer who isn't the owner. */
  canPin: boolean
  signedIn: boolean
  initialPinned: boolean
}

export function PublicListView({
  list,
  owner,
  players,
  tags,
  canPin,
  signedIn,
  initialPinned,
}: PublicListViewProps) {
  return (
    <article className="space-y-5">
      <header className="space-y-3 rounded-sm border border-ink bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-h4">{list.title}</h1>
            {list.description && (
              <p className="mt-1 max-w-2xl text-sm font-medium text-n-3">
                {list.description}
              </p>
            )}
          </div>
          {canPin && (
            <PinListButton
              listId={list.id}
              initialPinned={initialPinned}
              signedIn={signedIn}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {list.hide_order ? (
            <Badge variant="stroke">List</Badge>
          ) : (
            <Badge variant="accent">Ranking</Badge>
          )}
          {list.is_big_board && <Badge variant="black">Big board</Badge>}
          <Badge variant="stroke">
            <span className="fs-num">{list.player_count}</span>&nbsp;player
            {list.player_count === 1 ? '' : 's'}
          </Badge>
          {list.position_filter && (
            <PositionBadge
              position={
                list.position_filter === 'DEF' ? 'DST' : list.position_filter
              }
              size="sm"
            />
          )}
          {tags.map((tag) => (
            <TagChip key={tag.id} name={tag.name} slug={tag.slug} />
          ))}
          <span className="text-[12px] font-semibold text-n-3">
            {list.is_private ? 'Private' : 'Public'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-n-3">
          <Link
            href={`/u/${owner.username}`}
            className="flex items-center gap-2 rounded-sm border border-ink bg-white px-2.5 py-1 text-ink transition-colors hover:bg-n-4"
          >
            <UserAvatar
              src={owner.avatar_url}
              name={owner.username}
              className="h-5 w-5"
            />
            <span className="font-bold">@{owner.username}</span>
            {owner.is_pro && <Badge variant="black">Pro</Badge>}
          </Link>
          <span className="inline-flex items-center gap-1">
            <Icon name="like" size={11} />
            <span className="fs-num">{list.like_count}</span>
          </span>
          <span>·</span>
          <span className="fs-num">
            {list.view_count} view{list.view_count === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      {players.length === 0 ? (
        <div className="rounded-sm border border-ink bg-white px-6 py-12 text-center">
          <h2 className="text-h6">No players yet</h2>
          <p className="mt-1.5 text-sm font-medium text-n-3">
            This list is still empty.
          </p>
        </div>
      ) : list.tiers_enabled && !list.hide_order ? (
        <PublicTierView players={players} />
      ) : (
        <ul className="space-y-0.5 rounded-sm border border-ink bg-white p-1">
          {players.map((p, i) => (
            <li key={p.player_id}>
              <PlayerRow rank={i + 1} player={p.player} density="comfortable" />
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

function PublicTierView({ players }: { players: PlayerEntry[] }) {
  const grouped = new Map<ListTier | 'untiered', PlayerEntry[]>()
  for (const tier of TIERS) grouped.set(tier, [])
  grouped.set('untiered', [])
  for (const p of players) {
    const key = p.tier ?? 'untiered'
    grouped.get(key)!.push(p)
  }

  return (
    <div className="space-y-4">
      {TIERS.map((tier) => {
        const rows = grouped.get(tier) ?? []
        if (rows.length === 0) return null
        return (
          <section
            key={tier}
            className="overflow-hidden rounded-sm border border-ink bg-white"
          >
            <div
              className={cn(
                'flex min-h-[38px] items-center gap-2.5 border-b border-ink px-4 py-1.5',
                TIER_BAND_BG[tier],
              )}
            >
              <TierBadge tier={tier} className="h-6 w-6 border-ink bg-white text-[13px] text-ink" />
              <span className="text-[13px] font-extrabold tracking-wide">
                Tier {tier}
              </span>
              <span className="fs-num ml-auto text-[11px] font-bold opacity-80">
                {rows.length} player{rows.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="space-y-0.5 p-1">
              {rows.map((p) => (
                <li key={p.player_id}>
                  <PlayerRow rank={p.position} player={p.player} showRank={false} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {(grouped.get('untiered') ?? []).length > 0 && (
        <section className="overflow-hidden rounded-sm border border-ink bg-white">
          <div className="flex min-h-[38px] items-center gap-2.5 border-b border-ink bg-n-4 px-4 py-1.5">
            <span className="text-[13px] font-extrabold tracking-wide">
              Untiered
            </span>
            <span className="fs-num ml-auto text-[11px] font-bold opacity-80">
              {(grouped.get('untiered') ?? []).length} player
              {(grouped.get('untiered') ?? []).length === 1 ? '' : 's'}
            </span>
          </div>
          <ul className="space-y-0.5 p-1">
            {(grouped.get('untiered') ?? []).map((p) => (
              <li key={p.player_id}>
                <PlayerRow rank={p.position} player={p.player} showRank={false} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
