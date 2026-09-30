/**
 * commish-log-copy.test.ts — TD12's COPY CENSUS (M6 task L.E1.34; spec §10.3,
 * §12.12; PROGRESS D459, F512 / F516 / F518) and the ops cells for the new
 * receipts' words (draft, membership, setup).
 *
 * THE CENSUS fails BY NAME (one `it` per action type, one per setting key) if
 * any `action_type` the database can write, or any league-setting key a
 * settings receipt can name, has no plain words — enumerated from the two
 * sources the task names, never from a hand list:
 *   1. the MIGRATIONS — every literal passed as the action type to the four
 *      receipt seams (`log_commissioner_action_internal`,
 *      `draft_commish_receipt_internal`, `waiver_claim_receipt_internal`,
 *      `trade_receipt_internal`), the THEN / ELSE branches of every
 *      `v_action_type := CASE …` and of an inline CASE argument, and the
 *      `p_op || '_trade'` families crossed with the ops their own file admits;
 *   2. the SPEC — §12.12's `action_type` vocabulary block.
 * Setting keys: `leagueSettingsSchema`'s keys, the retired waiver keys, the
 * keys of 149's `commish_setting_policy` (the single-setting verb's key
 * space) and of 169's `league_settings_doc_internal` (the settings save's).
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CommishLogItem } from '@/lib/leagues/api/commish-log-service'
import { RETIRED_WAIVER_KEYS, leagueSettingsSchema } from '@/lib/leagues/settings/league-settings'

import { commishLogLines } from './activity-feed-ops'
import {
  COMMISH_ACTION_WORDS,
  SETTING_WORDS,
  UNKNOWN_ACTION_WORDS,
  clockWords,
  scoringRuleWords,
  settingValueWords,
} from './commish-log-copy'

const ROOT = process.cwd()
const MIGRATIONS = path.join(ROOT, 'supabase/migrations')
const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
const read = (f: string) => readFileSync(path.join(MIGRATIONS, f), 'utf8')

/** Top-level comma split that respects parentheses and quotes. */
function splitArgs(args: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const ch of args) {
    if (ch === "'") quoted = !quoted
    if (!quoted && ch === '(') depth++
    if (!quoted && ch === ')') depth--
    if (!quoted && ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else current += ch
  }
  parts.push(current.trim())
  return parts
}

/** The literals an action-type expression can evaluate to: a bare literal, or
 *  every THEN / ELSE branch of a CASE (never a WHEN — that is the input). */
function literalsOf(expr: string): string[] {
  const bare = /^'([a-z][a-z0-9_]*)'$/.exec(expr.trim())
  if (bare) return [bare[1]]
  return [...expr.matchAll(/\b(?:THEN|ELSE)\s+'([a-z][a-z0-9_]*)'/g)].map((m) => m[1])
}

/** The seam → the position of its action-type argument. */
const SEAMS: Record<string, number> = {
  log_commissioner_action_internal: 2,
  draft_commish_receipt_internal: 3,
  waiver_claim_receipt_internal: 2,
  trade_receipt_internal: 2,
}

function actionTypesFromMigrations(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  const add = (type: string, file: string) => found.set(type, (found.get(type) ?? new Set()).add(file.slice(0, 3)))
  for (const file of migrationFiles) {
    const sql = read(file)
    for (const [seam, index] of Object.entries(SEAMS)) {
      const calls = new RegExp(`(?:PERFORM|:=|SELECT)\\s+(?:public\\.)?${seam}\\s*\\(([\\s\\S]*?)\\)\\s*;`, 'g')
      for (const call of sql.matchAll(calls)) {
        const arg = splitArgs(call[1])[index] ?? ''
        for (const type of literalsOf(arg)) add(type, file)
        // `p_op || '_trade'` — crossed with the ops this file admits.
        const suffix = /^p_op\s*\|\|\s*'(_[a-z_]+)'$/.exec(arg.trim())
        if (suffix) {
          const ops = /p_op NOT IN \(([^)]*)\)/.exec(sql)
          expect(ops, `${file}: the ops list its '${suffix[1]}' family is built from`).not.toBeNull()
          for (const op of ops![1].matchAll(/'([a-z]+)'/g)) add(`${op[1]}${suffix[1]}`, file)
        }
      }
    }
    for (const assignment of sql.matchAll(/v_action_type\s*:=\s*([\s\S]*?);/g)) {
      const expr = assignment[1]
      for (const type of literalsOf(expr)) add(type, file)
      const suffix = /^p_op\s*\|\|\s*'(_[a-z_]+)'/.exec(expr.trim())
      if (suffix) {
        const ops = /p_op NOT IN \(([^)]*)\)/.exec(sql)
        for (const op of ops![1].matchAll(/'([a-z]+)'/g)) add(`${op[1]}${suffix[1]}`, file)
      }
    }
  }
  return found
}

