import { LEAGUE_SETTINGS_DEFAULTS, type RosterSettings } from '@/lib/leagues/settings/league-settings'
import type { LeagueDetail } from '@/hooks/use-league'

/**
 * THE ROOM'S NON-DRAFT CONTEXT, AS AN OBJECT — MP task MP.6c item 2 (spec
 * v2.16 §8.8; D229(5) applied one layer out; tasks-MP §4 rule 12).
 *
 * The draft room needs five things that are not on the `drafts` row: who the
 * seats are, what the roster shape is, which scoring family prices the
 * board's projections, how long the season is, and where its exits go. Until
 * MP.6c the room read all five off `useLeague(leagueId)`, which is why it
 * could not mount without a league.
 *
 * **The rule this file exists to keep true: WHERE THE VALUES COME FROM IS
 * THE MOUNT'S BUSINESS.** `DraftRoom` (the league mount) fills this object
 * from `LeagueDetail`; `MockDraftRoom` (the standalone mount) fills the SAME
 * object from the practice draft itself — seats from the mock's own `teams`
 * rows, roster from MP.2's `config->'roster'`, scoring from
 * `config->>'scoring_system_id'`. **The deferred league-attached mock (§6)
 * is then a THIRD fill site, not a rewrite**, exactly as D229(5) made the
 * launch settings object a fill rather than a lookup.
 *
 * A room that reached for `useLeague` — or for `drafts.config` — inside
 * itself would have broken that rule, which is why neither source appears in
 * `draft-room.tsx` any more.
 */
export interface RoomScope {
  /** The league this draft belongs to, or **NULL for standalone practice**.
   *  Every league-keyed hook in the room takes this value, and the null arm
   *  is the standalone one (the `/api/mocks/[mockId]/…` verbs — MP.6b). */
  leagueId: string | null
  /** Where EVERY state in this room goes when it offers a way out (R340).
   *  A standalone room never says "Back to league" — it has none. */
  exitHref: string
  /** The exit's words. One voice per room (§16.3). */
  exitLabel: string
  /** The seats on the board: the league's teams, or the mock's own
   *  `teams` rows (the human seat + `CPU 1…N-1` — D227(2)/D227(5)). */
  teams: ReadonlyArray<{ id: string; name: string }>
  /** Who is IN the room, as users. **Empty on a standalone mock** and that
   *  is the fact, not a gap: a bot seat has no user (D227), so there are no
   *  member badges, no chat authors and no §8.4 autopick flags to read. */
  members: LeagueDetail['members']
  /** §7.3.2 roster shape — the tracker's slots and the needs lines. */
  roster: RosterSettings
  /** §7.3.3 scoring family SOURCE for the auction table's projection
   *  columns (F117). A league resolves its frozen snapshot first; a
   *  standalone mock has only this id, from `config->>'scoring_system_id'`. */
  scoringSystemId: string | null
  /** Projection horizon for the auction player table. */
  regularSeasonWeeks: number
  /** `league_members.role` for the viewer — NULL standalone: a practice
   *  draft has no commissioner (D110(1)/D226(2)). */
  myRole: string | null
  /** The LEAGUE-ONLY payload, for the league surfaces the room hosts (the
   *  D94 lobby, the §8.7 commissioner panel, the Add-a-draft-list modal).
   *  NULL standalone, and every one of those surfaces is gated on it — they
   *  are league objects, not room objects. */
  league: LeagueDetail | null
}

/** Where a standalone practice room's exits go (MP.5's practice home). */
export const PRACTICE_HOME_HREF = '/app/mocks'

/** FILL SITE 1 — a league's room. Every value is the league's. */
export function scopeFromLeague(leagueId: string, detail: LeagueDetail): RoomScope {
  return {
    leagueId,
    exitHref: `/app/leagues/${leagueId}`,
    exitLabel: 'Back to league',
    teams: detail.teams,
    members: detail.members,
    roster: detail.settings.roster_settings,
    scoringSystemId: detail.league.scoring_system_id,
    regularSeasonWeeks: detail.settings.regular_season_weeks,
    myRole: detail.my_role,
    league: detail,
  }
}

/**
 * FILL SITE 2 — a standalone practice room. Every value comes off the draft
 * itself; nothing is read from a league, because there is none.
 *
 * `regularSeasonWeeks` is the ONE field the practice draft does not store:
 * `mockLaunchSettings` sends `team_count`, `roster_settings` and the §7.3.8
 * `draft` block, and a season length is a season-long rule a practice draft
 * never reads. It therefore takes the contract's own parsed default — the
 * same value the launch dialog's form was seeded with
 * (`initialMockLaunchDraft` → `defaultsForTeamCount`), so the table's
 * projection horizon is the one the launcher actually chose from, not a
 * literal invented here (R508's rule, applied to the second field).
 */
export function scopeFromMock(context: {
  teams: ReadonlyArray<{ id: string; name: string }>
  roster: RosterSettings
  scoringSystemId: string | null
}): RoomScope {
  return {
    leagueId: null,
    exitHref: PRACTICE_HOME_HREF,
    exitLabel: 'Back to practice drafts',
    teams: context.teams,
    members: [],
    roster: context.roster,
    scoringSystemId: context.scoringSystemId,
    regularSeasonWeeks: LEAGUE_SETTINGS_DEFAULTS.regular_season_weeks,
    myRole: null,
    league: null,
  }
}
