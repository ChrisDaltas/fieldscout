/**
 * The team page's commissioner tools + both rename arms — M6A L.E1.13 items
 * 1, 2, 3b (tasks-M6A §6; PROGRESS §3 STANDING RULE (h); F343, F344; Q66).
 * The pure decisions (`team-commish-ops.ts`) and a REAL static render per
 * state of `TeamCommishToolsView` / `TeamRenameView` — the L.E1.12 shape: a
 * static render runs no mutation, so every branch of a result document is a
 * render, not a mock of one. The PAGE-level gating (who sees which arm, and
 * that the tools exist only inside override mode) is pinned in
 * `team-page.render.test.ts`, over the real page.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'

import {
  ADD_NO_MATCH_COPY,
  ADD_RESULT_LIMIT,
  ADD_SEARCH_HINT,
  ROSTER_SAVED_COPY,
  TEAM_TOOLS_EMPTY_ROSTER_COPY,
  addCandidates,
  renameArm,
  renameGate,
  renameOutcome,
  rosterBypassedCopy,
  rosterOutcome,
} from './team-commish-ops'
import { TeamCommishToolsView, TeamRenameView, type AddCandidatesState } from './team-commish-tools'

const unescapeHtml = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

function player(id: string, name: string): RosterPlayer {
  return {
    player_id: id,
    full_name: name,
    position: 'RB',
    nfl_team: 'KC',
    status: 'Active',
    bye_week: null,
    slot_key: 'bn',
    acquisition_type: 'draft',
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
  }
}

const ROSTER = [player('p1', 'Alpha Back'), player('p2', 'Bravo Back')]
const OTHERS = [{ id: 't2', name: 'Other Team' }]
const noop = () => {}

type ViewProps = Parameters<typeof TeamCommishToolsView>[0]
function renderTools(over: Partial<ViewProps> = {}): string {
  const props: ViewProps = {
    teamName: 'Render Team',
    roster: ROSTER,
    otherTeams: OTHERS,
    pending: false,
    outcome: null,
    refusal: null,
    search: '',
    onSearch: noop,
    candidates: { state: 'idle' },
    onMove: noop,
    onDrop: noop,
    onAdd: noop,
    ...over,
  }
  return unescapeHtml(renderToStaticMarkup(createElement(TeamCommishToolsView, props)))
}

const SAVED = { no_changes: false, no_changes_why: null, score_stale: false, score_stale_reason: null, bypassed: [] as string[] }

// ---------------------------------------------------------------------------
// ops
// ---------------------------------------------------------------------------

describe('rosterOutcome — never a bare "Saved." (§4 rule 15 / R971)', () => {
  it('no_changes is its own branch, says WHY in 127’s words, and NEVER says "saved"', () => {
    const said = rosterOutcome({ ...SAVED, no_changes: true, no_changes_why: 'already_on_roster — the player is already on this team' })
    expect(said.branch).toBe('no_changes')
    expect(said.tone).toBe('neutral')
    expect(said.text).toContain('already_on_roster')
    expect(said.text).toContain('nothing was recorded')
    expect(said.text).not.toMatch(/saved/i)
  })

  it('score_stale comes FIRST among the success arms and carries 127’s reason — it is never swallowed by a plain "Saved"', () => {
    const said = rosterOutcome({ ...SAVED, score_stale: true, score_stale_reason: 'stats_unstamped — the evicted starter has no stat row to re-score from' })
    expect(said.branch).toBe('score_not_followed')
    expect(said.tone).toBe('caution')
    expect(said.text).toContain('has NOT caught up')
    expect(said.text).toContain('stats_unstamped')
  })

  it('a clean save says what happened and that it was recorded and posted', () => {
    expect(rosterOutcome(SAVED)).toEqual({ branch: 'saved', tone: 'positive', text: ROSTER_SAVED_COPY })
  })
})

describe('rosterBypassedCopy — bypassed[] rendered back in words (item 1)', () => {
  it('counts the game-day lock PER PLAYER: "walked past the game-day lock for 2 players"', () => {
    expect(rosterBypassedCopy(['e32_drop_lock:p1', 'e32_add_lock:p9'])).toBe('This move walked past the game-day lock for 2 players.')
    expect(rosterBypassedCopy(['e32_drop_lock:p1'])).toBe('This move walked past the game-day lock for 1 player.')
  })

  it('names the waiver period and both acquisition limits, and prints a name it does not know AS IS — a bypass is never dropped', () => {
    const copy = rosterBypassedCopy(['waiver_period:p9', 'acquisitions_per_week', 'acquisitions_per_season', 'some_future_gate'])!
    expect(copy).toContain('the waiver period')
    expect(copy).toContain('the weekly acquisition limit')
    expect(copy).toContain('the season acquisition limit')
    expect(copy).toContain('some_future_gate')
  })

  it('is null when the move walked past nothing', () => {
    expect(rosterBypassedCopy([])).toBeNull()
    expect(rosterBypassedCopy(null)).toBeNull()
  })
})

describe('renameArm — the manager’s arm is NOT inside override mode; the commissioner’s IS (item 2, rule (h))', () => {
  it('a manager on his own team: the manager’s arm, mode or no mode', () => {
    expect(renameArm({ isCommish: false, isOwnTeam: true, overrideMode: false })).toBe('manager')
  })
  it('a manager on someone else’s team: nothing', () => {
    expect(renameArm({ isCommish: false, isOwnTeam: false, overrideMode: false })).toBeNull()
  })
  it('a commissioner on ANOTHER team: nothing outside the mode, the audited arm inside it', () => {
    expect(renameArm({ isCommish: true, isOwnTeam: false, overrideMode: false })).toBeNull()
    expect(renameArm({ isCommish: true, isOwnTeam: false, overrideMode: true })).toBe('commissioner')
  })
  it('a commissioner on HIS OWN team: the manager’s arm outside the mode (no §10.1 power exercised), the audited arm inside it', () => {
    expect(renameArm({ isCommish: true, isOwnTeam: true, overrideMode: false })).toBe('manager')
    expect(renameArm({ isCommish: true, isOwnTeam: true, overrideMode: true })).toBe('commissioner')
  })
})

describe('renameGate / renameOutcome', () => {
  it('why Save is disabled is SAID: blank, and 101 characters; the name sent is the TRIMMED one; an unchanged name is NOT gated here', () => {
    expect(renameGate('   ')).toEqual({ ok: false, why: 'Type a team name to save.' })
    const long = renameGate('x'.repeat(101))
    expect(long.ok).toBe(false)
    expect(!long.ok && long.why).toContain('101')
    expect(renameGate('  New Name ')).toEqual({ ok: true, name: 'New Name' })
  })

  it('no_changes never says "renamed"; a shared name is said FIRST among the success arms; the audited arm says it was recorded and posted, the manager’s does not', () => {
    const noChange = renameOutcome({ no_changes: true, name: 'Same', name_collides_with: [] }, true)
    expect(noChange.branch).toBe('no_changes')
    expect(noChange.text).not.toMatch(/renamed/i)
    const shared = renameOutcome({ no_changes: false, name: 'Dup', name_collides_with: ['t9'] }, true)
    expect(shared.branch).toBe('renamed_name_shared')
    expect(shared.tone).toBe('caution')
    const audited = renameOutcome({ no_changes: false, name: 'New', name_collides_with: [] }, true)
    expect(audited.branch).toBe('renamed')
    expect(audited.text).toContain('recorded and posted to the league')
    const own = renameOutcome({ no_changes: false, name: 'New', name_collides_with: [] }, false)
    expect(own.text).not.toContain('posted')
  })
})

describe('addCandidates — a held player is never offered (one team per player binds the commissioner too)', () => {
  it('filters everyone a roster in this league holds, keeps the window order, and caps the list', () => {
    const window = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, full_name: `Cand ${i}`, position: 'WR', team: 'KC' }))
    const out = addCandidates(window, new Set(['c0', 'c3']))
    expect(out.map((c) => c.id)).toEqual(['c1', 'c2', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'])
    expect(out).toHaveLength(ADD_RESULT_LIMIT)
  })
})

// ---------------------------------------------------------------------------
// renders — the roster tools
// ---------------------------------------------------------------------------

describe('TeamCommishToolsView — a render per state (§16.5.4 + the result document’s branches)', () => {
  it('resting: a Move select + Move + Drop per rostered player, the add search, and NO reason input anywhere (Q66 / F343)', () => {
    const html = renderTools()
    expect(html).toContain('data-team-commish-tools')
    expect(html.match(/data-tools-player=/g)).toHaveLength(2)
    expect(html.match(/data-drop-player/g)).toHaveLength(2)
    expect(html.match(/data-move-player/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Move Alpha Back to"')
    expect(html).toContain('data-add-search')
    expect(html).toContain(ADD_SEARCH_HINT)
    // The ONLY text input is the player search.
    expect(html.match(/<input/g)).toHaveLength(1)
    expect(html).not.toMatch(/reason/i)
    const source = readFileSync(path.resolve(process.cwd(), 'src/components/leagues/team-commish-tools.tsx'), 'utf8')
    expect(source).not.toMatch(/reason:/)
    // ONE switch — the editor's; this file mounts no second one.
    expect(source).not.toMatch(/<OverrideModeBar|override-mode-bar'/)
  })

  it('Move is disabled until a team is picked, and SAYS why (rule (h): no dead button)', () => {
    const html = renderTools()
    const move = html.slice(html.indexOf('data-move-player') - 400, html.indexOf('data-move-player'))
    expect(move).toContain('disabled=""')
    expect(move).toContain('Pick the team to move him to first.')
  })

  it('EMPTY roster: designed copy, and the add arm is still there', () => {
    const html = renderTools({ roster: [] })
    expect(html).toContain('data-empty="commish-roster"')
    expect(html).toContain(TEAM_TOOLS_EMPTY_ROSTER_COPY)
    expect(html).toContain('data-add-search')
  })

  it('PENDING: every control disabled, and "Saving…" said', () => {
    const html = renderTools({ pending: true })
    expect(html).toContain('data-tools-pending')
    expect(html.match(/data-drop-player/g)).toHaveLength(2)
    expect(html).not.toMatch(/<button(?![^>]*disabled="")[^>]*data-drop-player/)
  })

  it('a REFUSAL renders the verb’s sentence VERBATIM (role="alert") and no outcome beside it', () => {
    const refusal = 'commish_force_add_drop: team Render Team is at its roster size (16) — drop a player first; roster size is a legality gate and binds the commissioner too'
    const html = renderTools({ refusal, outcome: SAVED })
    expect(html).toContain(refusal)
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('data-tools-outcome')
  })

  it('SAVED with bypassed[]: the consequence sentence AND the narration — "walked past the game-day lock for 2 players"', () => {
    const html = renderTools({ outcome: { ...SAVED, bypassed: ['e32_drop_lock:p1', 'e32_add_lock:p9'] } })
    expect(html).toContain('data-tools-outcome="saved"')
    expect(html).toContain(ROSTER_SAVED_COPY)
    expect(html).toContain('data-tools-bypassed')
    expect(html).toContain('This move walked past the game-day lock for 2 players.')
  })

  it('SCORE NOT FOLLOWED is rendered — caution, FIRST, with 127’s reason — never a plain "Saved"', () => {
    const html = renderTools({ outcome: { ...SAVED, score_stale: true, score_stale_reason: 'no_stat_row' } })
    expect(html).toContain('data-tools-outcome="score_not_followed"')
    expect(html).toContain('no_stat_row')
    expect(html).not.toContain(ROSTER_SAVED_COPY)
  })

  it('NO CHANGES never says "saved" and renders NO bypass narration (nothing was walked past — nothing happened)', () => {
    const html = renderTools({ outcome: { ...SAVED, no_changes: true, no_changes_why: 'already there', bypassed: ['e32_drop_lock:p1'] } })
    expect(html).toContain('data-tools-outcome="no_changes"')
    expect(html).not.toContain('data-tools-bypassed')
    expect(html).not.toContain(ROSTER_SAVED_COPY)
  })

  it('the ADD picker’s four states: idle hint · loading skeleton · ERROR (named as a failed read, with Retry — never the empty copy) · empty · ready', () => {
    const states: Array<[AddCandidatesState, string, string[]]> = [
      [{ state: 'loading' }, 'data-skeleton="add-candidates"', ['data-empty="add-candidates"', 'data-add-problem']],
      [{ state: 'error', retry: noop }, 'data-add-problem', ['data-empty="add-candidates"', ADD_NO_MATCH_COPY]],
      [{ state: 'ready', players: [] }, ADD_NO_MATCH_COPY, ['data-add-problem']],
      [{ state: 'ready', players: [{ id: 'c1', full_name: 'Free Agent', position: 'WR', team: 'KC' }] }, 'data-add-player="c1"', ['data-add-problem', ADD_NO_MATCH_COPY]],
    ]
    for (const [candidates, has, hasNot] of states) {
      const html = renderTools({ search: 'fre', candidates })
      expect(html, candidates.state).toContain(has)
      for (const absent of hasNot) expect(html, `${candidates.state} ∌ ${absent}`).not.toContain(absent)
    }
    expect(renderTools({ search: 'fre', candidates: { state: 'error', retry: noop } })).toContain('a failed read, not an empty result')
  })

  it('carries no resting shadow and no dark: variant (CLAUDE.md — elevation is a hover affordance; single theme)', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/components/leagues/team-commish-tools.tsx'), 'utf8')
    expect(source).not.toMatch(/shadow-/)
    expect(source).not.toMatch(/\bdark:/)
  })
})

// ---------------------------------------------------------------------------
// renders — rename
// ---------------------------------------------------------------------------

type RenameProps = Parameters<typeof TeamRenameView>[0]
function renderRename(over: Partial<RenameProps> = {}): string {
  const props: RenameProps = {
    arm: 'manager',
    open: true,
    draft: 'Render Team',
    pending: false,
    outcome: null,
    refusal: null,
    onOpen: noop,
    onClose: noop,
    onDraft: noop,
    onSave: noop,
    ...over,
  }
  return unescapeHtml(renderToStaticMarkup(createElement(TeamRenameView, props)))
}

describe('TeamRenameView — one form, two arms', () => {
  it('closed: ONE button naming its arm', () => {
    expect(renderRename({ open: false })).toContain('data-rename-open="manager"')
    expect(renderRename({ open: false, arm: 'commissioner' })).toContain('data-rename-open="commissioner"')
  })

  it('open: a labelled name input, Save, and NO reason input in EITHER arm (Q66) — the commissioner’s label says it is recorded and posted', () => {
    for (const arm of ['manager', 'commissioner'] as const) {
      const html = renderRename({ arm })
      expect(html).toContain(`data-rename-form="${arm}"`)
      expect(html.match(/<input/g)).toHaveLength(1)
      expect(html).not.toMatch(/reason/i)
    }
    expect(renderRename({ arm: 'commissioner' })).toContain('recorded and posted to the league')
    expect(renderRename({ arm: 'manager' })).not.toContain('recorded and posted')
  })

  it('a blank draft disables Save and SAYS why, wired by aria-describedby', () => {
    const html = renderRename({ draft: '  ' })
    expect(html).toContain('data-rename-gate')
    expect(html).toContain('Type a team name to save.')
    expect(html).toMatch(/aria-describedby="[^"]+-gate"/)
    expect(html.slice(html.indexOf('data-rename-save') - 300, html.indexOf('data-rename-save'))).toContain('disabled=""')
  })

  it('a refusal (a RETIRED franchise’s frozen name) renders VERBATIM; an outcome renders by branch; pending says Saving…', () => {
    const refusal = 'franchise x is RETIRED — its name is FROZEN'
    const refused = renderRename({ refusal, outcome: renameOutcome({ no_changes: false, name: 'N', name_collides_with: [] }, false) })
    expect(refused).toContain(refusal)
    expect(refused).toContain('role="alert"')
    expect(refused).not.toContain('data-rename-outcome')
    expect(renderRename({ outcome: renameOutcome({ no_changes: true, name: 'Render Team', name_collides_with: [] }, false) })).toContain('data-rename-outcome="no_changes"')
    expect(renderRename({ outcome: renameOutcome({ no_changes: false, name: 'New', name_collides_with: ['t2'] }, true) })).toContain('data-rename-outcome="renamed_name_shared"')
    expect(renderRename({ pending: true })).toContain('Saving…')
  })
})
