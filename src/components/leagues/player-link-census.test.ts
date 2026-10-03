/**
 * THE PLAYER-NAME CENSUS — League UX batch 2 (Chris 2026-10-03: every player
 * mention opens the player card). Mirrors L.E1.41's username census
 * (`username-link.render.test.ts`), and says exactly what it catches:
 *
 * A source line in `src/components/leagues/*.tsx` or `src/components/draft/*.tsx`
 * that renders a player-name field (`full_name`, `playerName`, `player_name`,
 * `add_player_name`, `drop_player_name`) as a JSX expression — `{x.full_name}`,
 * `{player ? abbreviateName(player.full_name) : id}` — on a line WITHOUT a
 * `PlayerLink`, must be on the list below with the reason it is not a door,
 * pinned to its exact count per file. It does NOT catch an attribute
 * (`aria-label={`…${name}`}` — not visible text), a name held under another
 * field name (`g.name`, `d.name` — covered by the trade / feed render
 * proofs), or a name inside a template string nested in a conditional; those
 * are covered by the surface proofs and by review.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const DIRS = ['src/components/leagues', 'src/components/draft']
const RAW_NAME = /(^|[^=\w$(])\{[^{}]*\b(full_name|playerName|player_name|add_player_name|drop_player_name)\b(?!\s*:)[^{}]*\}/

/** file → [count, why it is not a door]. */
const ALLOWED: Record<string, [number, string]> = {
  'src/components/leagues/claim-dialog.tsx': [3, 'the claim dialog’s subject, its result sentence, and a drop <option> — inside a modal form; the row that opened it is the door'],
  'src/components/leagues/drop-player-dialog.tsx': [1, 'the confirmation’s own title — the name it is asking about'],
  'src/components/leagues/lineup-editor.tsx': [1, 'the drag ghost — it follows the pointer and cannot be clicked'],
  'src/components/leagues/players-page.tsx': [2, 'the move form’s echo of the picked add, and a drop <option> — the table row above is the door'],
  'src/components/leagues/trade-center.tsx': [1, 'the commissioner’s outcome sentence, composed from the server’s answer'],
  'src/components/draft/auction-player-table.tsx': [1, 'already a button that opens the card (onOpenPlayer)'],
  'src/components/draft/draft-queue-card.tsx': [2, 'the avatar initials, and a name that is already a button opening the card'],
  'src/components/draft/commish-draft-panel.tsx': [3, 'the commissioner’s pick editor: a board pick and a search result are buttons that SELECT the pick to edit, and the edit dialog’s sentence'],
}

function census(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const dir of DIRS) {
    for (const file of readdirSync(path.join(process.cwd(), dir))) {
      if (!file.endsWith('.tsx') || file.includes('.test.')) continue
      const rel = `${dir}/${file}`
      const lines = readFileSync(path.join(process.cwd(), rel), 'utf8').split('\n')
      const hits = lines.filter((line) => RAW_NAME.test(line) && !line.includes('PlayerLink') && !/^\s*(\/\/|\*)/.test(line)).length
      if (hits > 0) out[rel] = hits
    }
  }
  return out
}

describe('every league and draft player name is a door to his card', () => {
  it('no raw player name renders outside the allow-list, and every entry is pinned to its count', () => {
    const expected = Object.fromEntries(Object.entries(ALLOWED).map(([file, [count]]) => [file, count]))
    expect(census()).toEqual(expected)
  })
  it('the scan catches what it says (probe lines)', () => {
    expect(RAW_NAME.test('<span className="truncate">{player.full_name}</span>')).toBe(true)
    expect(RAW_NAME.test('{player ? abbreviateName(player.full_name) : pick.player_id}')).toBe(true)
    expect(RAW_NAME.test('<span>{card.playerName}</span>')).toBe(true)
    // Not visible text: an attribute, a type annotation.
    expect(RAW_NAME.test('aria-label={`Bench ${player.full_name}`}')).toBe(false)
    expect(RAW_NAME.test('player: { player_id: string; full_name: string }')).toBe(false)
  })
})
