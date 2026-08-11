import { NFL_TEAMS } from '@/lib/nfl-teams'

/**
 * The one place that decides which image represents a player.
 *
 * ## Why this exists
 *
 * `players.headshot_url` is written by the Sleeper sync
 * (`src/lib/sports-data/sleeper.ts`, `getSleeperHeadshotUrl`) as
 * `…/content/nfl/players/thumb/<sleeper_id>.jpg`. For team defenses the
 * Sleeper id **is the team abbreviation**, so every DEF row stores
 * `…/thumb/PHI.jpg` — a URL that has never existed. Measured 2026-08-11:
 *
 * | URL | Result |
 * | --- | --- |
 * | `…/content/nfl/players/thumb/PHI.jpg` (what the column holds) | **403** |
 * | `…/images/team_logos/nfl/phi.png` | **200**, 12 KB PNG |
 * | `…/images/team_logos/nfl/PHI.png` | **404** |
 *
 * **The logo path is case-sensitive.** All 32 abbreviations were checked
 * lowercased against the CDN and every one returned 200; uppercase 404s. That
 * asymmetry is the whole reason {@link getTeamLogoUrl} has a test.
 *
 * Ruled by Chris, 2026-08-11: *"for DEF use the team's logo — that's what all
 * platforms do."*
 *
 * ## Resolved at render, never written back
 *
 * `players` is populated by sync scripts only and the app must never write to
 * it (CLAUDE.md, "Player data is read-only"), so the fix cannot be a data
 * repair — it is a substitution made every time an image is drawn. Callers ask
 * this module rather than branching on position themselves, so there is exactly
 * one definition of "the picture for this player".
 *
 * No new dependency: `sleepercdn.com` is already the host every player headshot
 * comes from, and nothing here fetches or scrapes — it composes a URL that an
 * `<img>` loads.
 *
 * ## Rendering
 *
 * This module deliberately returns **URLs only, no class names**: `src/lib/**`
 * is outside Tailwind's `content` globs (`tailwind.config.ts`), so any utility
 * class named only here would be purged and silently do nothing. The
 * object-fit decision therefore lives with the component —
 * `src/components/players/player-image.tsx` — which is inside the scanned tree.
 */

const TEAM_LOGO_BASE = 'https://sleepercdn.com/images/team_logos/nfl'

/**
 * Position values that mean "a team defense". The schema constrains
 * `players.position` to the Sleeper set (which uses `DEF`), but `DST` / `D/ST`
 * are the spellings every other provider uses, so they are accepted rather than
 * silently falling through to the 403-ing headshot.
 */
const DEFENSE_POSITIONS = new Set(['DEF', 'DST', 'D/ST'])

/**
 * The shape this module needs. Deliberately a structural subset of `Player`
 * with every field optional, so `ThumbnailPlayer`, `ListPlayerWithPlayer`'s
 * embedded player, and the various hand-rolled row types all satisfy it
 * without a cast.
 */
export interface PlayerImageSubject {
  id?: string | null
  position?: string | null
  team?: string | null
  headshot_url?: string | null
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/** True when this row is a team defense rather than a person. */
export function isTeamDefense(player: PlayerImageSubject): boolean {
  const position = blankToNull(player.position)
  return position !== null && DEFENSE_POSITIONS.has(position.toUpperCase())
}

/**
 * `PHI` → `https://sleepercdn.com/images/team_logos/nfl/phi.png`.
 *
 * Returns `null` for anything that is not one of the 32 abbreviations in
 * {@link NFL_TEAMS}, so an unknown code degrades to the caller's initials
 * fallback instead of requesting a URL that is known in advance to 404.
 */
export function getTeamLogoUrl(team: string | null | undefined): string | null {
  const abbr = blankToNull(team)?.toUpperCase()
  if (!abbr || !(abbr in NFL_TEAMS)) return null
  return `${TEAM_LOGO_BASE}/${abbr.toLowerCase()}.png`
}

/**
 * The image URL for a player, or `null` when there is nothing to draw.
 *
 * DEF resolves to its team logo, preferring `team` and falling back to `id` —
 * for a team defense the two hold the same abbreviation, but `team` is the
 * field that *means* "which team", and `id` is only equal to it by the
 * accident of Sleeper's keying. Everyone else keeps their stored headshot.
 */
export function getPlayerImageUrl(player: PlayerImageSubject): string | null {
  if (isTeamDefense(player)) {
    return getTeamLogoUrl(blankToNull(player.team) ?? blankToNull(player.id))
  }
  return blankToNull(player.headshot_url)
}