function actionTypesFromSpec(): Set<string> {
  const spec = readFileSync(path.join(ROOT, 'docs/specs/spec-redraft-leagues.md'), 'utf8')
  const start = spec.indexOf('CREATE TABLE commissioner_actions (')
  const block = spec.slice(spec.indexOf('action_type TEXT NOT NULL,', start), spec.indexOf('target_type TEXT,', start))
  const types = new Set<string>()
  for (const line of block.split('\n')) {
    // The vocabulary lines are `--      a | b | c` (the trailing prose comments start further right).
    const vocab = /^\s*--\s+(?:e\.g\.\s+)?([a-z_]+(?:\s*\|\s*[a-z_]+)*)\s*\|?\s*(?:--.*)?$/.exec(line)
    if (vocab) for (const t of vocab[1].split('|').map((x) => x.trim())) if (t) types.add(t)
  }
  return types
}

const FROM_MIGRATIONS = actionTypesFromMigrations()
const FROM_SPEC = actionTypesFromSpec()
const ALL_TYPES = [...new Set([...FROM_MIGRATIONS.keys(), ...FROM_SPEC])].sort()

const NO_CODE_WORDS = /\b[a-z]+_[a-z0-9_]+\b/

function renderType(actionType: string, over: Partial<CommishLogItem> = {}): string {
  const item: CommishLogItem = {
    id: 'ca',
    action_type: actionType,
    actor: { id: 'u1', username: 'chris' },
    target_type: null,
    target_id: null,
    reason: null,
    before: null,
    after: null,
    metadata: null,
    acting_as_team_id: null,
    reverts_action_id: null,
    created_at: '2099-09-14T18:00:00.000Z',
    ...over,
  }
  return commishLogLines([item], new Map(), new Map())[0].text
}

describe('the census inputs are real (a broken scanner must not pass an empty census)', () => {
  it('the migrations yield the receipt vocabulary, every seam represented', () => {
    for (const known of ['edit_score', 'set_result', 'force_add', 'edit_lineup', 'approve_trade', 'veto_trade', 'accept_trade', 'counter_trade', 'submit_waiver_claim', 'draft_pause', 'draft_bid', 'draft_set_queue', 'add_seat', 'replace_manager', 'retire_franchise', 'vacate_seat', 'promote_member', 'demote_member', 'change_settings', 'edit_scoring', 'delete_league', 'rescore_final_week', 'edit_bracket']) {
      expect(FROM_MIGRATIONS.has(known), known).toBe(true)
    }
    expect(FROM_MIGRATIONS.size).toBeGreaterThanOrEqual(60)
  })

  it('§12.12’s vocabulary block is read (including the lines the spec added since 139)', () => {
    for (const known of ['edit_standings', 'reopen_week', 'set_autopilot', 'draft_set_clock', 'rotate_invite_code', 'draft_bid']) {
      expect(FROM_SPEC.has(known), known).toBe(true)
    }
    expect(FROM_SPEC.size).toBeGreaterThanOrEqual(50)
  })
})

describe('TD12 census — every action type has plain words (fails by name)', () => {
  it.each(ALL_TYPES)('%s', (actionType) => {
    expect(COMMISH_ACTION_WORDS[actionType], `${actionType} has no words in COMMISH_ACTION_WORDS`).toBeTruthy()
    const text = renderType(actionType)
    expect(text).not.toBe(UNKNOWN_ACTION_WORDS)
    expect(text).not.toMatch(NO_CODE_WORDS)
    expect(text).not.toBe('')
  })
})

