'use client'

import Image from 'next/image'

import {
  ListThumbnail,
  POS_TINTS,
  listThumbnailLabel,
  type ListThumbnailSize,
} from '@/components/lists/list-thumbnail'
import { PlayerAvatarImage } from '@/components/players/player-image'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Icon, type IconName } from '@/components/ui/icon'
import { getTeamColors } from '@/lib/nfl-team-colors'
import { cn } from '@/lib/utils'

import type { ThumbnailPlayer } from '@/hooks/use-lists'
import type { List } from '@/types/database'

/**
 * Lists v2 — the list cover.
 *
 * ## The correction this file exists to carry
 *
 * This module previously rendered a *solid saturated block with a large glyph*
 * (`★`, `BB`, `WR`, `$`) on a colour hashed from `list.id`. That was built from
 * `screens/cards-gallery.png` and `screens/list-rail-list-view.png`, and it was
 * **wrong**: the prototype's glyphs are artefacts of its fake data, not the
 * intended treatment. Chris, 2026-08-11:
 *
 * > *"Regarding the cover images for the lists, we actually had them the way
 * > they were supposed to be before, using the headshots of the players. And
 * > then the background color is dependent on what position group the user
 * > selects for the list. So if it's all players, it'll be the black. But if
 * > it's any of the other positions, then it uses whatever that color is for
 * > that position group — so purple for wide receivers, blue for running backs,
 * > and so on. But then in the gallery view of the lists, because that's a
 * > different sort of shape and size, what we want is the background to be the
 * > color of the position group just like before, and then for the top four
 * > players, instead of putting them into quadrants, we want to put them at
 * > like 24px each stacked on top of each other in the bottom right corner of
 * > the card cover."*
 *
 * So the covers are **player headshots over a position-group fill**, and the
 * screenshots are the *one* thing not to copy here — see the exception note in
 * `docs/design/lists/screens/README.md`.
 *
 * ## Two shapes, one rule
 *
 * | Surface | Shape |
 * | --- | --- |
 * | rail row (24px), hero (51px) | the square {@link ListThumbnail} — position-tinted label quadrant + the first three headshots, exactly as before |
 * | gallery card | a wide colour band with the top four headshots stacked in the bottom-right |
 *
 * Both take their colour from {@link POS_TINTS}, which is `ListThumbnail`'s own
 * map, so the small tile and the wide band can never drift apart.
 *
 * An uploaded `thumbnail_url` still wins over both, as it did before.
 */

type CoverList = Pick<List, 'id' | 'title' | 'thumbnail_url'> &
  Partial<Pick<List, 'is_favorites' | 'is_big_board' | 'position_filter' | 'ranking_mode'>>

/**
 * The list's position-group background class.
 *
 * `position_filter` is the source, per the ruling above — **not** `is_favorites`
 * and not a hash of the id. Favorites carries no position filter, so it lands
 * on ink like any other all-players list; the lime cover in the prototype went
 * with the glyph treatment.
 */
export function coverBg(list: CoverList): string {
  return POS_TINTS[listThumbnailLabel(list.position_filter)].bg
}

export function coverIcon(list: CoverList): IconName {
  if (list.is_favorites) return 'star'
  if (list.is_big_board) return 'cup'
  if (list.position_filter) return 'chart'
  if (list.ranking_mode === 'rank_and_tier') return 'level'
  return 'list'
}

interface ListCoverTileProps {
  list: CoverList
  /** The list's first players, in list order. Only the first three are drawn. */
  players?: ThumbnailPlayer[] | null
  /** Edge length in px. Rail rows use 24, the hero 51. */
  size?: ListThumbnailSize
  className?: string
}

/** The square tile used by the rail and the hero. */
export function ListCoverTile({ list, players, size = 24, className }: ListCoverTileProps) {
  return (
    <ListThumbnail
      positionFilter={list.position_filter}
      imageUrl={list.thumbnail_url}
      players={players}
      size={size}
      className={className}
    />
  )
}

/** Edge length of one stacked headshot, and how far each tucks under the last. */
const STACK_CHIP = 24
const STACK_OVERLAP = 8

/**
 * The gallery card's cover: a full-bleed position-group band carrying the top
 * four headshots as an overlapping stack in the bottom-right.
 *
 * **The arrangement, and why.** Four 24px squares in a row overlapping by 8px
 * occupy 72px — a quarter of the 214px card, so the cluster reads as a motif in
 * the corner rather than a row of thumbnails filling the band. The stack is
 * **left-on-top** (`z-index` descending with list order): the list's #1 player
 * is whole and every player behind him is progressively occluded, which is the
 * same ordering the list itself asserts. Each chip carries the design's 1px
 * `border-ink` and `rounded-sm`, so the cluster stays in the hard-edged
 * language rather than turning into the round avatar stack of other apps.
 *
 * Under four players it simply draws fewer chips — the corner stays anchored
 * because the stack is right-aligned, so one headshot sits exactly where the
 * fourth would have. With none, a single dashed ghost chip holds the same spot;
 * an empty band would otherwise read as a rendering failure.
 */
export function ListCoverBand({
  list,
  players,
  className,
}: {
  list: CoverList
  players?: ThumbnailPlayer[] | null
  className?: string
}) {
  const top4 = (players ?? []).slice(0, 4)

  return (
    <span
      className={cn(
        'relative block h-[93px] overflow-hidden border-b border-ink',
        list.thumbnail_url ? 'bg-n-4' : coverBg(list),
        className,
      )}
      aria-hidden="true"
    >
      {list.thumbnail_url ? (
        <Image src={list.thumbnail_url} alt="" fill sizes="320px" className="object-cover" />
      ) : (
        <>
          <Icon
            name={coverIcon(list)}
            size={24}
            className="absolute right-[10px] top-[10px] text-white/45"
          />
          <span className="absolute bottom-[8px] right-[10px] flex items-end">
            {top4.length === 0 ? (
              <span
                className="inline-flex items-center justify-center rounded-sm border border-dashed border-white/45 bg-white/10 text-white/60"
                style={{ width: STACK_CHIP, height: STACK_CHIP }}
              >
                <Icon name="plus" size={12} />
              </span>
            ) : (
              top4.map((player, index) => (
                <StackedHeadshot
                  key={player.id}
                  player={player}
                  index={index}
                  total={top4.length}
                />
              ))
            )}
          </span>
        </>
      )}
    </span>
  )
}

function StackedHeadshot({
  player,
  index,
  total,
}: {
  player: ThumbnailPlayer
  index: number
  total: number
}) {
  const { primary } = getTeamColors(player.team)
  const initials = player.full_name
    .split(' ')
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')

  // `Avatar` (a `<span>`, so it stays legal inside this band's span tree) is
  // used for the same reason the rail tile's quadrant uses it: it falls back to
  // initials when the image *fails*, not merely when the URL is absent. Its
  // default chrome already matches this chip — `rounded-sm border border-ink` —
  // so only the fill and the stacking geometry are supplied here.
  return (
    <Avatar
      className="shrink-0"
      style={{
        width: STACK_CHIP,
        height: STACK_CHIP,
        backgroundColor: primary,
        marginLeft: index === 0 ? 0 : -STACK_OVERLAP,
        // Descending, so the earlier player in the list stays on top. Flex
        // siblings would otherwise paint in DOM order and bury #1 under #4.
        zIndex: total - index,
      }}
    >
      <PlayerAvatarImage player={player} draggable={false} />
      <AvatarFallback className="bg-transparent font-mono text-[8px] font-bold uppercase leading-none tracking-tight text-white/90">
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}
