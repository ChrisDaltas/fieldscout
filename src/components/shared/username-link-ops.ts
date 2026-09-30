/**
 * Usernames as doors to profiles — the pure half (M6 L.E1.41; PROGRESS D462).
 *
 * Chris, 2026-09-30: *"Clicking a user name should always take a user to the
 * user profile they clicked on. and user profile names should virtually
 * always be clickable."* A person's public page is `/u/[username]` (spec §3's
 * identity table: "public URLs (`/u/[username]`)"). This file is the ONE
 * spelling of that URL for a person, and the two ways a username reaches a
 * rendered sentence:
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
