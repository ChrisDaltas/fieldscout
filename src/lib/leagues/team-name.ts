/**
 * Team names — ONE rule for the whole app (Chris, 2026-10-18: "team names
 * ≤ 24 everywhere"; spec v2.16.97, migration 196, PROGRESS D545). A fantasy
 * team's name is at most 24 characters, the same on the phone, on desktop
 * and on the server:
 *
 *  - every Zod schema that takes a team name (`team-rename-service`,
 *    `commish-team-service`, `leagues-service`'s optional `team_name`,
 *    `members-service`'s placeholder-seat `team_name`) parses it with
 *    `teamNameSchema`;
 *  - every team-name input caps at `TEAM_NAME_MAX` (`maxLength`), so a name
 *    that is too long cannot be typed — the server's refusal is the backstop;
 *  - the database refuses a 25th character on every door that takes a name
 *    (`team_rename_normalize_internal`, `create_league`,
 *    `add_placeholder_seat` — 196).
 *
 * A name set before the rule (up to 100 characters) still reads and shows;
 * the limit applies to a name being written.
 *
 * The automatic name a team gets on create or join is the server's
 * (`team_default_name_internal`, 196): "<username>'s Team" where it fits in
 * 24, and the username alone where it would not (usernames of 18–20) — ruled
 * by Chris 2026-10-18, Sleeper's default (PROGRESS §3 Resolved, D545).
 *
 * Counting: JS `length` counts UTF-16 units and Postgres `char_length` counts
 * code points, so this side is never looser than the server (an emoji counts
 * two here, one there). JS `trim()` strips a superset of the server's class.
 *
 * Pure: no time, DOM or fetch.
 */
import { z } from 'zod'

/** The longest team name, everywhere. */
export const TEAM_NAME_MAX = 24

/** Said when a team name runs past the limit — the field error and the
 *  disabled Save's reason alike. */
export const TEAM_NAME_TOO_LONG = `Team names can be up to ${TEAM_NAME_MAX} characters.`

/** A team name on the wire: trimmed, non-empty, at most 24 characters. */
export const teamNameSchema = z.string().trim().min(1).max(TEAM_NAME_MAX, TEAM_NAME_TOO_LONG)
