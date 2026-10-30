/**
 * Usernames as doors to profiles — the pure half (M6 L.E1.41; PROGRESS D462).
 *
 * Chris, 2026-09-30: *"Clicking a user name should always take a user to the
 * user profile they clicked on. and user profile names should virtually
 * always be clickable."* A person's public page is `/u/[username]` (spec §3's
 * identity table: "public URLs (`/u/[username]`)"). This file is the ONE
 * spelling of that URL for a person — and of the same profile inside the app
 * (`appProfileHref`, `/app/u/[username]`; the app opens people there,
 * `profileHrefFor`) — and the two ways a username reaches a rendered
 * sentence:
 *
 *  - **Marked names** (`markUsername` / `usernameParts`). A sentence the app
 *    composes itself (the commissioner log's "made jason the manager of
 *    Bravo") wraps each username it interpolates in two private-use
 *    characters, so the renderer knows exactly which words are a person —
 *    never guessing from the text. `plainText` strips the marks for every
 *    reader that wants the words only (a test, a title, an aria-label).
 *    The marks are in-band, so EVERY other string a composer interpolates
 *    (a team name, a player name, a trade summary — free text a manager can
 *    type, and 128's rename only trims and caps it) must pass `stripMarks`
 *    first; otherwise a team named `\uE000victim\uE001` would forge a link
 *    (R1403). `markUsername` strips its own input too.
 *  - **The actor of a stored post** (`splitActorName`). A league post the
 *    database wrote ("Draft paused by chris.", "chris (commissioner) vetoed a
 *    trade: …") names its actor with `draft_actor_name()` — the username —
 *    either after "by " or at the very start. The post's row carries the
 *    actor's id, so the renderer knows WHICH username to look for, and links
 *    only that one occurrence. A post whose text does not name its actor in
 *    either spot (a renamed account's older post, a system notice) stays
 *    plain — never a guessed link.
 */

/** The profile page of a person — `/u/[username]` (spec §3). */
export function userProfileHref(username: string): string {
  return `/u/${encodeURIComponent(username)}`
}

/**
 * The same profile inside the app — `/app/u/[username]`.
 *
 * `/u/[username]` is the public, server-rendered page (SEO, signed-out
 * visitors). Inside the app a person opens here instead, so the app's own
 * frame comes with them:
 *  - **the phone layout, always** (audit profile-1): the public page is the
 *    desktop layout there, with no dock, no Back and no dark mode;
 *  - **the desktop layout, while Community is on** (plan C6): the profile
 *    inside the desktop shell, with Follow and Share, instead of the bare
 *    public page. While Community is off desktop opens the public page, as
 *    before C6, and a desktop visit here is sent there.
 * A signed-out visit here goes to the public page too (middleware — the URL
 * stays shareable).
 */
export function appProfileHref(username: string): string {
  return `/app/u/${encodeURIComponent(username)}`
}

export type PersonFollowsKind = 'followers' | 'following'

/** A person's Followers / Following inside the app (`appProfileHref` + the page). */
export function appFollowsHref(username: string, kind: PersonFollowsKind): string {
  return `${appProfileHref(username)}/${kind}`
}

/**
 * Where a person link goes in a layout (`<html data-layout>`):
 *  - the phone layout → the profile inside the app (`/app/u/…`);
 *  - the desktop layout → the profile inside the app while Community is on
 *    (plan C6), else the public page (`/u/…`, as before C6);
 *  - every page outside the app (no layout attribute; `null` — also the
 *    server and the hydration pass) → the public page.
 */
export function profileHrefFor(
  username: string,
  layout: 'desktop' | 'mobile' | null,
  communityOn: boolean,
): string {
  if (layout === 'mobile') return appProfileHref(username)
  if (layout === 'desktop' && communityOn) return appProfileHref(username)
  return userProfileHref(username)
}

const APP_PERSON_PATH = /^\/app\/u\/([^/]+)(\/followers|\/following)?\/?$/

/**
 * The public page an in-app person path stands for — `/app/u/x[/followers|
 * /following]` → `/u/x[…]` — or `null` for any other path. A signed-out
 * visit goes there instead (middleware), and so does a desktop visit while
 * Community is off.
 */
