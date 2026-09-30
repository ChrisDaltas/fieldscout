import Link from 'next/link'
import { Fragment } from 'react'

import { cn } from '@/lib/utils'

import { splitActorName, userProfileHref, usernameParts } from './username-link-ops'

interface UsernameLinkProps {
  /** The person's username — the visible text and the profile it opens. */
  username: string
  /** Show the handle as `@username` (a name standing alone — a seat, a
   *  comment's author). `false` inside a sentence the app already words
   *  ("chris made jason the manager of Bravo"). Default true. */
  at?: boolean
  /**
   * Open the profile in a new tab. The live draft room passes this: leaving
   * the room can cost a pick (the reason `InvitePanel` turns its team links
   * off there), so a name in the room opens beside it instead of replacing it.
   */
  newTab?: boolean
  /** The call site's typography and layout only — the primitive adds the
   *  link treatment and no colour or weight, so it drops into an existing
   *  name element without moving anything (`TeamNameLink`'s rule). */
  className?: string
}

/**
 * A username as a door to that person's profile (M6 L.E1.41; PROGRESS D462 —
 * Chris 2026-09-30: *"Clicking a user name should always take a user to the
 * user profile they clicked on."*). The ONE person link in the app: every
 * rendered username that is not inside a text input, a toast, or another
 * link's hit area goes through here, so the URL has one spelling
 * (`userProfileHref`).
 *
 * The treatment is the house inline-link convention (`TeamNameLink`,
 * `list-comments-tab.tsx`): the underline is reserved at rest with
 * `decoration-transparent` and painted on hover — a paint-only change that
 * cannot reflow a narrow row. No shadow: this is text in normal page flow
 * (CLAUDE.md — elevation is a hover state for things that float).
 */
export function UsernameLink({ username, at = true, newTab = false, className }: UsernameLinkProps) {
  return (
    <Link
      href={userProfileHref(username)}
      data-username-link={username}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(
        'underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent',
        className,
      )}
    >
      {at ? `@${username}` : username}
    </Link>
  )
}

/** A composed sentence whose usernames were marked (`markUsername`) — each
 *  one a door, the rest plain text. */
export function TextWithUsernames({
  marked,
  newTab,
  linkClassName,
}: {
  marked: string
  newTab?: boolean
  linkClassName?: string
}) {
  return (
    <>
      {usernameParts(marked).map((part, i) =>
        typeof part === 'string' ? (
          <Fragment key={i}>{part}</Fragment>
        ) : (
          <UsernameLink key={i} username={part.username} at={false} newTab={newTab} className={linkClassName} />
        ),
      )}
    </>
  )
}

/** A stored post that names its actor (`splitActorName`) — the actor's name
 *  a door, the rest plain; a post that does not name him stays plain. */
export function TextWithActor({
  text,
  actor,
  newTab,
  linkClassName,
}: {
  text: string
  actor: string | null | undefined
  newTab?: boolean
  linkClassName?: string
}) {
  const split = splitActorName(text, actor)
  if (!split) return <>{text}</>
  return (
    <>
      {split.before}
      <UsernameLink username={split.username} at={false} newTab={newTab} className={linkClassName} />
      {split.after}
    </>
  )
}
