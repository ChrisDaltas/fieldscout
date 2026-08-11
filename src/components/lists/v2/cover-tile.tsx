'use client'

import Image from 'next/image'

import { Icon, type IconName } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { List } from '@/types/database'

/**
 * Lists v2 — the cover tile.
 *
 * **This is NOT `ListThumbnail`.** That component renders a 2×2 grid of player
 * headshots tinted by position; the design's cover is a *solid saturated block
 * carrying large initials or a glyph*, with a small category icon in the
 * corner (`screens/cards-gallery.png`, `screens/list-rail-list-view.png`, and
 * PROGRESS §7 gap 2 — reusing `ListThumbnail` here is exactly what got the
 * previous attempt scrapped).
 *
 * ## What is derived, and why
 *
 * The prototype stores `cover: { color, mono, icon }` per list. **We have no
 * such column** and the build's schema budget is closed (plan §1/D6), so every
 * part of the tile is derived from data the list already carries:
 *
 * | Part | Source |
 * | --- | --- |
 * | image | `thumbnail_url` when set — plan §2.2 ("use existing `thumbnail_url` only") |
 * | colour | a stable hash of `list.id` into {@link COVER_PALETTE} |
 * | glyph | initials of the first two words of the title, or `★` / `BB` for the two special lists |
 * | icon | favourites → star, big board → cup, position-filtered → chart, tiered → level, else list |
 *
 * The palette is the prototype's own `covers` array (`lists.js`) read through
 * this app's tokens: accent blue, brand lime, tier-1 pink, QB orange, TE teal,
 * WR purple. Implemented from tokens, never the handoff's literal hex (plan §1).
 *
 * **Known divergence, stated rather than hidden:** the prototype's glyphs are
 * hand-picked (`My 2026 big board` → `BB`, `Week 11 starts` → `11`,
 * `Zero-RB survival kit` → `0R`). No derivation reproduces those, so a title
 * with no special case gets its word initials instead. Giving the user real
 * control over the glyph needs a column, which this build may not add.
 */

interface CoverStyle {
  /** Background utility class. */
  bg: string
  /** Glyph / icon ink — light covers take ink text, saturated ones white. */
  light: boolean
}

/**
 * The prototype's cover colours as this app's tokens, **minus brand lime**.
 *
 * Lime is reserved for Favorites. The design's own rule is that brand green
 * means "look here — static, important" (design LAW, Color), and Favorites is
 * the one permanent list; leaving lime in the hash pool also put three of six
 * gallery covers on the same green, which the reference never does.
 */
export const COVER_PALETTE: readonly CoverStyle[] = [
  { bg: 'bg-accent', light: false },
  { bg: 'bg-tier-1', light: false },
  { bg: 'bg-pos-qb', light: false },
  { bg: 'bg-pos-te', light: false },
  { bg: 'bg-pos-wr', light: false },
]

/**
 * Stable, order-independent index into the palette (FNV-1a, 32-bit).
 *
 * Stable is the point: a list's cover is an identity cue, so it must not change
 * when a *different* list is created or deleted. The cost is collisions — five
 * colours over any number of lists means some will share one, and no hash fixes
 * that. Giving the owner a real colour picker needs a column, which this build's
 * schema budget does not hold.
 */
function hashIndex(seed: string, buckets: number): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % buckets
}

type CoverList = Pick<List, 'id' | 'title' | 'thumbnail_url'> &
  Partial<Pick<List, 'is_favorites' | 'is_big_board' | 'position_filter' | 'ranking_mode'>>

export function coverGlyph(list: CoverList): string {
  if (list.is_favorites) return '★'
  if (list.is_big_board) return 'BB'
  const words = list.title.split(/[^A-Za-z0-9]+/u).filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export function coverIcon(list: CoverList): IconName {
  if (list.is_favorites) return 'star'
  if (list.is_big_board) return 'cup'
  if (list.position_filter) return 'chart'
  if (list.ranking_mode === 'rank_and_tier') return 'level'
  return 'list'
}

export function coverStyle(list: CoverList): CoverStyle {
  if (list.is_favorites) return { bg: 'bg-brand', light: true }
  return COVER_PALETTE[hashIndex(list.id, COVER_PALETTE.length)]
}

interface ListCoverTileProps {
  list: CoverList
  /** Edge length in px. Rail rows use 24, the hero 42. */
  size?: number
  className?: string
}

/** The square tile used by the rail, the hero, and the side-by-side picker. */
export function ListCoverTile({ list, size = 24, className }: ListCoverTileProps) {
  const style = coverStyle(list)
  const glyph = coverGlyph(list)

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm border border-ink',
        list.thumbnail_url ? 'bg-n-4' : style.bg,
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {list.thumbnail_url ? (
        <Image src={list.thumbnail_url} alt="" fill sizes="64px" className="object-cover" />
      ) : (
        <>
          <span
            className={cn(
              'fs-num font-bold tracking-[-0.03em] leading-none',
              style.light ? 'text-ink' : 'text-white',
            )}
            style={{ fontSize: Math.round(size * 0.34) }}
          >
            {glyph}
          </span>
          <Icon
            name={coverIcon(list)}
            size={Math.round(size * 0.26)}
            className={cn(
              'absolute bottom-[2px] right-[2px]',
              style.light ? 'text-ink/45' : 'text-white/55',
            )}
          />
        </>
      )}
    </span>
  )
}

/**
 * The gallery card's cover: a full-bleed colour band with the glyph at display
 * size bottom-left and the category icon top-right (`screens/cards-gallery.png`).
 */
export function ListCoverBand({ list, className }: { list: CoverList; className?: string }) {
  const style = coverStyle(list)

  return (
    <span
      className={cn(
        'relative block h-[93px] overflow-hidden border-b border-ink',
        list.thumbnail_url ? 'bg-n-4' : style.bg,
        className,
      )}
      aria-hidden="true"
    >
      {list.thumbnail_url ? (
        <Image src={list.thumbnail_url} alt="" fill sizes="320px" className="object-cover" />
      ) : (
        <>
          <span
            className={cn(
              'fs-num absolute bottom-[6px] left-[11px] text-[37px] font-bold leading-none tracking-[-0.05em]',
              style.light ? 'text-ink/75' : 'text-white/90',
            )}
          >
            {coverGlyph(list)}
          </span>
          <Icon
            name={coverIcon(list)}
            size={24}
            className={cn(
              'absolute right-[10px] top-[10px]',
              style.light ? 'text-ink/35' : 'text-white/45',
            )}
          />
        </>
      )}
    </span>
  )
}
