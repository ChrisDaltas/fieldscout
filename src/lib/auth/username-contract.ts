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
  return null
}
