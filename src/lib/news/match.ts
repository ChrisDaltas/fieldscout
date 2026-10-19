import { NFL_TEAMS } from '@/lib/nfl-teams'

/**
 * Player-news matcher (F575; Chris's ruling 2026-10-18; PROGRESS D550).
 * Free, no AI: a story counts for a player only if it names him in full AND
 *   (a) names his team: the nickname, the abbreviation (case-sensitive whole
 *       word), or the city when only one team has that city ("New York" and
 *       "Los Angeles" count only together with the nickname), or
 *   (b) his full name is unique among the active players we hold.
 * Precision beats recall — when in doubt, no match:
 *   - several players share the name and the story names more than one of
 *     their teams → none of them;
 *   - neither rule fires for a player when ANOTHER team (nickname, unshared
 *     city or abbreviation, possessive included) is named in the four words
 *     right before his name ("Jaguars LB Josh Allen", "Jacksonville's Josh
 *     Allen") — our player table holds fantasy positions only, so a defender
 *     namesake would otherwise look like him (R1591).
 */

export interface MatchPlayer {
  id: string
  full_name: string
  team: string | null
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

/** Lowercase, strip accents, drop possessive 's ("Jacksonville's" →
 *  "jacksonville"), drop periods/apostrophes ("J.J." → "jj"), everything
 *  else non-alphanumeric → a space. */
export function normalize(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
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

const CITY_COUNT = new Map<string, number>()
for (const t of Object.values(NFL_TEAMS)) {
  const c = normalize(t.city)
  CITY_COUNT.set(c, (CITY_COUNT.get(c) ?? 0) + 1)
}

/** Nickname always; the city only when no other team shares it (R1593). */
function teamWords(abbr: string): { nick: string; city: string | null } | null {
  const t = NFL_TEAMS[abbr]
  if (!t) return null
  const city = normalize(t.city)
  return { nick: normalize(t.name), city: (CITY_COUNT.get(city) ?? 0) === 1 ? city : null }
}

function hasPhrase(haystack: string, phrase: string | null): boolean {
  if (!phrase) return false
  return ` ${haystack} `.includes(` ${phrase} `)
}

/** Does the text name this team? Abbreviation case-SENSITIVELY as a whole
 *  word on the raw text ("KC", "NYJ"); nickname / unshared city on the
 *  normalized text. */
export function mentionsTeam(raw: string, norm: string, abbr: string): boolean {
  const w = teamWords(abbr)
  if (!w) return false
  if (hasPhrase(norm, w.nick) || hasPhrase(norm, w.city)) return true
  return new RegExp(`(^|[^A-Za-z0-9])${abbr}([^A-Za-z0-9]|$)`).test(raw)
}

const WORD_ABBRS = new Set(['no', 'ne', 'was', 'ten', 'min', 'car', 'sea', 'den', 'ind'])

/** A team other than `own` named in the four words right before `key`. */
function otherTeamJustBefore(norm: string, key: string, own: string | null): boolean {
  const padded = ` ${norm} `
  let at = padded.indexOf(` ${key} `)
  while (at !== -1) {
    const before = padded.slice(0, at).trim().split(' ').slice(-4).join(' ')
    for (const abbr of Object.keys(NFL_TEAMS)) {
      if (abbr === own) continue
      const w = teamWords(abbr)!
      // Abbreviations that are English words ("was", "no", …) are never read as a team here.
      const ab = abbr.toLowerCase()
      if (hasPhrase(before, w.nick) || hasPhrase(before, w.city) || (!WORD_ABBRS.has(ab) && hasPhrase(before, ab))) return true
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
    // R1591: the namesake guard runs ahead of BOTH rules.
    const eligible = players.filter((p) => !otherTeamJustBefore(norm, key, p.team))
    const withTeam = eligible.filter((p) => p.team && mentionsTeam(text, norm, p.team))
    if (withTeam.length === 1) {
      out.push({ player_id: withTeam[0].id, rule: 'name_team' })
    } else if (withTeam.length === 0 && players.length === 1 && eligible.length === 1) {
      out.push({ player_id: eligible[0].id, rule: 'unique_name' })
    }
    // withTeam.length > 1, a shared name with no team, or a guarded name → none.
  }
  return out
}
