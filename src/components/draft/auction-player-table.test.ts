import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Source-level pins for the auction player table — M3 task L.C3.3 (spec
 * §16.2 `auction-player-table.tsx`, §16.4's v2.10 player-table callout,
 * §12.24 + C42's display-only ruling, §16.5.4; tasks-M3 C43/D139/D140;
 * PROGRESS D194).
 *
 * The `draft-dock.test.ts` / `auction-room.test.ts` idiom: `jsx:
 * "preserve"` keeps Vite from importing a `.tsx` here, so these pins are
 * structural — what is in the tree, what is ABSENT, and where the numbers
 * come from. The BEHAVIOUR is the ops golden's
 * (`auction-player-table-ops.test.ts`, 69 cases) and this PR's browser
 * pass.
 *
 * Five things this suite exists to stop:
 *   1. **the engine learning to read `draft_dnd_marks`** — C42 ruled the
 *      autopick skip DOWN, and a skip is one join away from existing at
 *      any time. The sweep below enumerates every reader in the repo;
 *      a new one fails here;
 *   2. the C43 gate being bypassed — a hard-coded split header, or a
 *      customizer offering a column that can only render dashes;
 *   3. a derived column growing teeth (a disabled/refused control keyed
 *      off `$/pt`, `Pts/wk` or `auction_value` — the L.C2.1 lesson, where
 *      `auction-budget.ts` deliberately has no production importer that
 *      gates a submit);
 *   4. the table becoming a second nomination WRITER, or opening a
 *      channel of its own (DR.6's one-channel sweep);
 *   5. the panel fork growing a second site, or the snake room losing its
 *      pool.
 */

const DIR = 'src/components/draft'
const TABLE = `${DIR}/auction-player-table.tsx`
const OPS = `${DIR}/auction-player-table-ops.ts`
const ROOM = `${DIR}/draft-room.tsx`
const HOOK = 'src/hooks/use-draft-dnd.ts'
const STORE = 'src/stores/auction-columns-store.ts'
const MIGRATIONS = 'supabase/migrations'

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments removed — every docblock here NAMES the things it
 *  forbids (this file's own header names `draft_dnd_marks` in order to
 *  forbid a reader), and a pin a comment can satisfy pins nothing. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/** SQL with `--` line comments and `/* *\/` blocks removed. */
function sql(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/** Every non-test .ts/.tsx source file under `src/`, relative paths (the
 *  `room-entry.test.ts` sweep helper). */
function sourceFiles(dir = 'src'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(path.resolve(process.cwd(), dir))) {
    const rel = `${dir}/${entry}`
    if (statSync(path.resolve(process.cwd(), rel)).isDirectory()) {
      out.push(...sourceFiles(rel))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    if (/\.test\.(ts|tsx)$/.test(entry) || entry.endsWith('.d.ts')) continue
    out.push(rel)
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. §12.24 / C42 — Do-Not-Draft is DISPLAY-ONLY, enumerated
// ---------------------------------------------------------------------------

describe('C42: the engine never reads draft_dnd_marks (the ruled skip stays declined)', () => {
  it('every SQL reference lives in 083’s DDL — no other migration touches it', () => {
    const hits: Array<[string, number]> = []
    for (const file of readdirSync(path.resolve(process.cwd(), MIGRATIONS)).sort()) {
      if (!file.endsWith('.sql')) continue
      const count = occurrences(sql(`${MIGRATIONS}/${file}`), 'draft_dnd_marks')
      if (count > 0) hits.push([file, count])
    }
    // 083 CREATEs the table, enables RLS, writes the one policy and the
    // one index — and that is the entire SQL surface of the feature.
    // 088's two mentions are COMMENTS (its own "still carries NO
    // broadcast" note) and are stripped above, which is the point.
    expect(hits).toEqual([['083_draft_bids.sql', 4]])
  })

  it('no FUNCTION BODY anywhere in the chain mentions it', () => {
    // The skip would live inside a `$$ … $$` body — `draft_tick`'s resolve
    // chain, `draft_system_nominate_internal`, an autopick helper. Reading
    // the bodies separately means a future migration that adds the join
    // fails here even if it also (correctly) re-states the DDL.
    const offenders: string[] = []
    for (const file of readdirSync(path.resolve(process.cwd(), MIGRATIONS)).sort()) {
      if (!file.endsWith('.sql')) continue
      const bodies = sql(`${MIGRATIONS}/${file}`).split('$$')
      // Odd indices are inside a dollar-quoted body.
      for (let i = 1; i < bodies.length; i += 2) {
        if (bodies[i].includes('draft_dnd_marks')) offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the engine’s TypeScript — service, sim, gate — never names the table', () => {
    for (const rel of sourceFiles('src/lib/leagues')) {
      expect(`${rel}: ${code(rel).includes('draft_dnd_marks')}`).toBe(`${rel}: false`)
    }
  })

  it('the whole of src/ reads it from exactly two dispositioned files', () => {
    const hits: string[] = []
    for (const rel of sourceFiles()) {
      if (code(rel).includes('draft_dnd_marks')) hits.push(rel)
    }
    hits.sort()
    expect(hits).toEqual([
      // The generated types — the table exists, so its Row type does.
      'src/types/database.ts',
      // The ONE reader/writer: the table's own UI hook.
      'src/hooks/use-draft-dnd.ts',
    ].sort())
  })

  it('the marks filter nothing — `filterRows` cannot even see them', () => {
    const ops = code(OPS)
    // The mark is SET by `decorateRows` and READ only by the renderer.
    expect(ops).toContain('dnd: input.dndIds.has(player.id)')
    // …and the filter body — the one place a "hide DND" behaviour would
    // have to live — never names it.
    const body = ops.slice(ops.indexOf('export function filterRows'))
    expect(body.slice(0, body.indexOf('\n}')).includes('dnd')).toBe(false)
    for (const forbidden of ['hideDnd', 'skipDnd', 'excludeDnd', 'dndFilter']) {
      expect(`${forbidden}: ${ops.includes(forbidden) || code(TABLE).includes(forbidden)}`).toBe(
        `${forbidden}: false`,
      )
    }
  })

  it('the toggle is a direct own-row RLS write, not a route (the §12.24 policy’s purpose)', () => {
    const hook = code(HOOK)
    expect(hook).toContain("from('draft_dnd_marks')")
    expect(hook).toContain('.insert({ draft_id: draftId, user_id: userId!, player_id: playerId })')
    expect(hook).toContain('.delete()')
    // No route, and no channel: §9.2's blind-data rule means marks are
    // never broadcast, so freshness is this client's own mutations.
    expect(hook).not.toContain('sendLeagueAction')
    expect(hook).not.toContain('.channel(')
  })
})

// ---------------------------------------------------------------------------
// 2. C43 — the split columns are gated, and the gate is the only door
// ---------------------------------------------------------------------------

describe('C43: nine split columns exist only behind the data gate', () => {
  it('the table renders headers from the GATED catalog, never a literal', () => {
    const table = code(TABLE)
    expect(table).toContain('visibleColumns(new Set(visible), availability)')
    expect(table).toContain('availableColumns(availability)')
    expect(table).toContain('splitGroupAvailability(rows)')
    expect(table).toContain('{column.label}')
    // A hard-coded split header would bypass the gate entirely.
    for (const literal of ['Rushing yards', 'Receiving yards', 'Passing yards', 'Targets']) {
      expect(`${literal}: ${table.includes(`>${literal}<`)}`).toBe(`${literal}: false`)
    }
  })

  it('the customizer offers only what the gate allows', () => {
    // `offerable` IS `availableColumns(availability)`; an option that can
    // only produce a column of dashes is the same lie as the column.
    const table = code(TABLE)
    expect(table).toMatch(/const offerable = useMemo\(\s*\(\) => availableColumns\(availability\)/)
    expect(table).toContain('groups.map(([group, cols])')
    expect(table).not.toContain('AUCTION_COLUMNS.map')
  })

  it('the gate is DATA-driven — no build flag, no env var, no hard-coded false', () => {
    const ops = code(OPS)
    expect(ops).toContain('SPLIT_GROUP_STAT_KEYS[group].every((key) => seen.has(key))')
    for (const flag of ['process.env', 'NEXT_PUBLIC_', 'SPLITS_ENABLED', 'featureFlag']) {
      expect(`${flag}: ${ops.includes(flag)}`).toBe(`${flag}: false`)
    }
  })

  it('the volume keys are the canonical stat namespace (D33), not a new spelling', () => {
    const ops = code(OPS)
    // The keys the projections extension will have to write. They are the
    // spellings `players-spreadsheet.tsx` and `lib/scoring/default.ts`
    // already use for the same three facts — a second vocabulary would
    // leave this gate shut forever while the data sat in the blob.
    for (const key of ['rush_attempts', 'targets', 'pass_attempts']) {
      expect(`${key}: ${ops.includes(`'${key}'`)}`).toBe(`${key}: true`)
    }
    for (const wrong of ['rush_att', 'rec_tgt', 'pass_att', 'carries', 'rushing_attempts']) {
      expect(`${wrong}: ${ops.includes(`'${wrong}'`)}`).toBe(`${wrong}: false`)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. The derived columns decide nothing (§4.7's posture, projections edition)
// ---------------------------------------------------------------------------

describe('display-only: no control is gated on a derived number', () => {
  it('the table never reads a derived value into a disabled/guard expression', () => {
    const table = code(TABLE)
    // The mirrors reach exactly one place — a cell — through
    // `columnValue`. Nothing else may consume them.
    expect(table).toContain('formatColumnValue(columnValue(row, column), column.key)')
    for (const forbidden of [
      'row.dollarsPerPoint',
      'row.pointsPerWeek',
      'row.projectedPoints',
      'row.auction_value',
    ]) {
      expect(`${forbidden}: ${table.includes(forbidden)}`).toBe(`${forbidden}: false`)
    }
  })

  it('the nominate control is gated ONLY on the room’s server-shaped predicate', () => {
    const table = code(TABLE)
    expect(table).toContain('{canNominate && !row.drafted && (')
    expect(table).toContain('disabled={submitting}')
  })

  it('the ops layer computes no budget and imports no money', () => {
    const ops = code(OPS)
    for (const forbidden of ['maxBid', 'auction-budget', 'remaining', 'openSlots']) {
      expect(`${forbidden}: ${ops.includes(forbidden)}`).toBe(`${forbidden}: false`)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. Writes: one nominate path, no channel, optimism only on prep
// ---------------------------------------------------------------------------

describe('the table writes prep and selects a nominee — it never writes a result', () => {
  it('it opens no channel and mints no league route', () => {
    const table = code(TABLE)
    expect(table).not.toContain('.channel(')
    expect(table).not.toContain('sendLeagueAction')
    expect(table).not.toContain('useNominate')
    expect(table).not.toContain('usePlaceBid')
  })

  it('Nominate hands the player to the ROOM, which owns the §8.6.2 write', () => {
    const table = code(TABLE)
    expect(table).toContain('onClick={() => onNominate(row.id)}')
    const room = code(ROOM)
    // The room passes its `setNomineeId` selector — the block's composer
    // chooses the opening bid, and `useNominate` (never optimistic —
    // §15.6) is what sends it.
    expect(room).toContain('onNominate={setNomineeId}')
    expect(occurrences(room, '.nominateAsync(')).toBe(1)
  })

  it('Add to Targets goes through the room’s shipped queue handler', () => {
    expect(code(TABLE)).toContain('onClick={() => onQueue(row.id)}')
    expect(code(ROOM)).toContain('onQueue={handleQueue}')
  })
})

// ---------------------------------------------------------------------------
// 5. The host: the dock's Players panel, one fork, the snake room intact
// ---------------------------------------------------------------------------

describe('the table is the dock’s Players panel in an auction, and only there', () => {
  it('§16.2’s file exists under its printed name', () => {
    expect(existsSync(path.resolve(process.cwd(), TABLE))).toBe(true)
  })

  it('exactly ONE mount, in the room, on the auction branch', () => {
    const room = code(ROOM)
    expect(occurrences(room, '<AuctionPlayerTable')).toBe(1)
    expect(room).toContain('const playersCard = isAuction ? (')
    expect(room).toContain('players: playersCard,')
    // …and nothing else in the draft dir mounts it.
    for (const file of readdirSync(path.resolve(process.cwd(), DIR))) {
      if (file.includes('.test.') || file === 'draft-room.tsx') continue
      expect(`${file}: ${read(`${DIR}/${file}`).includes('<AuctionPlayerTable')}`).toBe(
        `${file}: false`,
      )
    }
  })

  it('the snake room keeps AvailablePlayers, still one component with two verbs', () => {
    const room = code(ROOM)
    expect(occurrences(room, '<AvailablePlayers')).toBe(1)
    expect(room).toContain("primaryActionLabel={isAuction ? 'Nominate' : undefined}")
    expect(room).toContain(') : (\n    poolCard\n  )')
  })

  it('it does NOT re-parent into the board zone — the block keeps centre stage', () => {
    const room = code(ROOM)
    // The auction board zone renders `auctionCard` and nothing else.
    expect(occurrences(room, '{auctionCard}')).toBe(1)
    expect(code(TABLE)).not.toContain('AuctionBlock')
  })

  it('the §8.9 overlay survives the re-parenting (no L.B4.2 regression)', () => {
    const table = code(TABLE)
    expect(table).toContain('useLeagueListPlayers(overlay?.listId)')
    expect(table).toContain('Only this list')
    expect(code(ROOM)).toContain('onClearOverlay={() => setOverlay(null)}')
  })
})

// ---------------------------------------------------------------------------
// 6. Copy, states, and the house style rules
// ---------------------------------------------------------------------------

describe('§16.5.4 states, D140 vocabulary, and the design rules', () => {
  it('carries all three required states for a data surface', () => {
    const table = code(TABLE)
    expect(table).toContain('<Skeleton') // skeleton-loading
    expect(table).toContain('role="alert"') // error…
    expect(table).toContain('>\n            Retry\n          </Button>') // …with retry
    expect(table).toContain('EMPTY_COPY[') // designed empty copy, per reason
  })

  it('a disabled by-id read is not "pending forever" (the R283 gate, restated)', () => {
    const table = code(TABLE)
    expect(table).toContain('extras.isPending && extraIds.length > 0')
    expect(table).toContain('extras.isError && extraIds.length > 0')
  })

  it('says Targets, never queue (D140’s ruled sweep)', () => {
    const table = read(TABLE)
    expect(table).toContain('Add to Targets')
    expect(table).toContain('In Targets')
    for (const forbidden of ['Add to queue', 'Queued', 'your queue', 'to your queue']) {
      expect(`${forbidden}: ${table.includes(forbidden)}`).toBe(`${forbidden}: false`)
    }
  })

  it('no resting elevation, no dark: variants, no arbitrary shadow', () => {
    const table = read(TABLE)
    expect(table).not.toMatch(/(?<!hover:|active:|group-hover:|focus-visible:)shadow-hard/)
    expect(table).not.toContain('dark:')
    expect(table).not.toMatch(/shadow-\[/)
  })

  it('state is fill/border and a WORD, never colour alone (§16.3)', () => {
    const table = read(TABLE)
    // A marked row carries the letters "DND"; a drafted row carries its
    // price. Neither is announced by colour on its own.
    expect(table).toContain('>\n                DND\n              </span>')
    expect(table).toContain('aria-pressed={row.dnd}')
    expect(table).toContain('aria-expanded={expanded}')
  })
})

// ---------------------------------------------------------------------------
// 7. Column state: persisted, but never server-rendered
// ---------------------------------------------------------------------------

describe('the column store persists, and cannot hydrate-mismatch', () => {
  it('persists under its own key with the reducer left in the ops layer', () => {
    const store = code(STORE)
    expect(store).toContain("name: AUCTION_COLUMNS_STORAGE_KEY")
    expect(store).toContain('createJSONStorage(() => localStorage)')
    expect(store).toContain('columnsReducer(state.visible, { type: \'toggle\', column })')
    expect(store).toContain("columnsReducer([], { type: 'reset' })")
  })

  it('its only consumer is the table, which the dock mounts on a CLICK', () => {
    const consumers = sourceFiles().filter((rel) =>
      code(rel).includes('useAuctionColumnsStore'),
    )
    expect(consumers.sort()).toEqual([STORE, TABLE].sort())
    // The dock's default state is CLOSED and only a click opens it, so
    // nothing this store feeds is ever part of a server render.
    expect(code(`${DIR}/draft-dock-ops.ts`)).toContain(
      'export type DockState = DockTabId | null',
    )
    expect(code(`${DIR}/draft-dock.tsx`)).toContain('useState<DockState>(null)')
    expect(code(`${DIR}/draft-dock.tsx`)).toContain('{openTab && (')
  })
})
