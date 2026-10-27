import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { PRO_UPSELL_ENABLED } from '@/lib/pro-upsell'

/**
 * Redesign leftover #23 (Chris, 2026-10-27): while Pro is on hold nobody is
 * offered Pro, on desktop or phone, and the account menu doesn't link the
 * internal style guide. The code stays (gated, not deleted), so these pins
 * read the source: .tsx can't be rendered under Next's jsx: "preserve".
 */

const ROOT = process.cwd()
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

const ACCOUNT_MENU = 'src/components/layout/account-menu.tsx'
const BILLING_GATE = 'src/app/app/(shell)/settings/billing/layout.tsx'

/**
 * Files that mention the Pro offer without importing the switch, and why
 * that is safe. Anything else that links the Pro page or says
 * "Upgrade to Pro" / "Go Pro" must import `PRO_UPSELL_ENABLED`.
 */
const ALLOWED: Record<string, string> = {
  'src/app/app/(shell)/settings/billing/page.tsx':
    'the Pro subscription page itself: its layout.tsx gate keeps it unreachable',
  'src/components/mobile/settings/mobile-billing-settings.tsx':
    'the phone Pro subscription screen, rendered only by that gated page',
  'src/components/settings/account-settings-ops.ts':
    'the Pro page copy, used only by the two gated screens',
  'src/lib/lists/helpers.ts':
    'server refusals for the suspended list caps (both null), never sent today',
  'src/lib/pro-upsell.ts': 'the switch itself',
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

describe('Pro offer while Pro is on hold', () => {
  it('is switched off', () => {
    expect(PRO_UPSELL_ENABLED).toBe(false)
  })

  it('the account menu shows Upgrade to Pro only behind the switch', () => {
    const src = read(ACCOUNT_MENU)
    expect(src).toContain("from '@/lib/pro-upsell'")
    expect(src).toMatch(/\{PRO_UPSELL_ENABLED && !profile\.is_pro && \(/)
    // Exactly one Upgrade item, and it is the gated one.
    expect(src.match(/Upgrade to Pro/g)).toHaveLength(1)
  })

  it('the account menu no longer links the internal style guide', () => {
    const src = read(ACCOUNT_MENU)
    expect(src).not.toMatch(/href="\/app\/styleguide"/)
    expect(src).not.toMatch(/>\s*Style guide\s*</)
    // The page itself stays.
    expect(read('src/app/app/(shell)/styleguide/page.tsx')).toContain('StyleGuidePage')
  })

  it('the Pro subscription page redirects on both layouts while the switch is off', () => {
    const src = read(BILLING_GATE)
    expect(src).toContain("from '@/lib/pro-upsell'")
    expect(src).toMatch(/if \(!PRO_UPSELL_ENABLED\) redirect\('\/app\/settings'\)/)
    // The page under the gate is still the shared desktop/phone page.
    expect(read('src/app/app/(shell)/settings/billing/page.tsx')).toContain('MobileBillingSettings')
  })

  it('every other link to the Pro page or Upgrade prompt reads the switch', () => {
    const offenders: string[] = []
    for (const full of sourceFiles(path.join(ROOT, 'src'))) {
      const file = path.relative(ROOT, full).split(path.sep).join('/')
      if (file in ALLOWED) continue
      const src = readFileSync(full, 'utf8')
      const offers = /settings\/billing|Upgrade to Pro|Go Pro/.test(src)
      if (offers && !src.includes("from '@/lib/pro-upsell'")) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
