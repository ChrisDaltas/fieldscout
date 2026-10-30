/**
 * The stats block on desktop My stats (/app/profile) and the public profile
 * (/u/[username], which phones visiting from outside the app see too), and
 * the "How cred works" explainer behind My stats' info button:
 *  - v7's Ranking accuracy section is left out — nothing grades rankings yet
 *    (gap list §2), and v7 features with no backend are left out, not
 *    stubbed (CLAUDE.md). Its stale "The 2026 season hasn't kicked off yet"
 *    line goes with it.
 *  - The cred score, Scout tier and the bar stay.
 *  - The cred copy promises nothing that doesn't exist: every account starts
 *    at CRED_START (migration 197) and nothing awards cred yet, so no line
 *    names big board updates, weekly or season-long submissions, start or
 *    sit votes, accuracy bonuses or decay.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { CredExplainer } from '@/components/stats/cred-info-popover'
import { CRED_START, CRED_TIERS } from '@/lib/cred-tiers'

import { ProfileHeader } from './profile-header'
import { ProfileStats } from './profile-stats'

// Every switch the accuracy block could ride on, flippable per test.
const h = vi.hoisted(() => ({
  flags: { weeklyRanks: false, bigBoard: false, startOrSit: false, consensus: false, community: true },
}))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: h.flags }))

/** Rendered text with the tags stripped and the escapes React adds undone. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function stats(showInfoPopover: boolean, credScore = CRED_START) {
  return renderToStaticMarkup(
    createElement(ProfileStats, {
      credScore,
      followerCount: 41,
      followingCount: 12,
      showInfoPopover,
    }),
  )
}

/** Ways to earn cred the app doesn't have — none may be promised. */
const UNBUILT_CRED = /big board|weekly|submission|start or sit|start\/sit|bonus|decay|consensus/i

describe('ProfileStats — My stats and the public profile', () => {
  it.each([
    ['My stats (with the info button)', true],
    ['the public profile', false],
  ])('%s has no Ranking accuracy section and no stale season copy', (_label, own) => {
    const t = text(stats(own))
    expect(t).not.toMatch(/accuracy/i)
    expect(t).not.toMatch(/kicked off/i)
    expect(t).not.toMatch(/Tracks from week/i)
    expect(t).not.toMatch(/Best week|vs consensus|Spearman/i)
  })

  it.each([true, false])('keeps the cred score, Scout tier and the bar (info button: %s)', (own) => {
    const html = stats(own)
    const t = text(html)
    expect(t).toContain('Cred score')
    expect(t).toContain('Scout tier')
    expect(t).toContain('Freshie')
    expect(t).toContain('93 to Sophomore')
    expect(t).toContain('Progress to Sophomore')
    expect(t).toContain('7 / 100')
    expect(html).toContain('role="progressbar"')
  })

  it.each([true, false])('says only what is true about earning cred (info button: %s)', (own) => {
    const t = text(stats(own))
    expect(t).toContain(`Everyone starts with ${CRED_START} cred. Ways to earn more cred aren't live yet.`)
    expect(t).not.toMatch(UNBUILT_CRED)
  })

  it('shows "How cred works" only where asked (My stats), never on the public profile', () => {
    expect(stats(true)).toContain('aria-label="How cred works"')
    expect(stats(false)).not.toContain('How cred')
  })

  it.each([true, false])(
    'Ranking accuracy stays out with every rankings switch on — it is placeholder text with no data behind it (plan C4; info button: %s)',
    (own) => {
      Object.assign(h.flags, { weeklyRanks: true, bigBoard: true, startOrSit: true, consensus: true })
      try {
        const t = text(stats(own))
        expect(t).not.toMatch(/accuracy/i)
        expect(t).not.toMatch(/Tracks from week|kicked off|Best week|vs consensus|Spearman/i)
      } finally {
        Object.assign(h.flags, { weeklyRanks: false, bigBoard: false, startOrSit: false, consensus: false })
      }
    },
  )

  it('a top-tier score still reads as the top tier', () => {
    const t = text(stats(false, 9400))
    expect(t).toContain('Top tier reached')
    expect(t).toContain('GOAT')
  })
})

describe('CredExplainer — the "How cred works" popover body', () => {
  const t = text(renderToStaticMarkup(createElement(CredExplainer)))

  it('says everyone starts at the starting cred and that earning more is not live yet', () => {
    expect(t).toContain('How cred works')
    expect(t).toContain(`Everyone starts with ${CRED_START} cred`)
    expect(t).toContain("Ways to earn more cred aren't live yet.")
  })

  it('promises no cred from features that are not built or are switched off', () => {
    expect(t).not.toMatch(UNBUILT_CRED)
    expect(t).not.toMatch(/accuracy|Spearman|three ways/i)
  })

  it('keeps the real tier ladder', () => {
    for (const tier of CRED_TIERS) {
      expect(t).toContain(tier.name)
      expect(t).toContain(`${tier.threshold.toLocaleString()}+`)
    }
  })
})

describe('the public profile page', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/u/[username]/page.tsx'), 'utf8')

  it("its search description no longer promises an accuracy record", () => {
    expect(src).not.toMatch(/accuracy/i)
  })

  it('its search description is "@x\'s lists on FieldScout." (plan C4)', () => {
    expect(src).toContain("profile.bio ?? `${handle}'s lists on FieldScout.`")
    expect(src).not.toMatch(/cred and public lists/)
  })
})

describe('ProfileHeader — no Pro badge while the app offers no Pro (plan C4, readiness F8)', () => {
  const header = (isOwn: boolean) =>
    text(
      renderToStaticMarkup(
        createElement(ProfileHeader, {
          username: 'fieldscout-ai',
          bio: null,
          avatarUrl: null,
          isPro: true,
          credScore: CRED_START,
          followerCount: 3,
          followingCount: 0,
          isOwn,
        }),
      ),
    )

  it.each([true, false])('a Pro account shows no "Pro" (own page: %s); the tier badge stays', (own) => {
    const t = header(own)
    expect(t).not.toMatch(/\bPro\b/)
    expect(t).toContain('Freshie')
    expect(t).toContain('@fieldscout-ai')
  })
})
