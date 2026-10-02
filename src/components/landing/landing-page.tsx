import Link from 'next/link'

import { AskScoutDuo } from '@/components/landing/ask-scout-duo'
import { CompareTable } from '@/components/landing/compare-table'
import { FieldLines } from '@/components/landing/field-lines'
import { Logo } from '@/components/landing/fieldscout-logo'
import { CreateAccountButton, PosTag, ScoutDot } from '@/components/landing/landing-bits'
import { LeagueHomePreview } from '@/components/landing/league-home-preview'
import { ScoutAIDemo } from '@/components/landing/scout-ai-demo'
import { StatsTableDemo } from '@/components/landing/stats-table-demo'
import { ToolCards } from '@/components/landing/tool-cards'
import { WeekTicker } from '@/components/landing/week-ticker'
import { cn } from '@/lib/utils'

/**
 * Public landing page for signed-out visitors — Claude Design project
 * "FieldScout.gg landing", file "FieldScout Landing v13" (13a desktop).
 *
 * v13 is the new app look (ruled 2026-10-02); this page is its first
 * surface and uses the `fs-*` tokens in tailwind.config.ts. Shipped as
 * designed (ruled 2026-10-02), including features not yet open to visitors.
 * The design's `#` placeholder links have no destination yet, so they
 * render as plain text rather than links that go nowhere.
 */

const PAD_X = 'px-[clamp(24px,11vw,160px)]'

function SectionTitle({
  lead,
  muted,
  body,
  className,
}: {
  lead: string
  muted: string
  body?: string
  className?: string
}) {
  return (
    <div className={cn('text-center', className)}>
      <h2 className="mx-auto max-w-[880px] text-balance text-[clamp(36px,4.6vw,56px)] font-semibold leading-[1.06] tracking-[-0.04em]">
        <span className="text-fs-ink">{lead}</span>
        <br />
        <span className="text-fs-text-4">{muted}</span>
      </h2>
      {body && (
        <p className="mx-auto mt-4 max-w-[640px] text-pretty text-[17px] font-medium leading-normal text-fs-text-3 sm:text-[19px]">
          {body}
        </p>
      )}
    </div>
  )
}

const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: ['Scout AI', 'Full leagues', 'Live drafts', 'Rankings', 'Start or sit', 'Waiver wire reports', 'Advanced stats'],
  },
  { title: 'Resources', links: ['Pre Draft Field Guide', 'Help center', 'Changelog', 'Contact'] },
  { title: 'Company', links: ['About', 'Blog', 'Careers', 'Press'] },
]

