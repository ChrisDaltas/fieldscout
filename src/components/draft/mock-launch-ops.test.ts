/**
 * Standalone practice-draft launch ops pins (MP task MP.4; spec v2.16 §8.8;
 * D229; tasks-MP §4 rule 12). Golden values are STORED LITERALS
 * (tasks-M1 §4.3) — every default is asserted against a written-out number,
 * so a change to the §7.3 catalog reddens here instead of silently becoming
 * "the mock's default".
 */

import { describe, expect, it } from 'vitest'

import {
  launchStandaloneMockInputSchema,
  standaloneMockSettingsSchema,
} from '@/lib/leagues/api/draft-service'
import {
  DEFAULT_ROSTER_SETTINGS,
  defaultsForTeamCount,
  type LeagueSettings,
} from '@/lib/leagues/settings/league-settings'

import {
  initialMockLaunchDraft,
  MOCK_DEFAULT_TEAM_COUNT,
  mockLaunchBlockedReason,
  mockLaunchIssues,
  mockLaunchSettings,
  patchMockDraftConfig,
  patchMockSettings,
  toMockLaunchInput,
} from './mock-launch-ops'

/** A shipped template's `scoring_systems.id` shape (058 seeds `gen_random_uuid()`). */
const TEMPLATE_ID = '3f1c2a64-9b0e-4d7a-8f21-5c6d7e8a9b01'

// ---------------------------------------------------------------------------
// D229(3) — the defaults are the SCHEMA's own, and there is no mock-specific
// default of any kind. Verified against `league-settings.ts` (the contract),
// not copied from the task text.
// ---------------------------------------------------------------------------

describe('D229(3) — defaults come from the §7.3 catalog and nowhere else', () => {
  it('the four ruled clocks are the schema’s shipped values — 90 / 30 / 20 / 10, zero lines changed', () => {
    const { settings } = initialMockLaunchDraft()
    expect(settings.draft.pick_timer_seconds).toBe(90)
    expect(settings.draft.auction_nomination_seconds).toBe(30)
    expect(settings.draft.auction_bid_seconds).toBe(20)
    expect(settings.draft.auction_anti_snipe_seconds).toBe(10)
  })

  it('the roster default IS `DEFAULT_ROSTER_SETTINGS` by value — the same object 040’s column DEFAULT holds', () => {
    expect(initialMockLaunchDraft().settings.roster_settings).toEqual(DEFAULT_ROSTER_SETTINGS)
  })

  it('the WHOLE opening draft equals the contract’s creation defaults at 12 teams — so no mock-specific default can hide in an unasserted field', () => {
    expect(initialMockLaunchDraft().settings).toEqual(defaultsForTeamCount(12))
    expect(MOCK_DEFAULT_TEAM_COUNT).toBe(12)
  })

  it('returns a FRESH MUTABLE object each call — never the frozen module constant (R64)', () => {
    const a = initialMockLaunchDraft()
    const b = initialMockLaunchDraft()
    expect(a.settings).not.toBe(b.settings)
    expect(Object.isFrozen(a.settings)).toBe(false)
    a.settings.draft.auction_budget = 500
    expect(b.settings.draft.auction_budget).toBe(200)
  })

  it('opens with no template chosen — D229(1)’s "pick one at launch" is the LAUNCHER’s pick (the create wizard’s own posture), and nothing here decides which of the six', () => {
    expect(initialMockLaunchDraft().scoringSystemId).toBeNull()
    expect(initialMockLaunchDraft().cpuSpeed).toBe('realistic')
  })
})

// ---------------------------------------------------------------------------
// D229(4) — "the defaults are merely a suggestion": the launcher edits them
// ---------------------------------------------------------------------------

describe('D229(4) — the launcher changes them at launch', () => {
  it('a draft-block patch reaches the payload verbatim (clocks, type, budget)', () => {
    let draft = initialMockLaunchDraft()
    draft = patchMockDraftConfig(draft, {
      draft_type: 'auction',
      auction_budget: 350,
      auction_nomination_seconds: 45,
      auction_bid_seconds: 15,
      auction_anti_snipe_seconds: 0,
    })
    draft = { ...draft, scoringSystemId: TEMPLATE_ID }
    const input = toMockLaunchInput(draft)
    expect(input?.settings.draft).toMatchObject({
      draft_type: 'auction',
      auction_budget: 350,
      auction_nomination_seconds: 45,
      auction_bid_seconds: 15,
      auction_anti_snipe_seconds: 0,
    })
  })

  it('a team-count change runs through the SHARED derived reconciler — §7.3.5’s ⌈n/2⌉ veto default re-derives, so the dialog cannot drift from the wizard', () => {
    const draft = patchMockSettings(initialMockLaunchDraft(), { team_count: 8 })
    expect(draft.settings.team_count).toBe(8)
    expect(draft.settings.trade_veto_votes).toBe(4)
  })

  it('the roster shape is editable and travels as `roster_settings`', () => {
    let draft = patchMockSettings(initialMockLaunchDraft(), {
      roster_settings: { ...DEFAULT_ROSTER_SETTINGS, bench: 10 },
    })
    draft = { ...draft, scoringSystemId: TEMPLATE_ID }
    expect(toMockLaunchInput(draft)?.settings.roster_settings.bench).toBe(10)
  })

  it('CPU speed is a launch choice, not a setting — it rides `cpu_speed`, never the settings object', () => {
    const draft = { ...initialMockLaunchDraft(), cpuSpeed: 'fast' as const, scoringSystemId: TEMPLATE_ID }
    const input = toMockLaunchInput(draft)
    expect(input?.cpu_speed).toBe('fast')
    expect(JSON.stringify(input?.settings)).not.toContain('fast')
  })
})

