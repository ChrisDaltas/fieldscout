import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * DR.6 source pins — the two-tabs guard's structural contract (tasks-DR
 * D156; spec §9.3 v2.12; RULED: "The most recent one takes over and the
 * others disconnect").
 *
 * Three claims are load-bearing enough to pin at the source:
 *
 *   1. **The guard adds no transport.** D156: "adds no channel, no route,
 *      no server state" — and per-profile scope is BY CONSTRUCTION, because
 *      the hook's only buses (`BroadcastChannel`, `localStorage`) are
 *      same-origin, same-profile transports. A laptop and a phone are two
 *      legitimate clients (DR.6 item 5); the moment this file grows a
 *      fetch, a supabase client or a realtime channel, that scoping claim
 *      is dead — so their absence is pinned.
 *   2. **§9.3's budget stays exactly ONE realtime channel in src/.** The
 *      tasks-DR §1 survey line ("the only `.channel(` call in `src/`
 *      outside tests") becomes a sweep pin here: DR.6 is the lane's channel
 *      task, and the guard must only ever RELEASE a subscription.
 *   3. **Release rides the EXISTING cleanups, through the gate.** The room
 *      withholds the draft id from `useDraftRoom` while released;
 *      `use-draft.ts`'s channel effect bails (`!draftId`) so its cleanup's
 *      `removeChannel` has run, and the heartbeat effect bails
 *      (`!draftId || !heartbeatActive`) so its `clearInterval` has run.
 *      Bypassing the gate (feeding the raw `draftId` in) would render the
 *      takeover state while the released tab KEPT its socket, its
 *      subscription, its heartbeat and its doubled presence entry — the
 *      recorded break probe (probe B) is exactly that bypass, and the gate
 *      pin below is what catches it.
 */

const GUARD = 'src/components/draft/use-single-room-tab.ts'
const ROOM = 'src/components/draft/draft-room.tsx'
const SPINE = 'src/hooks/use-draft.ts'
/** M4/L.D4.2: the second topic's spine — `league:<id>` (see the budget pin). */
const LEAGUE_SPINE = 'src/hooks/use-league-channel.ts'

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

/** Source with comments removed — doctrine comments DISCUSS channels and
 *  releases at length; a pin prose can satisfy pins nothing. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/** Every non-test .ts/.tsx source file under src/, relative paths. */
function sourceFiles(dir = 'src'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(path.resolve(process.cwd(), dir))) {
    const rel = `${dir}/${entry}`
    const abs = path.resolve(process.cwd(), rel)
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(rel))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    if (/\.test\.(ts|tsx)$/.test(entry) || entry.endsWith('.d.ts')) continue
    out.push(rel)
  }
  return out
}

describe('the guard adds no transport (D156 — per browser profile by construction)', () => {
  it('use-single-room-tab.ts opens no channel, no client, no request', () => {
    const source = code(GUARD)
    expect(source).not.toContain('.channel(')
    expect(source).not.toContain('createBrowserClient')
    expect(source).not.toContain('supabase')
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('WebSocket')
  })

  it('its only buses are the two profile-local ones, sharing ONE draft-scoped key', () => {
    const source = code(GUARD)
    // BroadcastChannel and the localStorage fallback are same-origin,
    // same-profile transports — the per-profile scoping IS this.
    expect(source).toContain('new BroadcastChannel(key)')
    expect(source).toContain('window.localStorage.setItem(key,')
    expect(source).toContain('window.addEventListener(\'storage\', onStorage)')
  })
})

describe("§9.3's channel budget — exactly ONE realtime channel PER TOPIC in src/", () => {
  it('the only .channel( calls outside tests are the two spines, one each', () => {
    const hits: Array<[string, number]> = []
    for (const rel of sourceFiles()) {
      const count = (code(rel).match(/\.channel\(/g) ?? []).length
      if (count > 0) hits.push([rel, count])
    }
    // The tasks-DR §1 survey line, now a pin: DR.6 releases a subscription
    // and opens none — a second hit here is a §9.3 budget event that needs
    // its own review, whoever adds it.
    //
    // **That review happened (M4/L.D4.2, PROGRESS D310(3)).** The in-season
    // surfaces need live freshness (D298 chose the broadcast lane for
    // matchups, standings, activity and lock state); the draft spine's topic
    // is `draft:<id>` and cannot carry `league:<id>` events. So the budget
    // becomes ONE CHANNEL PER TOPIC, which is what §9.3's "≤ 3 channels per
    // socket" was always about — a league page holds one, a draft room holds
    // one, and neither ever opens a second for the same topic. The rule that
    // did NOT change: a consumer never opens its own channel. Both league
    // spine and draft spine multiplex every event of their topic (D109(1)),
    // and `use-league-channel-ops.test.ts` pins the league half.
    expect(hits.sort()).toEqual([[LEAGUE_SPINE, 1], [SPINE, 1]].sort())
  })

  it("088/L.C1.6: the auction's draft_bids event rides the SAME channel — subscribed via `ch.on(...)` on the one channel the spine opens, never a second `.channel(`", () => {
    // The budget pin above would catch a second `.channel(`; this one pins
    // the positive half: the auction event is multiplexed onto the existing
    // topic (D109(1); 088 banner item 6), and the feed's query is invalidated
    // on every confirmed join like chat (its missed-event recovery).
    const source = code(SPINE)
    expect(source).toContain("ch.on('broadcast', { event: 'draft_bids' }")
    expect(source).toContain('queryClient.invalidateQueries({ queryKey: draftBidKeys.feed(draftId) })')
    // And the feed hook itself opens no channel of its own.
    expect(code('src/hooks/use-draft-bids.ts')).not.toContain('.channel(')
  })
})

describe('release rides the existing cleanups, through the gate (DR.6 contract 1)', () => {
  it('draft-room feeds the channel-owning hook ONLY through the released gate', () => {
    const source = code(ROOM)
    expect(source).toMatch(
      /const heldDraftId = guard\.role === 'released' \? undefined : draftId/,
    )
    expect(source).toMatch(/useDraftRoom\(heldDraftId,/)
    // The bypass probe B reintroduces exactly this:
    expect(source).not.toMatch(/useDraftRoom\(draftId/)
  })

  it('the released branch renders the takeover state before any other arm', () => {
    // MP.6c moved the room's resolution states into `DraftRoomResolved`, the
    // spine both mounts share (the league one and the standalone practice
    // one). The guard lives there, WITH the hook it withholds the id from,
    // so the property is measured inside the spine: released is answered
    // before the room query's own pending/error/not-found arms, which would
    // otherwise misread an idle query as loading.
    const source = code(ROOM)
    const gate = source.indexOf("if (guard.role === 'released')")
    const skeleton = source.indexOf('room.isPending')
    expect(gate, 'released branch exists').toBeGreaterThan(-1)
    expect(source).toContain('<DraftRoomTakenOver')
    expect(skeleton, 'skeleton arm exists').toBeGreaterThan(-1)
    expect(gate).toBeLessThan(skeleton)
  })

  it('use-draft.ts still tears down BOTH halves when the id is withheld', () => {
    // §4.5 forbids changing these semantics; the guard DEPENDS on them, so
    // they are pinned from the consumer side: no draft id ⇒ the channel
    // effect bails (its cleanup ran removeChannel) and the heartbeat effect
    // bails (its cleanup ran clearInterval).
    const source = code(SPINE)
    expect(source).toContain('if (!draftId || !fetched) return')
    expect(source).toContain('void supabase.removeChannel(channel)')
    expect(source).toContain('if (!draftId || !heartbeatActive) return')
    expect(source).toContain('clearInterval(id)')
  })
})
