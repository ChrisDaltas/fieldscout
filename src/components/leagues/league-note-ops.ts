/**
 * The commissioner note's UI derivations (gap list #13; migration 192) —
 * shared by League Home on desktop (`league-note-card.tsx`) and the phone's
 * League tab and Menu (`mobile/league/league/league-note.tsx`). Pure: the
 * caller passes `now`.
 */
import { LEAGUE_NOTE_MAX, noteDraft } from '@/lib/leagues/league-note-text'
import type { LeagueNoteView, SetLeagueNoteResult } from '@/lib/leagues/api/league-note-service'

export { LEAGUE_NOTE_MAX }

/** Who may change it: the commissioner and co-commissioners (§4 — same powers). */
export function canEditLeagueNote(myRole: string | null | undefined): boolean {
  return myRole === 'commissioner' || myRole === 'co_commissioner'
}

/** The words for the editor's empty field (an example, not a rule). */
export const LEAGUE_NOTE_HINT = 'Trade deadline is Nov 24. Dues by Friday.'

/** What a commissioner sees where no note is pinned. */
export const LEAGUE_NOTE_EMPTY_COMMISH =
  'Pin a short note for the whole league — the trade deadline, when dues are due. Everyone gets a notification when you change it.'

/** What a member sees in the Menu's note screen when none is pinned. */
export const LEAGUE_NOTE_EMPTY_MEMBER = 'Your commissioner hasn’t pinned a note.'

/** The load failure, said plainly (never an empty "no note"). */
export const LEAGUE_NOTE_ERROR = 'Couldn’t load the commissioner note.'

/** Before the database has notes (migration 192 not pushed yet). */
export const LEAGUE_NOTE_UNAVAILABLE = 'Commissioner notes aren’t switched on yet.'

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** When it was set, in the viewer's day terms: "today", "yesterday",
 *  "Oct 12", or "Oct 12, 2025" for another year. Null without a time. */
export function noteWhen(iso: string | null, now: Date): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  if (dayKey(at) === dayKey(now)) return 'today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(at) === dayKey(yesterday)) return 'yesterday'
  const sameYear = at.getFullYear() === now.getFullYear()
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** The byline's parts: who (a username, linked by the caller) and when. */
export function noteByline(note: NonNullable<LeagueNoteView['note']>, now: Date): { username: string | null; when: string | null } {
  return { username: note.author?.username ?? null, when: noteWhen(note.updated_at, now) }
}

/** The editor's state for a draft against the note it would replace. */
export function noteEditorState(draft: string, current: string | null) {
  const d = noteDraft(draft)
  const unchanged = d.text === (current ?? '')
  return {
    ...d,
    /** "123 / 500" — the counter. */
    counter: `${d.length} / ${LEAGUE_NOTE_MAX}`,
    unchanged,
    /** Save is offered for a real, valid change (a blank draft over a note
     *  clears it — the editor names that action "Clear note"). */
    canSave: !d.tooLong && !unchanged,
    saveLabel: d.clears && current !== null ? 'Clear note' : current === null ? 'Pin note' : 'Save',
  }
}

/** The toast after a save, from the server's own document. */
export function noteSavedToast(result: Pick<SetLeagueNoteResult, 'no_changes' | 'cleared' | 'notified'>): { title: string; description?: string } {
  if (result.no_changes) return { title: 'No changes', description: 'The note already says that.' }
  // A clear is a change too — members are told (192 step 8).
  const n = result.notified
  return {
    title: result.cleared ? 'Note cleared' : 'Note pinned',
    description: n > 0 ? `${n} ${n === 1 ? 'member was' : 'members were'} notified.` : undefined,
  }
}
