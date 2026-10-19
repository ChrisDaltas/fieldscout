import { NFL_TEAMS } from '@/lib/nfl-teams'

/**
 * Player-news matcher (F575; Chris's ruling 2026-10-18; PROGRESS D550).
 * Free, no AI: a story counts for a player only if it names him in full AND
 *   (a) names his team (nickname, city or abbreviation), or
 *   (b) his full name is unique among the active players we hold.
 * Precision beats recall — when in doubt, no match:
 *   - several players share the name and the story names more than one of
 *     their teams → none of them;
 *   - rule (b) never fires when ANOTHER team is named right before his name
 *     ("Jaguars LB Josh Allen"), because our player table holds fantasy
 *     positions only, so a defender namesake would look "unique".
 */

export interface MatchPlayer {
  id: string
  full_name: string
  team: string | null
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

/** Lowercase, strip accents, drop periods/apostrophes ("J.J." → "jj"),
 *  everything else non-alphanumeric → a space. */
export function normalize(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The name as matched: normalized, generational suffix dropped. */
export function nameKey(fullName: string): string {
  const words = normalize(fullName).split(' ').filter(Boolean)
  while (words.length > 2 && SUFFIXES.has(words[words.length - 1])) words.pop()
  return words.join(' ')
}

/** Normalized multi-word tokens that name a team: nickname and "city nickname".
 *  (City alone is checked separately — "New York" / "Los Angeles" are shared.) */
function teamWords(abbr: string): { nick: string; city: string } | null {
  const t = NFL_TEAMS[abbr]
  return t ? { nick: normalize(t.name), city: normalize(t.city) } : null
}

function hasPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false
  return ` ${haystack} `.includes(` ${phrase} `)
}

/** Does the raw text name this team? Abbreviation is matched case-SENSITIVELY
 *  as a whole word on the raw text ("KC", "NYJ"); nickname / city on the
 *  normalized text. */
export function mentionsTeam(raw: string, norm: string, abbr: string): boolean {
  const w = teamWords(abbr)
  if (!w) return false
  if (hasPhrase(norm, w.nick) || hasPhrase(norm, w.city)) return true
  return new RegExp(`(^|[^A-Za-z0-9])${abbr}([^A-Za-z0-9]|$)`).test(raw)
}

/** A team other than `own` named in the few words right before `key`. */
function otherTeamJustBefore(norm: string, key: string, own: string | null): boolean {
  const padded = ` ${norm} `
  let at = padded.indexOf(` ${key} `)
  while (at !== -1) {
    const before = padded.slice(0, at).trim().split(' ').slice(-4).join(' ')
    for (const abbr of Object.keys(NFL_TEAMS)) {
      if (abbr === own) continue
      const w = teamWords(abbr)!
      // "no" / "ne" are English words, never read as an abbreviation here.
      const ab = abbr.toLowerCase()
      if (hasPhrase(before, w.nick) || (ab !== 'no' && ab !== 'ne' && hasPhrase(before, ab))) return true
    }
    at = padded.indexOf(` ${key} `, at + 1)
  }
  return false
}

export interface PlayerIndex {
  byKey: Map<string, MatchPlayer[]>
}

export function buildIndex(players: readonly MatchPlayer[]): PlayerIndex {
  const byKey = new Map<string, MatchPlayer[]>()
  for (const p of players) {
    const key = nameKey(p.full_name)
    if (!key.includes(' ')) continue // a single-word name is never safe
    const list = byKey.get(key) ?? []
    list.push(p)
    byKey.set(key, list)
  }
  return { byKey }
}

export type MatchRule = 'name_team' | 'unique_name'
export interface PlayerMatch {
  player_id: string
  rule: MatchRule
}

/** Every player the text is about, by the ruled rules. */
export function matchPlayers(text: string, index: PlayerIndex): PlayerMatch[] {
  const norm = normalize(text)
  const out: PlayerMatch[] = []
  for (const [key, players] of index.byKey) {
    if (!hasPhrase(norm, key)) continue
    const withTeam = players.filter((p) => p.team && mentionsTeam(text, norm, p.team))
    if (withTeam.length === 1) {
      out.push({ player_id: withTeam[0].id, rule: 'name_team' })
    } else if (withTeam.length === 0 && players.length === 1) {
      const p = players[0]
      if (!otherTeamJustBefore(norm, key, p.team)) out.push({ player_id: p.id, rule: 'unique_name' })
    }
    // withTeam.length > 1, or a shared name with no team → ambiguous → none.
  }
  return out
}
