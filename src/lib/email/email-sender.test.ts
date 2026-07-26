/**
 * EmailSender seam — pure unit tests (D37/Q5: interface only, no vendor).
 * The route-level composition (invite creation → send through the seam) is
 * covered by `invites-api-db.test.ts` with a capturing fake sender.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  buildClaimUrl,
  DevLogEmailSender,
  getEmailSender,
  renderLeagueInviteEmail,
} from './email-sender'

describe('renderLeagueInviteEmail (task item 3: league name, team label, claim link)', () => {
  it('seat-targeted invite carries league name, team label, and the /join/[token] claim link', () => {
    const rendered = renderLeagueInviteEmail({
      leagueName: 'Yardboats League',
      teamLabel: 'Team 4',
      claimUrl: 'https://fieldscout.gg/join/abc123token',
      inviterName: 'Jason Jones',
    })
    // Golden pins (stored literals — §4.3(a)).
    expect(rendered.subject).toBe("You're invited to manage Team 4 in Yardboats League on FieldScout")
    expect(rendered.text).toContain('invited by Jason Jones to manage Team 4 in Yardboats League')
    expect(rendered.text).toContain('https://fieldscout.gg/join/abc123token')
  })

  it('general invite (no team label) renders the join wording', () => {
    const rendered = renderLeagueInviteEmail({
      leagueName: 'Yardboats League',
      teamLabel: null,
      claimUrl: 'https://fieldscout.gg/join/tok',
      inviterName: null,
    })
    expect(rendered.subject).toBe("You're invited to join Yardboats League on FieldScout")
    expect(rendered.text).toContain('/join/tok')
    expect(rendered.text).not.toContain(' by ')
  })
})

describe('buildClaimUrl (§16.1 /join/[token])', () => {
  it('builds from NEXT_PUBLIC_APP_URL, trimming a trailing slash', () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://fieldscout.gg/'
    expect(buildClaimUrl('tok123')).toBe('https://fieldscout.gg/join/tok123')
    process.env.NEXT_PUBLIC_APP_URL = prev
  })
})

describe('DevLogEmailSender (the Q5 interim — logs, never sends, never throws)', () => {
  it('logs the message and reports ok with the dev-log sender name', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const result = await new DevLogEmailSender().send({
      to: 'invitee@example.com',
      subject: 'subj',
      text: 'body',
    })
    expect(result).toEqual({ ok: true, sender: 'dev-log' })
    expect(spy).toHaveBeenCalledOnce()
    expect(String(spy.mock.calls[0][0])).toContain('invitee@example.com')
    spy.mockRestore()
  })

  it('getEmailSender returns the dev/log implementation until a vendor is chosen (F15)', () => {
    expect(getEmailSender()).toBeInstanceOf(DevLogEmailSender)
  })
})