export function publicPersonPath(pathname: string): string | null {
  const m = APP_PERSON_PATH.exec(pathname)
  return m ? `/u/${m[1]}${m[2] ?? ''}` : null
}

/**
 * A person's public page (`/u/<name>`, or their Followers / Following)
 * opened by someone signed in (plan C6, "Signed-in visitors"): while
 * Community is on, it is handed into the app — the same profile inside the
 * app shell, on either layout (on a phone that is the phone screen
 * `PhoneHandoff` already opened). Returns where to send them, or `null` to
 * keep the public page:
 *  - the person themselves — "View public profile" shows them what a
 *    stranger sees (on a phone `PhoneHandoff` still opens their own phone
 *    screen, as before);
 *  - anyone signed out, and search engines (no session — the page stays
 *    server-rendered);
 *  - everyone while Community is off (then a phone is handed on by
 *    `PhoneHandoff`, as before C6, and desktop stays).
 */
export function personHandoff({
  communityOn,
  viewerId,
  personId,
  username,
  kind = null,
}: {
  communityOn: boolean
  viewerId: string | null
  personId: string
  username: string
  kind?: PersonFollowsKind | null
}): string | null {
  if (!communityOn || !viewerId || viewerId === personId) return null
  return kind ? appFollowsHref(username, kind) : appProfileHref(username)
}

/**
 * Private-use code points (U+E000 / U+E001). A username cannot hold them
 * (spec §3: `[a-z0-9_]`), but a team name, a player name or any other free
 * text CAN — so a composer strips them from everything it interpolates that
 * is not a marked username (`stripMarks`; R1403).
 */
const OPEN = '\uE000'
const CLOSE = '\uE001'
const MARKS = /[\uE000\uE001]/g

/** The text with every mark removed — apply to each non-username string a
 *  composed sentence interpolates, so no free text can forge a person link. */
export function stripMarks(value: string): string {
  return value.replace(MARKS, '')
}

/** Wrap a username interpolated into a composed sentence (see file doc). */
export function markUsername(username: string): string {
  return `${OPEN}${stripMarks(username)}${CLOSE}`
}

export type UsernamePart = string | { username: string }

/** A marked sentence as its text runs and its usernames, in order. */
export function usernameParts(marked: string): UsernamePart[] {
  const parts: UsernamePart[] = []
  let rest = marked
  while (rest.length > 0) {
    const open = rest.indexOf(OPEN)
    const close = open === -1 ? -1 : rest.indexOf(CLOSE, open + 1)
    if (open === -1 || close === -1) {
      parts.push(rest.split(OPEN).join('').split(CLOSE).join(''))
      break
    }
    if (open > 0) parts.push(rest.slice(0, open))
    const username = rest.slice(open + 1, close)
    if (username !== '') parts.push({ username })
    rest = rest.slice(close + 1)
  }
  return parts.filter((part) => part !== '')
}

/** The sentence's words with the marks removed. */
export function plainText(marked: string): string {
  return usernameParts(marked)
    .map((part) => (typeof part === 'string' ? part : part.username))
    .join('')
}

/** A username character (spec §3: `[a-z0-9_]`, and `-` in an `*-ai` handle). */
const NAME_CHAR = /[A-Za-z0-9_-]/

function standsAlone(text: string, start: number, length: number): boolean {
  const before = start === 0 ? '' : text[start - 1]
  const after = text[start + length] ?? ''
  return !NAME_CHAR.test(before) && !NAME_CHAR.test(after)
}

/**
 * Where a stored post names its actor: the first "by <name>" that stands
 * alone, else "<name>" opening the post. `null` when the post names him in
 * neither spot — the caller renders it plain.
 */
export function splitActorName(
  text: string,
  username: string | null | undefined,
): { before: string; username: string; after: string } | null {
  if (!username) return null
  let from = 0
  for (;;) {
    const at = text.indexOf(`by ${username}`, from)
    if (at === -1) break
    const start = at + 3
    if ((at === 0 || !NAME_CHAR.test(text[at - 1])) && standsAlone(text, start, username.length)) {
      return { before: text.slice(0, start), username, after: text.slice(start + username.length) }
    }
    from = at + 1
  }
  if (text.startsWith(username) && standsAlone(text, 0, username.length)) {
    return { before: '', username, after: text.slice(username.length) }
  }
  return null
}
