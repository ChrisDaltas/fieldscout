/**
 * Player names inside a sentence the app composed (League UX batch 2): the
 * feed's "added Bijan Robinson (RB · ATL), dropped …" names players it read
 * from the stored payload WITH their ids, so each name can be a door to his
 * card. This splits the sentence at those names — the first occurrence of
 * each, in reading order — and leaves everything else as text. A name the
 * sentence does not contain is simply not linked (never a guess).
 */
export interface NamedPlayer {
  playerId: string
  name: string
}

export type PlayerTextPart = string | NamedPlayer

export function playerParts(text: string, players: readonly NamedPlayer[]): PlayerTextPart[] {
  const hits: Array<{ at: number; player: NamedPlayer }> = []
  const taken: Array<[number, number]> = []
  for (const player of players) {
    if (!player.name) continue
    let from = 0
    for (;;) {
      const at = text.indexOf(player.name, from)
      if (at < 0) break
      const end = at + player.name.length
      if (!taken.some(([a, b]) => at < b && end > a)) {
        hits.push({ at, player })
        taken.push([at, end])
        break
      }
      from = at + 1
    }
  }
  hits.sort((a, b) => a.at - b.at)
  const parts: PlayerTextPart[] = []
  let cursor = 0
  for (const { at, player } of hits) {
    if (at > cursor) parts.push(text.slice(cursor, at))
    parts.push(player)
    cursor = at + player.name.length
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}
