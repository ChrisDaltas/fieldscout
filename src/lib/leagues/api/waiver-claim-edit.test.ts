/**
 * waiver-claim-edit.test.ts — D383(2)'s edit (cancel + resubmit + move back)
 * over injected steps (M5 L.D2.12): the happy path keeps the claim's place;
 * a refused resubmit PUTS THE ORIGINAL BACK and says so; a refused restore is
 * said in words (never a silent loss); a refused move-back still reports the
 * edit as made, with why.
 */
import { describe, expect, it, vi } from 'vitest'

import { LeagueActionError } from './client-fetch'
import { WaiverClaimEditError, runWaiverClaimEdit, type WaiverClaimEditSteps } from './waiver-claim-edit'

const original = { id: 'c-old', team_id: 't1', add_player_id: 'p-add', drop_player_id: 'p-drop', faab_bid: 10, claim_order: 2 }
const ids = { cancel: 'i-cancel', submit: 'i-submit', reorder: 'i-reorder', restore: 'i-restore', restoreReorder: 'i-restore-reorder' }

function claimAt(id: string, claim_order: number) {
  return { claim: { id, claim_order } } as never
}

function steps(over: Partial<WaiverClaimEditSteps> = {}) {
  const s = {
    cancel: vi.fn(async () => ({}) as never),
    submit: vi.fn(async () => claimAt('c-new', 3)),
    reorder: vi.fn(async () => ({}) as never),
    ...over,
  }
  return s
}

describe('runWaiverClaimEdit', () => {
  it('cancel → submit (new bid / drop) → move back to the old place, each on its own id', async () => {
    const s = steps()
    const res = await runWaiverClaimEdit(s, original, { drop_player_id: null, faab_bid: 25 }, ids)
    expect(res).toMatchObject({ kept_place: true, kept_place_why: null })
    expect(s.cancel).toHaveBeenCalledWith('c-old', { action_id: 'i-cancel' })
    expect(s.submit).toHaveBeenCalledWith({ team_id: 't1', add_player_id: 'p-add', drop_player_id: null, faab_bid: 25, action_id: 'i-submit' })
    expect(s.reorder).toHaveBeenCalledWith('c-new', { claim_order: 2, action_id: 'i-reorder' })
  })

  it('no move when the new claim already sits in the old place; a reason rides every step', async () => {
    const s = steps({ submit: vi.fn(async () => claimAt('c-new', 2)) })
    await runWaiverClaimEdit(s, original, { drop_player_id: 'p-drop', faab_bid: 11, reason: 'for him' }, ids)
    expect(s.reorder).not.toHaveBeenCalled()
    expect(s.cancel).toHaveBeenCalledWith('c-old', { action_id: 'i-cancel', reason: 'for him' })
  })

  it('a refused cancel changes nothing and is thrown as-is (stage cancel)', async () => {
    const s = steps({ cancel: vi.fn(async () => Promise.reject(new LeagueActionError(409, 'already settled'))) })
    const err = await runWaiverClaimEdit(s, original, { drop_player_id: null, faab_bid: 25 }, ids).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WaiverClaimEditError)
    expect(err).toMatchObject({ stage: 'cancel', status: 409, message: 'already settled' })
    expect(s.submit).not.toHaveBeenCalled()
  })

  it('a refused resubmit PUTS THE ORIGINAL BACK in its place and says the claim was not changed', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new LeagueActionError(409, 'a bid of $99 is more than the balance'))
      .mockResolvedValueOnce(claimAt('c-back', 3))
    const s = steps({ submit })
    const err = await runWaiverClaimEdit(s, original, { drop_player_id: null, faab_bid: 99 }, ids).catch((e: unknown) => e)
    expect(err).toMatchObject({ stage: 'submit', restored: true, status: 409 })
    expect((err as Error).message).toBe('Your claim wasn’t changed — a bid of $99 is more than the balance')
    expect(submit).toHaveBeenLastCalledWith({ team_id: 't1', add_player_id: 'p-add', drop_player_id: 'p-drop', faab_bid: 10, action_id: 'i-restore' })
    expect(s.reorder).toHaveBeenCalledWith('c-back', { claim_order: 2, action_id: 'i-restore-reorder' })
  })

  it('if even the restore is refused, the loss is SAID — never silent', async () => {
    const submit = vi.fn().mockRejectedValue(new LeagueActionError(409, 'league is complete'))
    const err = await runWaiverClaimEdit(steps({ submit }), original, { drop_player_id: null, faab_bid: 5 }, ids).catch((e: unknown) => e)
    expect(err).toMatchObject({ stage: 'submit', restored: false })
    expect((err as Error).message).toBe('Your old claim was cancelled and the new one was refused — league is complete')
  })

  it('a refused move-back leaves the edit MADE, reported with why (not thrown)', async () => {
    const s = steps({ reorder: vi.fn(async () => Promise.reject(new LeagueActionError(409, 'the set changed'))) })
    const res = await runWaiverClaimEdit(s, original, { drop_player_id: null, faab_bid: 25 }, ids)
    expect(res).toMatchObject({ kept_place: false, kept_place_why: 'the set changed' })
  })
})