describe('TD12 census — the words table is the vocabulary, no more', () => {
  it('every type with words is one the migrations write or §12.12 names (no dead copy)', () => {
    expect(Object.keys(COMMISH_ACTION_WORDS).filter((type) => !ALL_TYPES.includes(type))).toEqual([])
  })
})

describe('TD12 census — every setting key has plain words (fails by name)', () => {
  const policy = (() => {
    const heads = migrationFiles.filter((f) => /CREATE OR REPLACE FUNCTION (?:public\.)?commish_setting_policy\(/.test(read(f)))
    const sql = read(heads[heads.length - 1])
    const body = sql.slice(sql.search(/CREATE OR REPLACE FUNCTION (?:public\.)?commish_setting_policy\(/))
    const fn = body.slice(0, body.indexOf('$$;'))
    return [...fn.matchAll(/p_key IN \(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((k) => k[1]))
  })()
  const docKeys = (() => {
    const sql = read(migrationFiles.filter((f) => /FUNCTION league_settings_doc_internal/.test(read(f))).pop()!)
    const fn = sql.slice(sql.indexOf('FUNCTION league_settings_doc_internal'))
    return [...fn.slice(0, fn.indexOf('$$;')).matchAll(/'([a-z_]+)',\s+l\./g)].map((m) => m[1])
  })()
  const keys = [...new Set([...Object.keys(leagueSettingsSchema.shape), ...RETIRED_WAIVER_KEYS, ...policy, ...docKeys])].sort()

  it('the key sources are real', () => {
    expect(policy.length).toBeGreaterThanOrEqual(30)
    expect(docKeys).toContain('scoring_system_id')
    expect(keys.length).toBeGreaterThanOrEqual(45)
  })

  it.each(keys)('%s', (key) => {
    expect(SETTING_WORDS[key], `${key} has no words in SETTING_WORDS`).toBeTruthy()
    // One key through the single-setting receipt (129) and the settings save (169).
    const one = renderType('change_setting', { target_type: 'setting', target_id: key, before: { [key]: 1 }, after: { [key]: 2 } })
    const many = renderType('change_settings', { target_type: 'league', before: { settings: { [key]: false } }, after: { settings: { [key]: true } } })
    for (const text of [one, many]) {
      expect(text).not.toMatch(NO_CODE_WORDS)
      expect(text).toContain(SETTING_WORDS[key])
    }
  })
})

// ---------------------------------------------------------------------------
// Ops — the new receipts' words, from the shapes the migrations store
// (168 / 171: D449(4), D452(3); 169: D450(3)–(4)) as stored literals
// ---------------------------------------------------------------------------

const TEAMS = new Map([
  ['t1', 'Alpha'],
  ['t2', 'Bravo'],
])
const MEMBERS = new Map([
  ['u7', 'dana'],
  ['u8', 'eli'],
])
function line(over: Partial<CommishLogItem>): string {
  const item: CommishLogItem = {
    id: 'ca',
    action_type: 'x',
    actor: { id: 'u1', username: 'chris' },
    target_type: null,
    target_id: null,
    reason: null,
    before: null,
    after: null,
    metadata: null,
    acting_as_team_id: null,
    reverts_action_id: null,
    created_at: '2099-09-14T18:00:00.000Z',
    ...over,
  }
  return commishLogLines([item], TEAMS, MEMBERS)[0].text
}

describe('the draft room’s receipts (168 / 171) in words', () => {
  it('pause / resume / end / reset / start / create', () => {
    expect(line({ action_type: 'draft_pause', target_type: 'draft', before: { status: 'live' }, after: { status: 'paused' } })).toBe('paused the draft')
    expect(line({ action_type: 'draft_resume', target_type: 'draft', before: { status: 'paused' }, after: { status: 'live' } })).toBe('resumed the draft')
    expect(line({ action_type: 'draft_end', target_type: 'draft', after: { status: 'complete' }, metadata: { rostered: 180, unfilled_slots: 3, voided_bids: 0 } })).toBe('ended the draft (3 roster spots left empty)')
    expect(line({ action_type: 'draft_end', target_type: 'draft', after: { status: 'complete' }, metadata: { unfilled_slots: 0 } })).toBe('ended the draft')
    expect(line({ action_type: 'draft_reset', target_type: 'draft', after: { status: 'scheduled', current_pick_number: 1 }, metadata: { picks_cleared: 42 } })).toBe('reset the draft (42 picks cleared)')
    expect(line({ action_type: 'draft_start', target_type: 'draft', before: { status: 'scheduled' }, after: { status: 'live', placeholder_team_ids: ['t2'] } })).toBe('started the draft (1 team with no manager — autopick drafts for it)')
    expect(line({ action_type: 'draft_start', target_type: 'draft', before: { status: 'scheduled' }, after: { status: 'live', placeholder_team_ids: [] } })).toBe('started the draft')
    expect(line({ action_type: 'draft_create', target_type: 'draft', after: { status: 'scheduled', draft_type: 'snake', total_rounds: 15 } })).toBe('set up the draft')
  })

  it('the clock: each changed timer in words', () => {
    expect(line({ action_type: 'draft_set_clock', target_type: 'draft', before: { pick_timer_seconds: 60, auction_nomination_seconds: 30, auction_bid_seconds: 15, auction_anti_snipe_seconds: 5 }, after: { pick_timer_seconds: 90, auction_nomination_seconds: 30, auction_bid_seconds: 15, auction_anti_snipe_seconds: 5 } })).toBe('changed the draft clock — pick clock: 1 minute → 90 seconds')
    expect(clockWords(0)).toBe('no clock')
    expect(clockWords(3600)).toBe('1 hour')
    expect(clockWords(120)).toBe('2 minutes')
  })

  it('the order, undo, a moved pick, a reversed bid, the budget, a cancelled nomination', () => {
    expect(line({ action_type: 'draft_set_order', target_type: 'draft', before: { draft_order: ['t1', 't2'], nomination_order: ['t1', 't2'] }, after: { draft_order: ['t2', 't1'], nomination_order: ['t1', 't2'] } })).toBe('changed the draft order')
    expect(line({ action_type: 'draft_set_order', target_type: 'draft', before: { draft_order: ['t1'], nomination_order: ['t1', 't2'] }, after: { draft_order: ['t1'], nomination_order: ['t2', 't1'] } })).toBe('changed the nomination order')
    expect(line({ action_type: 'draft_undo', target_type: 'draft', metadata: { undone_count: 1, rewound_to_pick: 24 } })).toBe('undid the last draft pick — back to pick 24')
    expect(line({ action_type: 'draft_undo', target_type: 'draft', metadata: { undone_count: 3, rewound_to_pick: 22 } })).toBe('undid the last 3 draft picks — back to pick 22')
    expect(line({ action_type: 'draft_reassign', target_type: 'draft_pick', before: { pick_number: 7, team_id: 't1' }, after: { pick_number: 7, team_id: 't2' } })).toBe('gave draft pick 7 from Alpha to Bravo')
    expect(line({ action_type: 'draft_move_player', target_type: 'draft_pick', before: { pick_number: 9, team_id: 't1' }, after: { pick_number: 9, team_id: 't2' } })).toBe('moved the player taken at pick 9 from Alpha to Bravo')
    expect(line({ action_type: 'draft_reverse_bid', target_type: 'draft_pick', before: { pick_number: 5, team_id: 't1', price: 30, undone: false }, metadata: { refunded: 30 } })).toBe('reversed Alpha’s winning bid at pick 5 ($30 back)')
    expect(line({ action_type: 'draft_adjust_budget', target_type: 'team', target_id: 't2', before: { budget_adjustment: 0 }, after: { budget_adjustment: 10 }, metadata: { delta: 10 } })).toBe('added $10 to Bravo’s draft budget')
    expect(line({ action_type: 'draft_adjust_budget', target_type: 'team', target_id: 't2', metadata: { delta: -5 } })).toBe('took $5 from Bravo’s draft budget')
    expect(line({ action_type: 'draft_cancel_nomination', target_type: 'draft', before: { nomination: { player_id: 'p', high_bid: 4, team_id: 't1' } }, after: { nomination: null } })).toBe('cancelled the player Alpha put up for auction')
  })

  it('acts for a team: the pick, the nomination, a bid, the targets, autodraft — the team named once (F518)', () => {
    expect(line({ action_type: 'draft_force_pick', target_type: 'draft_pick', after: { pick_number: 12, team_id: 't1', player_id: 'p' }, metadata: { for_team_id: 't1' }, acting_as_team_id: 't1' })).toBe('made pick 12 for Alpha')
    expect(line({ action_type: 'draft_force_pick', target_type: 'draft', after: { nomination_seq: 3, nomination: { player_id: 'p', team_id: 't2' } }, metadata: { for_team_id: 't2' }, acting_as_team_id: 't2' })).toBe('put a player up for auction for Bravo')
    expect(line({ action_type: 'draft_bid', target_type: 'draft', after: { player_id: 'p', high_bid: 17, high_bidder_team_id: 't2' }, metadata: { for_team_id: 't2' }, acting_as_team_id: 't2' })).toBe('bid $17 for Bravo in the auction')
    // A queue receipt carries COUNTS only (TD9) — the words never ask for players.
    expect(line({ action_type: 'draft_set_queue', target_type: 'team', target_id: 't1', before: { targets: 2 }, after: { targets: 5, added: 3, removed: 0 }, acting_as_team_id: 't1' })).toBe('set Alpha’s draft targets (5 players)')
    expect(line({ action_type: 'set_autodraft', target_type: 'team', target_id: 't2', before: { autodraft: true }, after: { autodraft: false }, acting_as_team_id: 't2' })).toBe('turned autodraft off for Bravo')
  })
})

describe('membership and invites (169) in words — an invite names its seat, never who it went to (TD9)', () => {
  it('seats and managers', () => {
    expect(line({ action_type: 'add_seat', target_type: 'team', after: { team_id: 't2', team_name: 'Bravo', placeholder: true } })).toBe('added a team to the league: Bravo')
    expect(line({ action_type: 'assign_manager', target_type: 'team', target_id: 't2', before: { manager_user_id: null }, after: { manager_user_id: 'u7' }, metadata: { team_name: 'Bravo' } })).toBe('made dana the manager of Bravo')
    expect(line({ action_type: 'replace_manager', target_type: 'team', target_id: 't1', before: { manager_user_id: 'u7' }, after: { manager_user_id: 'u8' }, metadata: { mode: 'takeover' } })).toBe('replaced Alpha’s manager: dana → eli')
    expect(line({ action_type: 'retire_franchise', target_type: 'team', target_id: 't1', after: { manager_user_id: null, team_status: 'retired', successor_team_id: 't2', successor_team_name: 'Bravo' }, metadata: { mode: 'retire', team_name: 'Alpha' } })).toBe('retired Alpha — Bravo takes its place')
    expect(line({ action_type: 'vacate_seat', target_type: 'team', target_id: 't1', before: { manager_user_id: 'u7' }, after: { manager_user_id: null }, metadata: { mode: 'vacate' } })).toBe('removed dana as Alpha’s manager — the team has no manager now')
  })

  it('roles', () => {
    expect(line({ action_type: 'promote_member', target_type: 'member', before: { role: 'manager' }, after: { role: 'co_commissioner' }, metadata: { user_id: 'u7' } })).toBe('made dana a co-commissioner')
    expect(line({ action_type: 'demote_member', target_type: 'member', before: { role: 'co_commissioner' }, after: { role: 'manager' }, metadata: { user_id: 'u7' } })).toBe('removed dana as co-commissioner')
    expect(line({ action_type: 'transfer_commissioner', target_type: 'member', before: { role: 'co_commissioner', commissioner_user_id: 'u1' }, after: { role: 'commissioner', commissioner_user_id: 'u8' } })).toBe('handed the commissioner role to eli')
  })

  it('invites — seat and kind only', () => {
    expect(line({ action_type: 'create_invite', target_type: 'invite', after: { target_team_id: 't2', team_name: 'Bravo', kind: 'email' } })).toBe('sent an invite for Bravo')
    expect(line({ action_type: 'create_invite', target_type: 'invite', after: { target_team_id: null, kind: 'link' } })).toBe('made an invite link')
    expect(line({ action_type: 'resend_invite', target_type: 'invite', metadata: { target_team_id: 't2', team_name: 'Bravo', kind: 'email' } })).toBe('re-sent the invite for Bravo')
    expect(line({ action_type: 'revoke_invite', target_type: 'invite', before: { revoked: false }, after: { revoked: true }, metadata: { target_team_id: null } })).toBe('cancelled an invite')
    expect(line({ action_type: 'rotate_invite_code', target_type: 'league', after: { invite_code_rotated: true } })).toBe('made a new league invite code')
    expect(line({ action_type: 'set_invite_slug', target_type: 'league', before: { invite_slug: 'old' }, after: { invite_slug: null } })).toBe('removed the league’s custom invite link')
    // Whatever a receipt might carry, an invite line never prints an address or a handle.
    const planted = line({ action_type: 'create_invite', target_type: 'invite', after: { target_team_id: 't2', kind: 'email', invited_email: 'x@y.z', invited_username: 'someone' } })
    expect(planted).not.toContain('x@y.z')
    expect(planted).not.toContain('someone')
  })
})

describe('league setup (129 / 169) in words', () => {
  it('a settings save lists each changed key and its values in words; many keys are counted', () => {
    expect(line({ action_type: 'change_settings', target_type: 'league', before: { settings: { waiver_type: 'faab', trade_review: 'commissioner' } }, after: { settings: { waiver_type: 'rolling_priority', trade_review: 'league_vote' } } })).toBe(
      'changed the league settings — waiver type: FAAB bidding → rolling waiver order; trade review: the commissioner reviews → league vote',
    )
    const five = Object.fromEntries(['faab_budget', 'faab_min_bid', 'fa_hold_hours', 'trade_veto_votes', 'divisions'].map((k, i) => [k, i]))
    expect(line({ action_type: 'change_settings', target_type: 'league', before: { settings: {} }, after: { settings: five } })).toMatch(/; and 2 more changes$/)
    expect(settingValueWords(true)).toBe('on')
    expect(settingValueWords(null)).toBe('none')
    expect(settingValueWords(['wed', 'sat'])).toBe('Wed, Sat')
    expect(settingValueWords({ bench: 6 })).toBe('(updated)')
  })

  it('scoring: each rule in stat words; custom scoring; the league’s name and stage', () => {
    expect(line({ action_type: 'edit_scoring', target_type: 'league', before: { scoring_rules: { 'base.receptions': 1 } }, after: { scoring_rules: { 'base.receptions': 0.5 } } })).toBe('changed the scoring — receptions: 1 → 0.5')
    expect(scoringRuleWords('positions.TE.receptions')).toBe('TE receptions')
    expect(line({ action_type: 'edit_scoring', target_type: 'league', before: { scoring_rules: {} }, after: { scoring_rules: { 'bonus.mystery': 3 } } })).toBe('changed the scoring (1 rule)')
    expect(line({ action_type: 'fork_scoring', target_type: 'league', metadata: { scoring_system_name: 'Scout PPR Custom' } })).toBe('switched the league to custom scoring (Scout PPR Custom)')
    expect(line({ action_type: 'edit_league_profile', target_type: 'league', before: { name: 'Old League' }, after: { name: 'New League' } })).toBe('renamed the league from Old League to New League')
    expect(line({ action_type: 'edit_league_profile', target_type: 'league', before: { avatar_url: null }, after: { avatar_url: 'https://x' } })).toBe('changed the league picture')
    expect(line({ action_type: 'lifecycle_change', target_type: 'league', before: { status: 'setup' }, after: { status: 'scheduled' } })).toBe('moved the league from setting up to draft scheduled')
    expect(line({ action_type: 'delete_league', target_type: 'league', before: { deleted: false }, after: { deleted: true } })).toBe('deleted the league')
  })

  it('the bracket (134) and a waiver claim made for a team (145) — blind: no player, no bid', () => {
    expect(line({ action_type: 'edit_bracket', target_type: 'bracket', before: { home_team_id: 't2', away_team_id: 't1' }, after: { home_team_id: 't1', away_team_id: 't2' }, metadata: { round: 1 } })).toBe('set a playoff round 1 matchup: Alpha vs Bravo')
    expect(line({ action_type: 'submit_waiver_claim', target_type: 'team', target_id: 't2', after: { claim_ids: ['c1'] }, metadata: { team_name: 'Bravo' }, acting_as_team_id: 't2' })).toBe('put in a waiver claim for Bravo')
  })
})
