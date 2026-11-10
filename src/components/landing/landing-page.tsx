import Link from 'next/link'

import { AskScoutDuo } from '@/components/landing/ask-scout-duo'
import { CompareTable } from '@/components/landing/compare-table'
import { FieldLines } from '@/components/landing/field-lines'
import { Logo, Wordmark } from '@/components/landing/fieldscout-logo'
import { HeroDemo } from '@/components/landing/hero-demo'
import { CreateAccountButton, DownMarker, PosTag, ScoutDot } from '@/components/landing/landing-bits'
import { SAMPLE_WEEK } from '@/components/landing/landing-data'
import { LeagueHomePreview } from '@/components/landing/league-home-preview'
import { StatsTableDemo } from '@/components/landing/stats-table-demo'
import { ToolCards } from '@/components/landing/tool-cards'
import { WeekTicker } from '@/components/landing/week-ticker'
import { cn } from '@/lib/utils'
import { nflSeason } from '@/utils/nfl-season'

/**
 * Public landing page for signed-out visitors — built from Claude Design
 * "FieldScout Landing v13" (the `fs-*` tokens in tailwind.config.ts), then
 * reworked 2026-11-10 (Chris agreed the review):
 *
 *  - Tagline "Scout. Play. Win." over a short hero, so the Scout AI demo is
 *    in view on first load; three question chips drive that demo.
 *  - The page is one drive down the field: each section carries a down
 *    marker, the yard numbers count toward the goal line, the closing call to
 *    action is the green end zone, and the free guide is the extra point.
 *  - The tool cards are a grid showing all seven.
 *  - Week labels and seasonal wording follow the real NFL calendar (the page
 *    is static and re-rendered hourly — see `revalidate` on the route pages).
 *    Names and numbers in the demos are still illustrative.
 *  - The footer lists only things that exist. The design's placeholder pages
 *    (help, blog, privacy…) were plain text; they return when they're built.
 */

// 16px on phones; the design's fluid gutter from sm up.
const PAD_X = 'px-4 sm:px-[clamp(24px,11vw,160px)]'

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

/** Sections the footer (and nothing else yet) links to. */
const ON_THIS_PAGE = [
  { href: '#league', label: 'Your league' },
  { href: '#tools', label: 'The tools' },
  { href: '#ask', label: 'Ask Scout AI' },
  { href: '#stats', label: 'Advanced stats' },
  { href: '#compare', label: 'How we compare' },
  { href: '#guide', label: 'Field guide' },
]

/** Anchor targets clear the sticky header. */
const ANCHOR = 'scroll-mt-[76px]'

