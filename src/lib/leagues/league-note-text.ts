/**
 * The commissioner note's text rules (gap list #13; migration 192) — the
 * client mirror of what `commish_set_league_note` stores, so the editor's
 * counter, the Save button and the route's 400 agree with the database:
 *
 *  - trimmed of spaces, tabs and newlines at both ends (192's explicit class
 *    `E' \t\r\n'` — NOT `String.prototype.trim`, which strips more);
 *  - at most 500 characters, counted the way Postgres's `char_length` counts
 *    (code points — an emoji is one, not two UTF-16 units);
 *  - empty after trimming = "clear the note".
 *
 * Pure: no time, DOM or fetch.
 */

/** The longest note a commissioner can pin (192's CHECK and its 22023). */
export const LEAGUE_NOTE_MAX = 500

/** 192's trim: spaces, tabs, carriage returns and newlines, both ends. */
export function trimNote(raw: string): string {
  return raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
}

/** Characters as Postgres counts them (code points). */
export function noteLength(text: string): number {
  return Array.from(text).length
}

/** What a draft becomes on save: its trimmed text, whether that clears the
 *  note, and whether it is within the cap. */
export function noteDraft(raw: string): { text: string; clears: boolean; length: number; tooLong: boolean } {
  const text = trimNote(raw)
  const length = noteLength(text)
  return { text, clears: text === '', length, tooLong: length > LEAGUE_NOTE_MAX }
}
