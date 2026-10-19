/**
 * Account Settings on the phone (gap list §4 item 101): `/app/settings`,
 * `/app/settings/scoring` and `/app/settings/billing` draw their own
 * FieldScout Mobile screens — a 52px page bar (blue back chevron, the title
 * as h1) over the same data and actions as desktop, in `m-*` tokens only so
 * the phone's dark mode follows — instead of the borrowed desktop layout.
 *
 * Rendered statically over a seeded query cache (effects don't run).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/settings',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ from: () => ({}), auth: {} }),
}))

const me = vi.hoisted(() => ({
  isLoading: false,
  profile: {
    id: 'user-me',
    username: 'dalton',
    avatar_url: null as string | null,
    is_pro: false as boolean | null,
    subscription_status: null as string | null,
  } as null | { id: string; username: string; avatar_url: string | null; is_pro: boolean | null; subscription_status: string | null },
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-me', email: 'dalton@example.test' },
    profile: me.profile,
    isLoading: me.isLoading,
    signOut: vi.fn(),
  }),
}))

import { SCORING_PRESETS } from '@/lib/scoring/default'
import { SCORING_GROUPS } from '@/lib/scoring/scoring-editor'

import { NOTIFICATION_ROWS, PRO_FEATURES } from '@/components/settings/account-settings-ops'
import { MobileAccountSettings } from './mobile-account-settings'
import { MobileBillingSettings } from './mobile-billing-settings'
import { MobileScoringSettings, SAVE_NEEDS_CUSTOM } from './mobile-scoring-settings'

const BASE = me.profile ? { ...me.profile } : null
afterEach(() => {
  me.isLoading = false
  me.profile = BASE ? { ...BASE } : null
})

function render(el: ReactElement, seed?: (qc: QueryClient) => void): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['scoring-system', 'user-me'], null)
  seed?.(qc)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Every class token on the page. */
function classTokens(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
}

/** Desktop colour tokens: fixed light colours that don't follow phone dark
 *  mode (the phone draws in `m-*`). Accent blue, white-on-accent and the
 *  avatar's own fallback are the shared exceptions. */
const DESKTOP_COLOUR = /^(?:[a-z]+:)*(?:text|bg|border)-(?:ink|white|n-\d|negative|positive|caution|surface)/

function expectPhoneTokensOnly(html: string) {
  const offenders = classTokens(html).filter((t) => DESKTOP_COLOUR.test(t) && t !== 'text-white')
  expect(offenders).toEqual([])
}

