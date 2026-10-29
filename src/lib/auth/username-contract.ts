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
 * lets the form say so before anyone presses Continue). The lists below are
 * read out of the migration by username-contract.test.ts, which also runs
 * every example in pgTAP 165's §R through this function, so the two cannot
 * drift. Someone who already holds one keeps it; only a new claim is refused.
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

/*
 * Each letter, and every way of writing it that reads the same at small
 * sizes (o = 0, i = l = 1, e = 3, a = 4, s = 5, t = 7, m = rn, d = cl,
 * w = vv). i and l share one shape: "1" reads as both, so f1e1dscout is the
 * brand. Index-aligned, as in the migration's `letters` / `shapes` arrays.
 */
export const RESERVED_USERNAME_LETTERS = ['o', 'i', 'l', 'e', 'a', 's', 't', 'm', 'd', 'w'] as const
export const RESERVED_USERNAME_SHAPES = [
  '[o0]', '[il1]', '[il1]', '[e3]', '[a4]', '[s5]', '[t7]', '(m|rn)', '(d|cl)', '(w|vv)',
] as const

/** A reserved word as a pattern: each letter replaced by its shape. */
function shape(word: string): string {
  return [...word]
    .map((c) => {
      const i = (RESERVED_USERNAME_LETTERS as readonly string[]).indexOf(c)
      return i === -1 ? c : RESERVED_USERNAME_SHAPES[i]
    })
    .join('')
}

const RESERVED_BRAND_REGEX = new RegExp(shape(RESERVED_USERNAME_BRAND))
const RESERVED_STAFF_REGEX = new RegExp(
  `^(${RESERVED_USERNAME_BEFORE.map(shape).join('|')})?(${RESERVED_USERNAME_WORDS.map(shape).join('|')})(${RESERVED_USERNAME_AFTER.map(shape).join('|')})?[0-9]*$`,
)

/**
 * True for a brand or staff handle, read lower-cased with the underscores
 * taken out and look-alike spellings counted: "fieldscout" anywhere; or a
 * staff word on its own, optionally with fs / the / official in front,
 * team / hq / desk / official behind and a number on the end.
 */
export function isReservedUsername(value: string): boolean {
  const flat = value.toLowerCase().replace(/_/g, '')
  return RESERVED_BRAND_REGEX.test(flat) || RESERVED_STAFF_REGEX.test(flat)
}

/** The two patterns, exposed so the unit test can pin them. */
export const RESERVED_USERNAME_PATTERNS = {
  brand: RESERVED_BRAND_REGEX.source,
  staff: RESERVED_STAFF_REGEX.source,
} as const

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
