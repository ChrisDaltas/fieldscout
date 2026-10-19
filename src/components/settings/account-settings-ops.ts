/**
 * Account settings — the rules and copy the desktop page and the phone
 * screen share (gap list §4 item 101: the phone draws its own screen on the
 * SAME data and actions; nothing here is layout).
 */

/* ------------------------------- Password ------------------------------- */

/** Supabase's minimum, and the one the page has always asked for. */
export const PASSWORD_MIN = 8
export const PASSWORDS_DIFFER = 'Passwords do not match'
export const PASSWORD_TOO_SHORT = `Password must be at least ${PASSWORD_MIN} characters`

/**
 * Desktop's check when Update password is pressed: the first thing wrong
 * with the pair, or null when it can be saved.
 */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password !== confirm) return PASSWORDS_DIFFER
  if (password.length < PASSWORD_MIN) return PASSWORD_TOO_SHORT
  return null
}

export type PasswordGate = { ok: true } | { ok: false; why: string | null }

/**
 * The phone's live version of the same rule (prevent, don't refuse): Update
 * stays off until the pair can be saved, and `why` says what's missing as
 * you type. Nothing typed, or the new password fine and the second box not
 * started yet, is not an error — `why` is null and the greyed button says
 * enough. A mismatch shows only once the second box has something in it.
 */
export function passwordGate(password: string, confirm: string): PasswordGate {
  if (password === '' && confirm === '') return { ok: false, why: null }
  if (password.length < PASSWORD_MIN) return { ok: false, why: PASSWORD_TOO_SHORT }
  if (confirm === '') return { ok: false, why: null }
  const problem = passwordProblem(password, confirm)
  return problem ? { ok: false, why: problem } : { ok: true }
}

/* ----------------------------- Notifications ---------------------------- */

export interface NotificationRow {
  key: string
  title: string
  description: string
  defaultOn: boolean
}

// TODO(notif-prefs): there is no notification-preferences backend yet — the
// only real notification type today is `list_updated` (lists you follow).
// These switches are local-only state on both layouts (gap list §2,
// "Notification settings"); persist them once a prefs table or profile
// column ships.
export const NOTIFICATION_ROWS: readonly NotificationRow[] = [
  {
    key: 'list_updates',
    title: 'List updates',
    description: 'When a list you follow gets reworked',
    defaultOn: true,
  },
  {
    key: 'trades',
    title: 'Trade offers',
    description: 'When a GM sends or updates a trade',
    defaultOn: true,
  },
  {
    key: 'waivers',
    title: 'Waiver results',
    description: 'Claims processed, players added or dropped',
    defaultOn: true,
  },
  {
    key: 'injuries',
    title: 'Injury news',
    description: 'Status changes for players on your rosters',
    defaultOn: true,
  },
  {
    key: 'draft',
    title: 'Draft reminders',
    description: "Start times, and when you're on the clock",
    defaultOn: true,
  },
  {
    key: 'ai',
    title: 'Scout AI insights',
    description: 'Weekly lineup recommendations',
    defaultOn: false,
  },
]

/** Each switch's opening position. */
export function defaultNotificationPrefs(): Record<string, boolean> {
  return Object.fromEntries(NOTIFICATION_ROWS.map((r) => [r.key, r.defaultOn]))
}

/* ------------------------------- Copy ---------------------------------- */

export const USERNAME_HINT =
  'Usernames are permanent. This is the only name FieldScout shows — on your lists, rankings, and comments.'
export const EMAIL_HINT = 'Used to sign in and recover your account — never shown to other scouts.'

/* -------------------------------- Pro ---------------------------------- */

// Private lists are unlimited for everyone (Chris, 2026-10-15 — Pro rules
// suspended), so they are no longer listed as a Pro perk.
export const PRO_FEATURES: readonly string[] = [
  'Unlimited teams',
  'Rank every position, every week',
  'Leagues — create and join',
  'Custom scoring systems',
]

/** The plan section's words, free and Pro. */
export const PRO_PLAN_COPY = {
  proTitle: "You're on FieldScout Pro",
  proUnlocked: 'Every scouting tool is unlocked.',
  // TODO(stripe): link the Stripe customer portal once billing management
  // ships.
  proBillingSoon: 'Billing management is on the way — invoices and plan changes will live here.',
  freeHeading: 'Go Pro — unlock the full scouting department.',
  freeBody: 'Unlimited teams, every weekly position, leagues, and scoring built your way.',
} as const

/** The Pro account's status line: Stripe's status when there is one. */
export function proStatusLine(subscriptionStatus: string | null | undefined): string {
  return subscriptionStatus ? `Subscription status: ${subscriptionStatus}` : PRO_PLAN_COPY.proUnlocked
}

/** What Upgrade to Pro says while there is no checkout (TODO(stripe)). */
export const CHECKOUT_SOON_TOAST = {
  title: 'Checkout is almost ready',
  description: 'Pro upgrades open soon — your scouting file is safe with us.',
} as const
