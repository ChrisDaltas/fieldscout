import Link from 'next/link'
import { Heart, Lock } from 'lucide-react'

import { PinListButton } from '@/components/lists/pin-list-button'
import { TagChip } from '@/components/lists/tag-chip'
import { TierBadge } from '@/components/lists/tier-badge'
import { PlayerRow } from '@/components/players/player-row'
import { UserAvatar } from '@/components/ui/user-avatar'
import { Badge } from '@/components/ui/badge'

import type { ListTier } from '@/types/database'

const TIERS: ListTier[] = ['S', 'A', 'B', 'C', 'D', 'F']

interface OwnerInfo {
  id: string
  username: string
  display_name: string | null
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
    <article className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {list.is_big_board && (
            <Badge className="border-bg-elevated-3 bg-bg-elevated-2 text-[10px] font-semibold text-foreground">
              Big Board
            </Badge>
          )}
          {list.position_filter && (
            <Badge
              variant="default"
              className="border-bg-elevated-3 text-[10px] text-text-secondary"
            >
              {list.position_filter}
            </Badge>
          )}
          {list.hide_order && (
            <Badge
              variant="default"
              className="border-bg-elevated-3 text-[10px] text-text-secondary"
            >
              Unranked
            </Badge>
          )}
          {list.tiers_enabled && (
            <Badge
              variant="default"
              className="border-bg-elevated-3 text-[10px] text-text-secondary"
            >
              Tiers
            </Badge>
          )}
          {list.is_private && (
            <Badge
              variant="default"
              className="border-bg-elevated-3 text-[10px] text-text-secondary"
            >
              <Lock className="mr-1 h-3 w-3" /> Private
            </Badge>
          )}
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight">{list.title}</h1>
            {list.description && (
              <p className="mt-1 max-w-2xl text-sm text-text-secondary">
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

        <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
          <Link
            href={`/u/${owner.username}`}
            className="flex items-center gap-2 rounded-full bg-bg-elevated px-3 py-1 transition-colors hover:bg-bg-elevated-2"
          >
            <UserAvatar
              src={owner.avatar_url}
              name={owner.display_name ?? owner.username}
              className="h-6 w-6"
            />
            <span className="text-foreground">
              {owner.display_name ?? `@${owner.username}`}
            </span>
            {owner.is_pro && (
              <span className="rounded-full bg-bg-elevated-2 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                PRO
              </span>
            )}
          </Link>
          <span className="text-xs">
            {list.player_count} player{list.player_count === 1 ? '' : 's'}
          </span>
          <span className="text-xs">·</span>
          <span className="inline-flex items-center gap-1 text-xs">
            <Heart className="h-3 w-3" />
            <span className="tabular-nums">{list.like_count}</span>
          </span>
          <span className="text-xs">·</span>
          <span className="text-xs tabular-nums">
            {list.view_count} view{list.view_count === 1 ? '' : 's'}
          </span>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <TagChip key={tag.id} name={tag.name} slug={tag.slug} />
            ))}
          </div>
        )}
      </header>

      {players.length === 0 ? (
        <p className="rounded-md border border-bg-elevated-2 bg-bg-elevated p-6 text-center text-sm text-text-secondary">
          No players in this list yet.
        </p>
      ) : list.tiers_enabled && !list.hide_order ? (
        <PublicTierView players={players} />
      ) : (
        <ul className="space-y-0.5">
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
          <section key={tier} className="flex gap-3">
            <div className="pt-3">
              <TierBadge tier={tier} />
            </div>
            <ul className="flex-1 space-y-0.5 rounded-md border border-bg-elevated-2 bg-bg-elevated p-1">
              {rows.map((p) => (
                <li key={p.player_id}>
                  <PlayerRow rank={p.position} player={p.player} showRank={false} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