describe('Settings — the phone screen (gap list §4 item 101)', () => {
  it('has its own page bar: the blue back chevron and “Settings” as the h1', () => {
    const html = render(createElement(MobileAccountSettings))
    expect(html).toMatch(/<button[^>]*aria-label="Back"[^>]*class="[^"]*text-accent[^"]*"[^>]*data-page-back/)
    expect(html).toMatch(/<h1[^>]*>Settings<\/h1>/)
    expect(html).toContain('data-mobile-screen')
  })

  it('draws the sections in order, in phone tokens only', () => {
    const html = render(createElement(MobileAccountSettings))
    const order = ['Profile', 'Sign in & security', 'Notifications', 'Scoring', 'Sessions'].map((t) =>
      html.indexOf(`data-settings-group="${t}"`),
    )
    expect(order.every((i) => i > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expectPhoneTokensOnly(html)
  })

  it('shows your two letters with Upload photo, and Change photo + Remove once there is a photo', () => {
    let html = render(createElement(MobileAccountSettings))
    expect(html).toContain('>DA<')
    expect(html).toMatch(/data-settings-photo-pick[^>]*>Upload photo</)
    expect(html).not.toContain('data-settings-photo-remove')
    me.profile!.avatar_url = 'https://example.test/me.png'
    html = render(createElement(MobileAccountSettings))
    expect(html).toMatch(/data-settings-photo-pick[^>]*>Change photo</)
    expect(html).toMatch(/data-settings-photo-remove[^>]*>Remove</)
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/png,image\/jpeg,image\/webp,image\/gif"/)
  })

  it('links your @handle to your profile, and shows the email', () => {
    const html = render(createElement(MobileAccountSettings))
    expect(html).toMatch(/<a[^>]*href="\/u\/dalton"[^>]*>@dalton<\/a>/)
    expect(html).toMatch(/data-settings-email[^>]*>dalton@example.test</)
  })

  it('keeps Update password off until a matching pair is typed', () => {
    const html = render(createElement(MobileAccountSettings))
    expect(html.match(/<input[^>]*type="password"[^>]*autoComplete="new-password"/g)).toHaveLength(2)
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*data-settings-password-save[^>]*>Update password</)
    // Nothing typed is not an error.
    expect(html).not.toContain('data-settings-password-why')
  })

  it('has the six notification switches, in desktop’s order and positions', () => {
    const html = render(createElement(MobileAccountSettings))
    const rows = [...html.matchAll(/id="m-notif-([a-z_]+)" type="button" role="switch" aria-checked="(true|false)"/g)].map((m) => [m[1], m[2]])
    expect(rows).toEqual(NOTIFICATION_ROWS.map((r) => [r.key, String(r.defaultOn)]))
  })

  it('opens Scoring from its row, and signs out from Sessions', () => {
    const html = render(createElement(MobileAccountSettings))
    expect(html).toMatch(/<a[^>]*data-settings-scoring-link[^>]*href="\/app\/settings\/scoring"/)
    expect(html).toMatch(/data-settings-session[\s\S]*This device[\s\S]*Signed in as dalton@example.test[\s\S]*text-m-green[^>]*>Active</)
    expect(html).toMatch(/data-settings-sign-out[^>]*>Sign out</)
  })

  it('shows loading blocks, then says so when the account can’t be read', () => {
    me.isLoading = true
    expect(render(createElement(MobileAccountSettings))).toContain('data-settings-loading')
    me.isLoading = false
    me.profile = null
    const html = render(createElement(MobileAccountSettings))
    expect(html).toMatch(/role="alert"[\s\S]*We couldn’t load your account/)
  })
})

describe('Settings › Scoring — the phone screen', () => {
  it('has its page bar, Basic settings, the Scout AI read and every group, in phone tokens', () => {
    const html = render(createElement(MobileScoringSettings))
    expect(html).toMatch(/<h1[^>]*>Scoring<\/h1>/)
    expect(html).toContain('data-page-back')
    for (const group of ['Basic settings', ...SCORING_GROUPS.map((g) => g.title)]) {
      expect(html, group).toContain(`data-settings-group="${group}"`)
    }
    expect(html).toMatch(/data-scout-ai-card[\s\S]*Your settings favor pass catchers/)
    expectPhoneTokensOnly(html)
  })

  it('opens on the default preset: name read-only, every preset in the picker, Full PPR on', () => {
    const html = render(createElement(MobileScoringSettings))
    expect(html).toMatch(/<input id="m-scoring-name"[^>]*disabled=""[^>]*value="ESPN PPR"|<input id="m-scoring-name"[^>]*value="ESPN PPR"[^>]*disabled=""/)
    expect(html).toContain('Platform presets keep their own names.')
    const options = [...html.matchAll(/<option value="([a-z_]+)"[^>]*>/g)].map((m) => m[1])
    expect(options).toEqual([...SCORING_PRESETS.map((p) => p.id), 'custom'])
    expect(html).toMatch(/id="m-scoring-full-ppr" type="button" role="switch" aria-checked="true"/)
  })

  it('draws each value as − value + with the step’s formatting, losses in red', () => {
    const html = render(createElement(MobileScoringSettings))
    expect(html).toContain('aria-label="Fewer: Passing yards points"')
    expect(html).toContain('aria-label="More: Passing yards points"')
    expect(html).toMatch(/text-m-t1">\+0\.04</)
    expect(html).toMatch(/text-m-red">-2</)
    const steppers = html.match(/aria-label="More: [^"]+ points"/g) ?? []
    expect(steppers).toHaveLength(SCORING_GROUPS.flatMap((g) => g.fields).length)
  })

  it('keeps Save off on a preset and says what turns it on; Reset is there', () => {
    const html = render(createElement(MobileScoringSettings))
    expect(html).toMatch(/data-scoring-save-why[^>]*>Change any value to save it as your own system\.</)
    expect(SAVE_NEEDS_CUSTOM).toBe('Change any value to save it as your own system.')
    expect(html).toMatch(/<button type="button" disabled=""[^>]*data-scoring-save[^>]*>Save scoring</)
    expect(html).toContain('>Reset to default<')
  })

  it('never opens on the defaults when your saved system can’t be read', () => {
    const html = render(createElement(MobileScoringSettings), (qc) => {
      // A failed read stays failed on mount (no refetch in a static render).
      qc.setDefaultOptions({ queries: { retry: false, retryOnMount: false } })
      const query = qc.getQueryCache().build(qc, { queryKey: ['scoring-system', 'user-me'] })
      query.setState({ ...query.state, status: 'error', error: new Error('boom'), data: undefined, fetchStatus: 'idle' })
    })
    expect(html).toMatch(/role="alert"[\s\S]*Couldn’t load your scoring\.[\s\S]*Try again/)
    expect(html).not.toContain('data-scoring-settings')
  })
})

describe('Settings › Pro subscription — the phone screen', () => {
  it('on Free: the chip, what Pro includes and Upgrade to Pro', () => {
    const html = render(createElement(MobileBillingSettings))
    expect(html).toMatch(/<h1[^>]*>Pro subscription<\/h1>/)
    expect(html).toMatch(/data-settings-group="Your plan"[\s\S]*>Free</)
    for (const feature of PRO_FEATURES) expect(html).toContain(feature)
    expect(html).toMatch(/data-billing-upgrade[^>]*>Upgrade to Pro</)
    expectPhoneTokensOnly(html)
  })

  it('on Pro: the Pro chip and the subscription status, no upgrade', () => {
    me.profile = { ...me.profile!, is_pro: true, subscription_status: 'active' }
    const html = render(createElement(MobileBillingSettings))
    expect(html).toMatch(/>Pro<\/span>/)
    expect(html).toContain('Subscription status: active')
    expect(html).not.toContain('data-billing-upgrade')
  })
})

describe('the routes draw these on the phone (ByLayout), desktop unchanged', () => {
  const page = (rel: string) => readFileSync(path.join(process.cwd(), 'src/app/app/(shell)/settings', rel), 'utf8')
  it.each([
    ['page.tsx', 'DesktopSettings', 'MobileAccountSettings'],
    ['scoring/page.tsx', 'DesktopScoringSettings', 'MobileScoringSettings'],
    ['billing/page.tsx', 'DesktopBillingSettings', 'MobileBillingSettings'],
  ])('%s', (rel, desktop, mobile) => {
    expect(page(rel)).toContain(`<ByLayout desktop={<${desktop} />} mobile={<${mobile} />} />`)
  })
})
