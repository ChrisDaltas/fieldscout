/**
 * commish-setting-service.test.ts — the PURE half of the commissioner
 * settings override (M6A task L.E1.11; spec §15.4:1701; migration 129 via
 * 131; PROGRESS D351, D347). The part-1 suites' three proofs, for this verb:
 *
 *   - the SCHEMA accepts an absent / blank reason (Q66), ONE snake_case key,
 *     ANY JSON value (null included — 129 types it per key), `rescore`
 *     defaulting to false; it NEVER mirrors 129's policy table;
 *   - §15.4:1701's argument order (key, value, rescore, reason), the value
 *     ALWAYS sent (null too), an absent reason OMITTED;
 *   - the family mapper's four arms VERBATIM, and the F65(b) guard on key +
 *     VALUE + rescore + verb + id — the value compared TOLERANTLY (R1058 /
 *     D351: 129 echoes it canonicalised, `129:1076`, so `"72"` sent for `72`
 *     echoed is the same submit and `120` for `72` is not; F364 stays the
 *     durable exact-echo fix).
 *
 * The live half (the policy table, the per-key canonicalisation, the
 * rescore arm, the receipt) is pgTAP 077 + the stack suite.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  COMMISH_SETTING_ACTION_ID_REUSED_MESSAGE,
  COMMISH_SETTING_FORBIDDEN_MESSAGE,
  commishChangeSetting,
  commishChangeSettingInputSchema,
  settingValueMatchesEcho,
} from './commish-setting-service'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const ACTION = 'AFA00000-0000-4000-8000-000000000061'
const ACTION_LC = 'afa00000-0000-4000-8000-000000000061'

const body = {
  key: 'waiver_period_hours',
  value: 72,
  action_id: ACTION,
  reason: 'waivers clear faster in-season',
}

describe('commishChangeSettingInputSchema — §15.4:1701 / 129:1110', () => {
  it('LOWER-CASES the action_id (R768), defaults rescore to false, and accepts an absent / blank reason (Q66)', () => {
    const parsed = commishChangeSettingInputSchema.parse({ ...body, reason: '  ' })
    expect(parsed.action_id).toBe(ACTION_LC)
    expect(parsed.rescore).toBe(false)
    expect(parsed.reason).toBeUndefined()
    const without: Partial<typeof body> = { ...body }
    delete without.reason
    expect(commishChangeSettingInputSchema.safeParse(without).success).toBe(true)
  })

  it('the value is ANY JSON — a number, a string, a boolean, an object, an array, and null — never typed here (129 types it per key)', () => {
    for (const value of [72, '72', true, { starting_slots: [] }, ['win_pct'], null]) {
      expect(commishChangeSettingInputSchema.safeParse({ ...body, value }).success, JSON.stringify(value)).toBe(true)
    }
    expect(commishChangeSettingInputSchema.parse({ ...body, value: null }).value).toBeNull()
  })

  it('the key is ONE snake_case identifier — a blank, a dotted path, a mixed-case name and an unknown body key are refused; a REFUSED-in-season key is NOT refused here (that is 129’s copy, verbatim)', () => {
    expect(commishChangeSettingInputSchema.safeParse({ ...body, key: '' }).success).toBe(false)
    expect(commishChangeSettingInputSchema.safeParse({ ...body, key: 'roster_settings.bench' }).success).toBe(false)
    expect(commishChangeSettingInputSchema.safeParse({ ...body, key: 'FaabBudget' }).success).toBe(false)
    expect(commishChangeSettingInputSchema.safeParse({ ...body, settings: {} }).success).toBe(false)
    expect(commishChangeSettingInputSchema.safeParse({ ...body, key: 'team_count' }).success).toBe(true)
  })

  it('a missing value, a 501-char reason and a null reason are field errors', () => {
    const noValue: Partial<typeof body> = { ...body }
    delete noValue.value
    expect(commishChangeSettingInputSchema.safeParse(noValue).success).toBe(false)
    expect(commishChangeSettingInputSchema.safeParse({ ...body, reason: 'x'.repeat(501) }).success).toBe(false)
    expect(commishChangeSettingInputSchema.safeParse({ ...body, reason: null }).success).toBe(false)
  })
})

function rpcDouble(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  return { client: { rpc } as never, rpc }
}

const result = {
  verb: 'commish_change_setting',
  action_type: 'change_setting',
  action_id: ACTION_LC,
  key: 'waiver_period_hours',
  value: 72,
  previous_value: 48,
  requested_value: 72,
  rescore_requested: false,
  no_changes: false,
  commissioner_action_id: 'aa000000-0000-4000-8000-000000000007',
}

describe('commishChangeSetting — the RPC call, the mapper, the F65(b) guard', () => {
  it('calls commish_change_setting in §15.4:1701’s order; the value ALWAYS rides (null too); the reason is OMITTED when blank', async () => {
    const { client, rpc } = rpcDouble({ data: result, error: null })
    expect((await commishChangeSetting(client, LEAGUE, body)).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('commish_change_setting', {
      p_league_id: LEAGUE,
      p_key: 'waiver_period_hours',
      p_value: 72,
      p_rescore: false,
      p_reason: body.reason,
      p_action_id: ACTION_LC,
    })
    await commishChangeSetting(client, LEAGUE, { ...body, value: null, rescore: true, reason: '' })
    expect(rpc.mock.calls[1][1]).toStrictEqual({ p_league_id: LEAGUE, p_key: 'waiver_period_hours', p_value: null, p_rescore: true, p_action_id: ACTION_LC })
  })

  it('never calls the pre-draft verb — update_league_settings is the settings panel’s door, not this one', async () => {
    const { client, rpc } = rpcDouble({ data: result, error: null })
    await commishChangeSetting(client, LEAGUE, body)
    expect(rpc.mock.calls.map((c) => c[0])).toStrictEqual(['commish_change_setting'])
  })

  it('returns 129’s document WHOLE — consequences, rescore_not_performed_why and bypassed[] are not narrowed away', async () => {
    const full = { ...result, consequences: { waivers: 'next run' }, rescore_not_performed_why: null, bypassed: ['league_status_gate:in_season'] }
    const { client } = rpcDouble({ data: full, error: null })
    expect((await commishChangeSetting(client, LEAGUE, body)).body).toStrictEqual(full)
  })

  it('the family mapper: 403 with this route’s copy · 404 · 409 (a REFUSED key, 129’s copy verbatim) · 400 (a typed-value refusal), each VERBATIM', async () => {
    expect(await commishChangeSetting(rpcDouble({ data: null, error: { code: '42501', message: 'x' } }).client, LEAGUE, body)).toStrictEqual({ status: 403, body: { error: COMMISH_SETTING_FORBIDDEN_MESSAGE } })
    expect(await commishChangeSetting(rpcDouble({ data: null, error: { code: 'P0002', message: 'gone' } }).client, LEAGUE, body)).toStrictEqual({ status: 404, body: { error: 'gone' } })
    const refused = 'commish_change_setting: team_count is PRE-DRAFT ONLY (§7.3, erratum v2.16.40 — Q65 ruled (b) by Chris 2026-09-15)'
    expect(await commishChangeSetting(rpcDouble({ data: null, error: { code: 'P0001', message: refused } }).client, LEAGUE, { ...body, key: 'team_count' })).toStrictEqual({ status: 409, body: { error: refused } })
    const typed = 'commish_change_setting: waiver_period_hours requires an integer between 0 and 168 — got a JSON boolean'
    expect(await commishChangeSetting(rpcDouble({ data: null, error: { code: '22023', message: typed } }).client, LEAGUE, { ...body, value: true })).toStrictEqual({ status: 400, body: { error: typed } })
  })

  it('F65(b): a replayed action_id naming a DIFFERENT key / rescore flag / verb / id is a 409, never a 200 for a change nobody made', async () => {
    for (const wrong of [
      { ...result, key: 'faab_budget' },
      { ...result, rescore_requested: true },
      { ...result, action_id: 'afa00000-0000-4000-8000-00000000ffff' },
      { ...result, verb: 'update_league_settings' },
      {},
    ]) {
      const { client } = rpcDouble({ data: wrong, error: null })
      const res = await commishChangeSetting(client, LEAGUE, body)
      expect(res.status, JSON.stringify(wrong)).toBe(409)
      expect(res.body).toStrictEqual({ error: COMMISH_SETTING_ACTION_ID_REUSED_MESSAGE })
    }
  })

  it('R1058 (D351): "72" sent / 72 echoed is the SAME submit ⇒ 200 — a canonical echo of a non-canonical form never 409s a landed change', async () => {
    const { client } = rpcDouble({ data: result, error: null }) // requested_value: 72
    const res = await commishChangeSetting(client, LEAGUE, { ...body, value: '72' })
    expect(res.status).toBe(200)
  })

  it('R1058 (D351): 120 sent / 72 echoed is a DIFFERENT value on a spent id ⇒ 409, never the first submit’s document', async () => {
    const { client } = rpcDouble({ data: result, error: null }) // requested_value: 72
    const res = await commishChangeSetting(client, LEAGUE, { ...body, value: 120 })
    expect(res.status).toBe(409)
    expect(res.body).toStrictEqual({ error: COMMISH_SETTING_ACTION_ID_REUSED_MESSAGE })
  })

  it('R1058: a roster_settings object sent WITH an unknown key and a null label vs its R1040 canonical echo (unknown key dropped, label stripped) ⇒ 200; a GENUINELY different object (bench 6 vs 7) ⇒ 409', async () => {
    const sent = {
      starting_slots: [{ key: 'QB', label: null, eligible: ['QB'], count: 1, colour: 'red' }],
      bench: 6,
      ir_slots: [],
      swap_spots: 0,
      unknown_top_level: true,
    }
    const canonical = { starting_slots: [{ key: 'QB', eligible: ['QB'], count: 1 }], bench: 6, ir_slots: [], swap_spots: 0 }
    const roster = { ...result, key: 'roster_settings', value: canonical, previous_value: canonical, requested_value: canonical }
    const same = await commishChangeSetting(rpcDouble({ data: roster, error: null }).client, LEAGUE, { ...body, key: 'roster_settings', value: sent })
    expect(same.status).toBe(200)
    const different = await commishChangeSetting(rpcDouble({ data: roster, error: null }).client, LEAGUE, { ...body, key: 'roster_settings', value: { ...sent, bench: 7 } })
    expect(different.status).toBe(409)
    expect(different.body).toStrictEqual({ error: COMMISH_SETTING_ACTION_ID_REUSED_MESSAGE })
  })
})

describe('settingValueMatchesEcho — tolerant at DEPTH 0 and per 129’s class, STRICT for everything nested (F365 / R1062)', () => {
  it('depth-0 scalars: trim always; integer text ↔ number (129:376-378); case folded ONLY for a boolean (129:404-406), "unlimited" (129:585) and a uuid (129:536) — an enum is trimmed, then EXACT', () => {
    expect(settingValueMatchesEcho(' 072 ', 72)).toBe(true)
    expect(settingValueMatchesEcho('TRUE', true)).toBe(true)
    expect(settingValueMatchesEcho(' faab ', 'faab')).toBe(true)
    expect(settingValueMatchesEcho(' UNLIMITED ', 'unlimited')).toBe(true)
    expect(settingValueMatchesEcho('AA000000-0000-4000-8000-000000000007', 'aa000000-0000-4000-8000-000000000007')).toBe(true)
    // 129 only btrims an enum — it never lower-cases one, so neither may the guard.
    expect(settingValueMatchesEcho(' FAAB ', 'faab')).toBe(false)
    expect(settingValueMatchesEcho('ROLLING_PRIORITY', 'rolling_priority')).toBe(false)
    expect(settingValueMatchesEcho(120, 72)).toBe(false)
    expect(settingValueMatchesEcho('72.0', 72)).toBe(false)
    expect(settingValueMatchesEcho('rolling_priority', 'faab')).toBe(false)
    expect(settingValueMatchesEcho(false, true)).toBe(false)
    expect(settingValueMatchesEcho(72, '72')).toBe(false)
    expect(settingValueMatchesEcho({ a: 1 }, 72)).toBe(false)
    expect(settingValueMatchesEcho(null, 72)).toBe(false)
  })

  it('an echoed null is matched by a sent null or "none" (129:466-467) and by nothing else; an ABSENT echo matches nothing', () => {
    expect(settingValueMatchesEcho(null, null)).toBe(true)
    expect(settingValueMatchesEcho(' None ', null)).toBe(true)
    expect(settingValueMatchesEcho(0, null)).toBe(false)
    expect(settingValueMatchesEcho('', null)).toBe(false)
    expect(settingValueMatchesEcho(null, undefined)).toBe(false)
    expect(settingValueMatchesEcho(72, undefined)).toBe(false)
  })

  it('NESTED IS STRICT (R1062’s three live probes): "FLEX" ≠ a stored "Flex", bench "6" ≠ 6, and an array element is not trimmed or folded — 129 stores roster_settings verbatim', () => {
    const echo = { bench: 6, starting_slots: [{ label: 'Flex', count: 1 }] }
    expect(settingValueMatchesEcho({ bench: 6, starting_slots: [{ label: 'Flex', count: 1 }] }, echo)).toBe(true)
    expect(settingValueMatchesEcho({ bench: 6, starting_slots: [{ label: 'FLEX', count: 1 }] }, echo)).toBe(false)
    expect(settingValueMatchesEcho({ bench: '6' }, { bench: 6 })).toBe(false)
    expect(settingValueMatchesEcho({ on: 'true' }, { on: true })).toBe(false)
    expect(settingValueMatchesEcho({ deadline: 'none' }, { deadline: null })).toBe(false)
    expect(settingValueMatchesEcho([' win_pct'], ['win_pct'])).toBe(false)
    expect(settingValueMatchesEcho(['WIN_PCT'], ['win_pct'])).toBe(false)
  })

  it('arrays: element-wise in order (129 keeps order); objects: every key the ECHO carries, sent extras ignored AT EVERY DEPTH (R1040’s drops), an echoed key the sent object lacks is a mismatch', () => {
    expect(settingValueMatchesEcho(['win_pct', 'points_for'], ['win_pct', 'points_for'])).toBe(true)
    expect(settingValueMatchesEcho(['points_for', 'win_pct'], ['win_pct', 'points_for'])).toBe(false)
    expect(settingValueMatchesEcho(['win_pct'], ['win_pct', 'points_for'])).toBe(false)
    expect(settingValueMatchesEcho({ bench: 6, extra: 1 }, { bench: 6 })).toBe(true)
    expect(settingValueMatchesEcho({ slots: [{ label: 'Flex', extra: 1 }] }, { slots: [{ label: 'Flex' }] })).toBe(true)
    expect(settingValueMatchesEcho({ extra: 1 }, { bench: 6 })).toBe(false)
    expect(settingValueMatchesEcho([{ bench: 6 }], { bench: 6 })).toBe(false)
  })
})