export function LandingPage() {
  return (
    <div className="overflow-x-clip bg-fs-page font-inter text-fs-ink antialiased [font-variant-numeric:tabular-nums]">
      {/* Sticky translucent header — pinned over scrolling content. */}
      <header className="sticky top-0 z-50 flex h-[52px] items-center border-b-1 border-black/[.08] bg-fs-page/80 px-4 backdrop-blur-xl backdrop-saturate-[1.8] sm:px-10">
        <div className="mx-auto flex w-full max-w-[1120px] items-center gap-2.5">
          <Link href="/" aria-label="FieldScout home">
            {/* Tile only on phones — the wordmark + both actions don't fit at 375px. */}
            <Logo wordClassName="hidden min-[440px]:block" />
          </Link>
          <div className="ml-auto flex items-center gap-[22px]">
            <Link href="/login" className="whitespace-nowrap text-[14px] font-medium text-fs-ink hover:text-fs-blue">
              Sign in
            </Link>
            <CreateAccountButton size="sm" />
          </div>
        </div>
      </header>

      <WeekTicker />

      <main className="relative">
        <FieldLines />

        <div className="relative z-[1]">
          {/* Hero */}
          <section className={cn(PAD_X, 'pb-24 pt-[72px] text-center')}>
            <div className="inline-flex h-[30px] items-center gap-2 rounded-pill bg-white px-3.5 text-[14px] font-semibold shadow-fs-ring">
              <ScoutDot />
              Powered by Scout AI
            </div>
            <h1 className="mx-auto mt-[22px] max-w-[1000px] text-balance text-[clamp(40px,6.4vw,80px)] font-bold leading-[1.02] tracking-[-0.05em]">
              <span className="text-fs-ink">Welcome to FieldScout.</span>
              <br />
              <span className="text-fs-text-4">The first platform 100% dedicated to fantasy football.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-[720px] text-pretty text-[18px] font-medium leading-[1.45] text-fs-text-3 sm:text-[21px]">
              Full leagues, live drafts, expert and consensus rankings, waiver wire reports, start or sit and
              advanced stats. All powered by Scout AI.
            </p>
            <div className="mt-[30px] flex items-center justify-center">
              <CreateAccountButton size="lg" />
            </div>
            <div className="mx-auto mt-14 w-full max-w-[920px]">
              <ScoutAIDemo mode="find" />
            </div>
          </section>

          {/* Introducing + league home shot */}
          <section className={cn(PAD_X, 'pb-[140px] pt-6')}>
            <h2 className="mx-auto max-w-[960px] text-balance text-center text-[clamp(36px,5vw,64px)] font-semibold leading-[1.06] tracking-[-0.045em]">
              <span className="text-fs-ink">Powered by Scout AI.</span>
              <br />
              <span className="text-fs-text-4">Next-gen fantasy sports has arrived.</span>
            </h2>
            <LeagueHomePreview />
          </section>

          {/* Six tools */}
          <section className="pb-[120px]">
            <div className={cn(PAD_X, 'flex flex-wrap items-end gap-6')}>
              <div>
                <h2 className="text-[clamp(36px,4.6vw,56px)] font-bold leading-[1.05] tracking-[-0.04em]">
                  Everything your league needs.
                </h2>
                <p className="mt-3 text-[18px] font-medium text-fs-text-3 sm:text-[21px]">
                  Six tools, all powered by Scout AI.
                </p>
              </div>
              <span className="ml-auto text-[14px] font-medium text-fs-text-3">Scroll for more ›</span>
            </div>
            <ToolCards />
          </section>

          {/* Ask Scout */}
          <section className={cn(PAD_X, 'pb-[140px]')}>
            <SectionTitle
              lead="Just ask Scout AI"
              muted="Who to start. Who to sit."
              body="Ask for a weekly projection or a lineup change. Scout AI checks the numbers, then does the work."
            />
            <div className="-mx-[clamp(24px,11vw,160px)] mt-8">
              <AskScoutDuo />
            </div>
          </section>

          {/* Stats table */}
          <section className={cn(PAD_X, 'pb-[140px]')}>
            <SectionTitle
              lead="Fully customizable."
              muted="All the metrics in one place."
              body="Pick the stats you care about and they drop straight into the table. Click any column to sort."
            />
            <div className="mx-auto mt-12 w-full max-w-[1120px]">
              <StatsTableDemo />
            </div>
          </section>

          {/* Compare */}
          <section className={cn(PAD_X, 'pb-[120px]')}>
            <h2 className="text-center text-[clamp(36px,4.6vw,56px)] font-semibold leading-[1.12] tracking-[-0.04em]">
              <span className="text-fs-ink">Set the edge</span>
              <br />
              <span className="text-fs-text-4">How FieldScout compares.</span>
            </h2>
            <p className="mx-auto mt-3.5 max-w-[600px] text-center text-[18px] font-medium leading-[1.4] text-fs-text-3 sm:text-[21px]">
              Every platform runs your league. FieldScout also does the research.
            </p>
            <CompareTable />
          </section>

          {/* Closing CTA */}
          <section className={cn(PAD_X, 'pb-20 pt-10 text-center')}>
            <h2 className="text-balance text-[clamp(44px,6.5vw,80px)] font-bold leading-none tracking-[-0.05em]">
              Football is officially back.
            </h2>
            <div className="mt-9 flex justify-center">
              <CreateAccountButton size="xl" />
            </div>
          </section>

          {/* Pre Draft Field Guide */}
          <section className={cn(PAD_X, 'pb-[140px]')}>
            <div className="mx-auto flex max-w-[720px] flex-col rounded-fs-xl bg-white p-6 shadow-fs-ring sm:p-9">
              <h2 className="text-[28px] font-bold tracking-[-0.03em]">The Pre Draft Field Guide</h2>
              <p className="mt-1.5 text-[16px] font-medium leading-[1.45] text-fs-text-3">
                Scout AI&apos;s position-by-position playbook: the Vegas lines, matchups, history and usage it weighs
                for every projection. Start with WR, no login.
              </p>
              <div className="mt-5 flex flex-col">
                {(
                  [
                    { pos: 'WR', label: 'Wide receivers', note: 'Read ›', open: true },
                    { pos: 'QB', label: 'Quarterbacks', note: 'With account' },
                    { pos: 'RB', label: 'Running backs', note: 'With account' },
                    { pos: 'TE', label: 'Tight ends', note: 'With account' },
                  ] as const
                ).map((g, i) => (
                  <div
                    key={g.pos}
                    className={cn('flex items-center gap-3 py-3', i < 3 && 'border-b-1 border-fs-line')}
                  >
                    <PosTag pos={g.pos} className="h-[22px] rounded-[6px] px-2 text-[12px]" />
                    <span className="text-[16px] font-semibold">{g.label}</span>
                    <span
                      className={cn(
                        'ml-auto',
                        'open' in g ? 'text-[14px] font-semibold text-fs-blue' : 'text-[13px] font-medium text-fs-text-3',
                      )}
                    >
                      {g.note}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t-1 border-fs-line-strong bg-white">
        <div className="mx-auto grid max-w-[1120px] grid-cols-2 gap-x-8 gap-y-10 px-6 pb-10 pt-16 sm:px-10 md:grid-cols-[minmax(260px,1.4fr)_repeat(3,minmax(140px,1fr))]">
          <div className="col-span-2 flex flex-col items-start gap-4 md:col-span-1">
            <Logo tile={28} word={15} />
            <p className="max-w-[280px] text-[15px] font-medium leading-normal text-fs-text-3">
              The first fantasy football platform that is just fantasy football. Powered by Scout AI.
            </p>
            <CreateAccountButton size="md" />
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <div className="text-[13px] font-semibold text-fs-ink">{col.title}</div>
              {col.links.map((l) => (
                <span key={l} className="text-[14px] font-medium text-fs-text-2">
                  {l}
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-3 border-t-1 border-fs-line px-6 pb-7 pt-5 text-[12.5px] font-medium text-fs-text-3 sm:px-10">
          <span>© 2026 FieldScout. All rights reserved.</span>
          <span>Privacy</span>
          <span>Terms</span>
          <div className="ml-auto flex items-center gap-2">
            {['X', 'Instagram', 'Discord'].map((s) => (
              <span
                key={s}
                className="inline-flex h-8 items-center rounded-pill bg-fs-page px-3 text-[12.5px] font-semibold text-fs-ink"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
