/**
 * The username contract, in one place.
 *
 * A username is permanent once chosen and is the public identity: it is what
 * /u/{username}/lists/{slug} share links are built from. Getting the wrong one
 * is not recoverable by the user, so every gate that decides "has this account
 * chosen yet?" must agree exactly — this module is that single source.
 *
 * Spec: spec-redraft-leagues v2.8/v2.8.1 (Q4), mirrored by migration 040's
 * profiles_username_format_check.
 */

/** 5–20 chars, letters/numbers/underscores. Case folded on save. */
export const USERNAME_REGEX = /^[a-zA-Z0-9_]{5,20}$/

/**
 * The pre-selection handle assigned by handle_new_user at signup
 * (`user_` + the first 8 hex chars of the account id).
 *
 * Anchored deliberately. A `startsWith('user_')` check — which the auth
 * callback used to do — also matches a legitimately chosen name like
 * `user_bob`, which passes validation and would trap that account in the
 * selection screen forever.
 */
export const PLACEHOLDER_USERNAME_REGEX = /^user_[0-9a-f]{8}$/

/** True when the account has not chosen a username yet. */
export function isPlaceholderUsername(username: string | null | undefined): boolean {
  return !username || PLACEHOLDER_USERNAME_REGEX.test(username)
}

/*
 * Brand and staff handles nobody can claim (migration 215,
 * `username_is_reserved_internal` — the database refuses them; this mirror
 * lets the form say so before anyone presses Continue). The four lists below
 * are read out of the migration by username-contract.test.ts, so the two
 * cannot drift. Someone who already holds one keeps it; only a new claim is
 * refused.
 */
export const RESERVED_USERNAME_BRAND = 'fieldscout'
export const RESERVED_USERNAME_WORDS = [
  'admin', 'admins', 'administrator', 'administrators', 'sysadmin', 'root', 'system',
  'support', 'help', 'helpdesk', 'moderator', 'moderators', 'mod', 'mods', 'staff',
  'official', 'team', 'security', 'abuse', 'legal', 'privacy', 'billing', 'api',
  'www', 'noreply', 'webmaster', 'postmaster',
] as const
export const RESERVED_USERNAME_BEFORE = ['fs', 'the', 'official'] as const
export const RESERVED_USERNAME_AFTER = ['team', 'hq', 'desk', 'official'] as const

const RESERVED_STAFF_REGEX = new RegExp(
  `^(${RESERVED_USERNAME_BEFORE.join('|')})?(${RESERVED_USERNAME_WORDS.join('|')})(${RESERVED_USERNAME_AFTER.join('|')})?$`,
)

/** Look-alike digits read as letters, "1" both ways (Postgres `translate`). */
function lookAlikes(value: string): [string, string] {
  const read = (one: string) =>
    value.replace(/[013457]/g, (d) => ({ '0': 'o', '1': one, '3': 'e', '4': 'a', '5': 's', '7': 't' })[d] ?? d)
  return [read('i'), read('l')]
}

/**
 * True for a brand or staff handle: "fieldscout" anywhere (underscores out,
 * look-alike digits read as letters); a staff word on its own, optionally
 * with fs / the / official in front, team / hq / desk / official behind and a
 * number on the end; or the AI-account shape written with underscores (…_ai).
 */
export function isReservedUsername(value: string): boolean {
  const raw = value.toLowerCase()
  const flat = raw.replace(/_/g, '')
  const bare = flat.replace(/[0-9]+$/, '')
  return (
    lookAlikes(flat).some((v) => v.includes(RESERVED_USERNAME_BRAND)) ||
    lookAlikes(bare).some((v) => RESERVED_STAFF_REGEX.test(v)) ||
    /_ai$/.test(raw)
  )
}

/** Returns a human-readable problem, or null when the value is acceptable. */
export function validateUsername(value: string): string | null {
  if (value.length < 5) return 'Must be at least 5 characters'
  if (value.length > 20) return 'Must be 20 characters or fewer'
  if (!/^[a-zA-Z0-9_]+$/.test(value)) return 'Only letters, numbers, and underscores'
  // Reserved: choosing a placeholder-shaped name would leave the account
  // permanently "pre-selection" — every gate keys on that shape.
  if (PLACEHOLDER_USERNAME_REGEX.test(value.toLowerCase())) {
    return 'This username format is reserved'
  }
  // Brand and staff handles (migration 215 refuses them too).
  if (isReservedUsername(value)) return 'This username is reserved'
  return null
}