export function LandingPage() {
  const season = nflSeason(new Date())
  // In season (from Week 2, once there are games to look back on) the demos
  // are set in the real week; otherwise they keep the Week 4 sample.
  const week = season.phase === 'regular' && season.week !== null && season.week >= 2 ? season.week : SAMPLE_WEEK
  const inSeason = season.phase === 'regular' || season.phase === 'postseason'

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
            <Link href="/login" scroll={false} className="whitespace-nowrap text-[14px] font-medium text-fs-ink hover:text-fs-blue">
              Sign in
            </Link>
            <CreateAccountButton size="sm" />
          </div>
        </div>
      </header>

      <WeekTicker week={week} />

      <main>
        {/* The field: every section up to the goal line. */}
        <div className="relative">
          <FieldLines />

          <div className="relative z-[1]">
            {/* Hero — short on purpose, so the demo is in view on first load. */}
            <section className={cn(PAD_X, 'pb-24 pt-12 text-center sm:pt-14')}>
              <div className="inline-flex h-[30px] items-center gap-2 rounded-pill bg-white px-3.5 text-[14px] font-semibold shadow-fs-ring">
                <ScoutDot />
                Powered by Scout AI
              </div>
              <h1 className="mx-auto mt-5 text-balance text-[clamp(40px,7.4vw,96px)] font-bold leading-none tracking-[-0.055em]">
                Scout. Play. Win.
              </h1>
              <p className="mx-auto mt-4 max-w-[720px] text-pretty text-[18px] font-medium leading-[1.45] text-fs-text-3 sm:mt-5 sm:text-[21px]">
                The first platform 100% dedicated to fantasy football.
              </p>
              <div className="mt-6 flex flex-col items-center gap-3 sm:mt-7">
                <CreateAccountButton size="lg" />
                <span className="text-[14px] font-medium text-fs-text-3">Free. No card needed.</span>
              </div>
              <div className="mt-9 sm:mt-10">
                <HeroDemo week={week} />
              </div>
            </section>

            {/* League home shot */}
            <section id="league" className={cn(PAD_X, ANCHOR, 'pb-[140px] pt-6 text-center')}>
              <DownMarker down="1st & 10" label="Your league" />
              <h2 className="mx-auto mt-5 max-w-[960px] text-balance text-[clamp(36px,5vw,64px)] font-semibold leading-[1.06] tracking-[-0.045em]">
                <span className="text-fs-ink">Powered by Scout AI.</span>
                <br />
                <span className="text-fs-text-4">Next-gen fantasy sports has arrived.</span>
              </h2>
              <div className="text-left">
                <LeagueHomePreview week={week} />
              </div>
            </section>

            {/* The tools */}
            <section id="tools" className={cn(PAD_X, ANCHOR, 'pb-[140px]')}>
              <div className="mx-auto max-w-[1120px]">
                <DownMarker down="2nd & 6" label="The tools" />
                <h2 className="mt-5 text-[clamp(36px,4.6vw,56px)] font-bold leading-[1.05] tracking-[-0.04em]">
                  Everything your league needs.
                </h2>
                <p className="mt-3 text-[18px] font-medium text-fs-text-3 sm:text-[21px]">
                  Scout AI, and the six tools built around it.
                </p>
              </div>
              <ToolCards week={week} />
            </section>

            {/* Ask Scout */}
            <section id="ask" className={cn(PAD_X, ANCHOR, 'pb-[140px] text-center')}>
              <DownMarker down="3rd & 2" label="Ask Scout AI" />
              <SectionTitle
                className="mt-5"
                lead="Just ask Scout AI"
                muted="Who to start. Who to sit."
                body="Ask for a weekly projection or a lineup change. Scout AI checks the numbers, then does the work."
              />
              <div className="-mx-4 mt-8 text-left sm:-mx-[clamp(24px,11vw,160px)]">
                <AskScoutDuo week={week} />
              </div>
            </section>

            {/* Stats table — a fresh set of downs */}
            <section id="stats" className={cn(PAD_X, ANCHOR, 'pb-[140px] text-center')}>
              <DownMarker down="1st & 10" label="Advanced stats" />
              <SectionTitle
                className="mt-5"
                lead="Fully customizable."
                muted="All the metrics in one place."
                body="Pick the stats you care about and they drop straight into the table. Click any column to sort."
              />
              <div className="mx-auto mt-12 w-full max-w-[1120px] text-left">
                <StatsTableDemo week={week} />
              </div>
            </section>

            {/* Compare — knocking on the door */}
            <section id="compare" className={cn(PAD_X, ANCHOR, 'pb-[120px] text-center')}>
              <DownMarker down="1st & goal" label="How we compare" />
              <h2 className="mt-5 text-[clamp(36px,4.6vw,56px)] font-semibold leading-[1.12] tracking-[-0.04em]">
                <span className="text-fs-ink">Set the edge</span>
                <br />
                <span className="text-fs-text-4">How FieldScout compares.</span>
              </h2>
              <p className="mx-auto mt-3.5 max-w-[600px] text-[18px] font-medium leading-[1.4] text-fs-text-3 sm:text-[21px]">
                Every platform runs your league. FieldScout also does the research.
              </p>
              <div className="text-left">
                <CompareTable />
              </div>
            </section>
          </div>
        </div>

        {/* The end zone — the closing call to action. The white band is the goal line. */}
        <section id="start" className={cn(PAD_X, ANCHOR, 'border-t-[6px] border-white bg-fs-green pb-20 pt-14 text-center sm:pb-24 sm:pt-16')}>
          <DownMarker down="Touchdown" label="Scout. Play. Win." onGreen />
          {/* The name painted across the end zone, in white like field paint. */}
          <div aria-hidden="true" className="mx-auto mt-9 max-w-[1120px] sm:mt-10">
            <Wordmark className="h-auto w-full text-white" />
          </div>
          <h2 className="mt-10 text-balance text-[clamp(36px,5vw,64px)] font-bold leading-none tracking-[-0.045em] sm:mt-12">
            Take it to the house.
          </h2>
          <p className="mx-auto mt-4 max-w-[560px] text-[18px] font-medium leading-[1.4] text-fs-ink/80 sm:text-[21px]">
            Create your account and start scouting your league today.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <CreateAccountButton size="xl" tone="ink" />
            <span className="text-[14px] font-semibold text-fs-ink/70">Free. No card needed.</span>
          </div>
        </section>

        {/* The extra point — the free field guide */}
        <section id="guide" className={cn(PAD_X, ANCHOR, 'pb-[120px] pt-20 text-center')}>
          <DownMarker down="Extra point" label="Free guide" />
          <div className="mx-auto mt-6 flex max-w-[720px] flex-col rounded-fs-xl bg-white p-6 text-left shadow-fs-ring sm:p-9">
            <h2 className="text-[28px] font-bold tracking-[-0.03em]">
              {inSeason ? 'The Weekly Field Guide' : 'The Pre Draft Field Guide'}
            </h2>
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
                <div key={g.pos} className={cn('flex items-center gap-3 py-3', i < 3 && 'border-b-1 border-fs-line')}>
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
      </main>

      <footer className="border-t-1 border-fs-line-strong bg-white">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-10 px-4 pb-10 pt-14 sm:px-10 md:flex-row md:justify-between">
          <div className="flex flex-col items-start gap-4">
            <Logo tile={28} word={15} />
            <p className="max-w-[280px] text-[15px] font-medium leading-normal text-fs-text-3">
              The first fantasy football platform that is just fantasy football. Powered by Scout AI.
            </p>
            <CreateAccountButton size="md" />
          </div>
          <nav aria-label="On this page" className="flex flex-col gap-3">
            <div className="text-[13px] font-semibold text-fs-ink">On this page</div>
            <div className="grid grid-cols-2 gap-x-10 gap-y-3">
              {ON_THIS_PAGE.map((l) => (
                <a key={l.href} href={l.href} className="text-[14px] font-medium text-fs-text-2 hover:text-fs-blue">
                  {l.label}
                </a>
              ))}
            </div>
          </nav>
        </div>
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-3 border-t-1 border-fs-line px-4 pb-7 pt-5 text-[12.5px] font-medium text-fs-text-3 sm:px-10">
          <span>© 2026 FieldScout. All rights reserved.</span>
          <Link href="/login" scroll={false} className="ml-auto font-semibold text-fs-ink hover:text-fs-blue">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  )
}