// ---------------------------------------------------------------------------
// §4 rule 12 / D229(5) — THE SEAM. This block is the PR's evidence that
// "fill this from league X" is a new CALL SITE and not a rewrite.
// ---------------------------------------------------------------------------

describe('§4 rule 12 — the settings object takes a SOURCE, and the template is one of them', () => {
  it('the payload is a projection of `LeagueSettings` — the same three fields a league stores (team_count / roster_settings / settings.draft)', () => {
    const settings = defaultsForTeamCount(12)
    const payload = mockLaunchSettings(settings, TEMPLATE_ID)
    expect(payload.team_count).toBe(settings.team_count)
    expect(payload.roster_settings).toEqual(settings.roster_settings)
    // The WHOLE §7.3.8 block goes over, exactly as 095's league arm
    // snapshots `leagues.settings->'draft'` — so a standalone mock's
    // `drafts.config` is shape-identical to a league mock's.
    for (const key of Object.keys(settings.draft)) {
      expect(payload.draft[key as keyof typeof settings.draft]).toEqual(
        settings.draft[key as keyof typeof settings.draft],
      )
    }
  })

  it('THE DEFERRED FEATURE, DRIVEN TODAY: a LEAGUE-shaped settings object — sharing no edited field value with the defaults — produces a valid payload through the SAME function, with no new code path', () => {
    // What `mergeSettings(leagueRow)` would hand back for a league that
    // chose 10 teams, a 60-second clock, third-round reversal, an auction
    // with a $300 budget and a deeper bench. Not one of these is a default.
    const asIfFromLeagueX: LeagueSettings = {
      ...defaultsForTeamCount(10),
      roster_settings: { ...DEFAULT_ROSTER_SETTINGS, bench: 8 },
      draft: {
        ...defaultsForTeamCount(10).draft,
        draft_type: 'auction',
        snake_reversal: true,
        pick_timer_seconds: 60,
        auction_budget: 300,
        auction_bid_seconds: 12,
      },
    }
    const payload = mockLaunchSettings(asIfFromLeagueX, TEMPLATE_ID)

    // It is accepted by the WIRE schema the route parses with — i.e. the
    // league source needs no new validation either.
    const parsed = standaloneMockSettingsSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.team_count).toBe(10)
    expect(parsed.success && parsed.data.draft.auction_budget).toBe(300)
    expect(parsed.success && parsed.data.draft.pick_timer_seconds).toBe(60)
    expect(parsed.success && parsed.data.roster_settings.bench).toBe(8)
  })

  it('the template choice rides the DRAFT BLOCK as `scoring_system_id` — so it lands in `drafts.config` with no RPC signature change (D236(4))', () => {
    const payload = mockLaunchSettings(defaultsForTeamCount(12), TEMPLATE_ID)
    expect(payload.draft.scoring_system_id).toBe(TEMPLATE_ID)
  })

  it('the wire schema is the LEAGUE contract’s own schemas, not a second copy of §7.3.8 — an unknown draft key is refused, and every catalog key is accepted', () => {
    const good = mockLaunchSettings(defaultsForTeamCount(12), TEMPLATE_ID)
    expect(standaloneMockSettingsSchema.safeParse(good).success).toBe(true)
    const smuggled = { ...good, draft: { ...good.draft, is_mock: true } }
    expect(standaloneMockSettingsSchema.safeParse(smuggled).success).toBe(false)
  })

  it('the wire schema refuses a non-v1 team count and a non-uuid template id (shape, not existence — D229/rule 10)', () => {
    const base = mockLaunchSettings(defaultsForTeamCount(12), TEMPLATE_ID)
    expect(standaloneMockSettingsSchema.safeParse({ ...base, team_count: 11 }).success).toBe(false)
    expect(
      standaloneMockSettingsSchema.safeParse({
        ...base,
        draft: { ...base.draft, scoring_system_id: 'espn-standard' },
      }).success,
    ).toBe(false)
  })

  it('the POST body schema takes the payload plus the two launch choices, and refuses a smuggled league id — the two RPC arms stay mutually exclusive at the wire too', () => {
    const settings = mockLaunchSettings(defaultsForTeamCount(12), TEMPLATE_ID)
    expect(
      launchStandaloneMockInputSchema.safeParse({ settings, cpu_speed: 'fast' }).success,
    ).toBe(true)
    expect(
      launchStandaloneMockInputSchema.safeParse({
        settings,
        league_id: '3f1c2a64-9b0e-4d7a-8f21-5c6d7e8a9b02',
      }).success,
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// MP.4 item 5 — the client validates, and is never the only validator
// ---------------------------------------------------------------------------

describe('pre-flight validation (the contract’s own messages; the server re-checks)', () => {
  it('a clean default draft with a template is launchable', () => {
    const draft = { ...initialMockLaunchDraft(), scoringSystemId: TEMPLATE_ID }
    expect(mockLaunchIssues(draft)).toEqual([])
    expect(mockLaunchBlockedReason(draft)).toBeNull()
    expect(toMockLaunchInput(draft)).not.toBeNull()
  })

  it('no template chosen ⇒ not launchable, and the reason names the step', () => {
    const draft = initialMockLaunchDraft()
    expect(toMockLaunchInput(draft)).toBeNull()
    expect(mockLaunchBlockedReason(draft)).toBe('Pick a scoring template to start.')
  })

  it('an EMPTY starting lineup is refused with the contract’s OWN §7.3.8 message — not a second wording', () => {
    const draft = {
      ...patchMockSettings(initialMockLaunchDraft(), {
        roster_settings: { ...DEFAULT_ROSTER_SETTINGS, starting_slots: [] },
      }),
      scoringSystemId: TEMPLATE_ID,
    }
    expect(toMockLaunchInput(draft)).toBeNull()
    expect(mockLaunchBlockedReason(draft)).toBe(
      'Starting lineup must total between 1 and 20 slots (currently 0).',
    )
  })

  it('a settings violation OUTRANKS the missing template — one reason at a time, most actionable first', () => {
    const draft = patchMockSettings(initialMockLaunchDraft(), {
      roster_settings: { ...DEFAULT_ROSTER_SETTINGS, starting_slots: [] },
    })
    expect(draft.scoringSystemId).toBeNull()
    expect(mockLaunchBlockedReason(draft)).not.toBe('Pick a scoring template to start.')
  })

  it('only fields this dialog can EDIT are surfaced — a message about a control that is not on screen is not a message', () => {
    const draft = {
      ...initialMockLaunchDraft(),
      scoringSystemId: TEMPLATE_ID,
    }
    // trade_veto_votes > team_count is a real §7.3.5 violation the contract
    // reports; the dialog has no trade controls, so it must not surface it.
    draft.settings = { ...draft.settings, trade_veto_votes: 16, team_count: 8 }
    expect(mockLaunchIssues(draft)).toEqual([])
    expect(mockLaunchBlockedReason(draft)).toBeNull()
  })
})

describe('MS.8 — the slot rides the standalone launch (D223/E77)', () => {
  it('a fresh draft has NO slot — Random is the default, structurally (no key can reach the wire)', () => {
    expect(initialMockLaunchDraft().slot).toBeNull()
  })

  it('Random OMITS the key entirely — the RPC default (NULL = the pre-MS.8 shuffle) is what runs', () => {
    const draft = { ...initialMockLaunchDraft(), scoringSystemId: TEMPLATE_ID }
    const input = toMockLaunchInput(draft)
    expect(input).not.toBeNull()
    expect(input && 'slot' in input).toBe(false)
  })

  it('a chosen slot rides the payload as a number', () => {
    const draft = { ...initialMockLaunchDraft(), scoringSystemId: TEMPLATE_ID, slot: 7 }
    expect(toMockLaunchInput(draft)?.slot).toBe(7)
  })

  it('a team-count shrink below the chosen slot resets it to Random — never a silent clamp to a slot nobody picked', () => {
    const at12 = { ...initialMockLaunchDraft(), scoringSystemId: TEMPLATE_ID }
    const withSlot = { ...patchMockSettings(at12, { team_count: 12 }), slot: 11 }
    const shrunk = patchMockSettings(withSlot, { team_count: 8 })
    expect(shrunk.slot).toBeNull()
  })

  it('…and a slot that still fits the new board survives the change', () => {
    const withSlot = { ...initialMockLaunchDraft(), scoringSystemId: TEMPLATE_ID, slot: 5 }
    const shrunk = patchMockSettings(withSlot, { team_count: 8 })
    expect(shrunk.slot).toBe(5)
  })
})

describe('MS.8 — the slot at the wire schema (shape floor; the RPC owns the board bound)', () => {
  const settings = mockLaunchSettings(defaultsForTeamCount(12), TEMPLATE_ID)

  it('accepts 1 and 16 (the v1 seat ceiling), refuses 0, 17 and fractions — D146 one unit either side of the schema edge', () => {
    for (const slot of [1, 16]) {
      expect(launchStandaloneMockInputSchema.safeParse({ settings, slot }).success).toBe(true)
    }
    for (const slot of [0, 17, 2.5]) {
      expect(launchStandaloneMockInputSchema.safeParse({ settings, slot }).success).toBe(false)
    }
  })

  it('the key is optional — an omitted slot parses exactly as before MS.8', () => {
    expect(launchStandaloneMockInputSchema.safeParse({ settings }).success).toBe(true)
  })
})
