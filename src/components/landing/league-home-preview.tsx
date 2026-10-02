import { LogoTile, Wordmark } from '@/components/landing/fieldscout-logo'
import { ScoutDot, WindowBar } from '@/components/landing/landing-bits'
import { cn } from '@/lib/utils'

/**
 * Static "League home" product shot on the landing page (Claude Design
 * FieldScout Landing v13, "Introducing FieldScout"). Illustrative content
 * only — leagues are not open to visitors yet.
 */

const NAV = ['League home', 'My team', 'Matchups', 'Players', 'Draft room', 'Scout AI']
const LEAGUES = [
  { name: 'Gridiron Gurus', record: '2–1', on: true },
  { name: 'Work league', record: '1–2' },
  { name: 'Dynasty', record: '3–0' },
]
const STANDINGS = [
  { name: 'Gridiron Gurus', record: '3–0', pf: '402.1' },
  { name: 'Your team', record: '2–1', pf: '388.4', you: true },
  { name: 'Bijan Mustard', record: '2–1', pf: '371.0' },
  { name: 'Puka Shells', record: '2–1', pf: '365.2' },
  { name: 'Mahomes Alone', record: '1–2', pf: '344.8' },
]
const ACTIVITY = [
  { text: "Puka Shells added Wan'Dale Robinson", when: '2h', dot: 'bg-fs-green' },
  { text: 'Bijan Mustard and Mahomes Alone made a trade', when: 'Yesterday', dot: 'bg-fs-blue' },
  { text: "This week's waiver wire report is out", when: 'Tue 8 AM', dot: 'bg-fs-text-5' },
  { text: 'Week 3 recap: you won 121.4 to 98.7', when: 'Mon', dot: 'bg-fs-text-5' },
]

export function YouBadge() {
  return (
    <span className="inline-flex h-[18px] items-center rounded-pill bg-fs-blue px-1.5 text-[10.5px] font-bold text-white">
      You
    </span>
  )
}

export function LeagueHomePreview() {
  return (
    <div className="mx-auto mt-14 max-w-[1120px] overflow-hidden rounded-[22px] bg-white shadow-fs-float">
      <WindowBar title="League home" />
      <div>
        <div className="grid xl:min-h-[620px] xl:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden flex-col xl:flex gap-0.5 border-r-1 border-fs-line bg-fs-page px-3 py-4">
            <div className="flex items-center gap-2 px-2.5 pb-4 pt-1">
              <LogoTile size={22} />
              <Wordmark height={11} />
            </div>
            {NAV.map((label, i) => (
              <div
                key={label}
                className={cn(
                  'flex h-[34px] items-center gap-2.5 rounded-fs-sm px-2.5 text-[14px]',
                  i === 0 ? 'bg-white font-semibold text-fs-ink shadow-fs-seg' : 'font-medium text-fs-ink-3',
                )}
              >
                <span className={cn('size-4 rounded-[5px]', i === 0 ? 'bg-fs-blue' : 'bg-fs-fill-strong')} />
                {label}
              </div>
            ))}
            <div className="mx-2.5 mb-1.5 mt-[18px] text-[12px] font-semibold text-fs-text-4">Leagues</div>
            {LEAGUES.map((l) => (
              <div
                key={l.name}
                className={cn(
                  'flex h-8 items-center gap-2.5 rounded-fs-sm px-2.5 text-[13.5px]',
                  l.on ? 'bg-fs-blue-soft font-semibold text-fs-blue-deep' : 'font-medium text-fs-ink-3',
                )}
              >
                <span className={cn('size-5 rounded-[6px]', l.on ? 'bg-fs-green' : 'bg-fs-fill')} />
                {l.name}
                <span className="ml-auto text-[12px] text-fs-text-3">{l.record}</span>
              </div>
            ))}
          </aside>

          <div className="min-w-0 px-4 pb-5 pt-5 text-fs-ink sm:px-8 sm:pb-8 sm:pt-7">
            <div className="flex items-end gap-4">
              <div>
                <div className="text-[24px] font-bold tracking-[-0.03em] sm:text-[28px]">Gridiron Gurus</div>
                <div className="mt-0.5 text-[14px] font-medium text-fs-text-3">12 teams · PPR · Week 4</div>
              </div>
              <div className="ml-auto hidden h-[34px] sm:inline-flex items-center gap-2 rounded-pill bg-fs-page px-3.5 text-[13.5px] font-semibold">
                <ScoutDot size={7} />
                Ask Scout AI
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:mt-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                <div className="rounded-fs-lg bg-white p-4 shadow-fs-ring sm:p-[22px]">
                  <div className="flex items-center">
                    <span className="text-[13px] font-semibold text-fs-text-3">Your matchup · Week 4</span>
                    <span className="ml-auto text-[12px] font-medium text-fs-text-3">Sun 1:00 PM</span>
                  </div>
                  <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
                    <TeamScore name="Your team" meta="2–1 · 2nd" score="118.6" lead />
                    <div className="text-[13px] font-semibold text-fs-text-5">vs</div>
                    <TeamScore name="Bijan Mustard" meta="2–1 · 3rd" score="109.2" right />
                  </div>
                  <div className="mt-4 flex justify-between text-[12.5px] font-semibold">
                    <span className="text-fs-blue">Win prob 63%</span>
                    <span className="text-fs-text-3">37%</span>
                  </div>
                  <div className="mt-1.5 flex h-2 overflow-hidden rounded-[4px] bg-fs-fill">
                    <div className="w-[63%] bg-fs-blue" />
                  </div>
                </div>

                <div className="overflow-hidden rounded-fs-lg bg-white shadow-fs-ring">
                  <div className="flex items-center px-[18px] pb-3 pt-4">
                    <span className="text-[16px] font-bold">Standings</span>
                    <span className="ml-auto text-[12px] font-semibold text-fs-text-3">W–L &nbsp; PF</span>
                  </div>
                  {STANDINGS.map((s, i) => (
                    <div
                      key={s.name}
                      className={cn(
                        'grid h-[42px] grid-cols-[20px_minmax(0,1fr)_36px_48px] items-center border-t-1 border-fs-line px-4 sm:grid-cols-[28px_minmax(0,1fr)_56px_72px] sm:px-[18px]',
                        s.you && 'bg-fs-blue-wash',
                      )}
                    >
                      <span className="text-[13px] font-semibold text-fs-text-4">{i + 1}</span>
                      <span className="flex min-w-0 items-center gap-2 truncate text-[14.5px] font-semibold">
                        {s.name}
                        {s.you && <YouBadge />}
                      </span>
                      <span className="text-right text-[14px] font-semibold">{s.record}</span>
                      <span className="text-right text-[13.5px] font-medium text-fs-text-3">{s.pf}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-4">
                <div className="rounded-fs-lg bg-fs-ink p-[22px] text-white">
                  <span className="inline-flex h-[22px] items-center gap-1.5 rounded-pill bg-fs-ink-2 px-[9px] text-[12px] font-bold">
                    <ScoutDot size={6} />
                    Scout AI · your team
                  </span>
                  <div className="mt-3.5 text-[20px] font-bold leading-tight tracking-[-0.02em]">
                    Start Jaylen Waddle over Jakobi Meyers.
                  </div>
                  <div className="mt-2 text-[14px] font-medium leading-[1.45] text-fs-on-ink-2">
                    MIA is implied for 25.3 points and Waddle owns a 26% target share. 74% confidence.
                  </div>
                  <div className="mt-4 flex items-center gap-2.5 border-t-1 border-fs-ink-3 pt-3.5">
                    <span className="whitespace-nowrap text-[13px] font-medium text-fs-on-ink-2">Waiver add</span>
                    <span className="text-[14px] font-semibold">Wan&apos;Dale Robinson</span>
                    <span className="ml-auto whitespace-nowrap text-[12.5px] font-semibold text-fs-green">29 tgts</span>
                  </div>
                </div>

                <div className="rounded-fs-lg bg-white px-[18px] pb-1.5 pt-4 shadow-fs-ring">
                  <div className="pb-1 text-[16px] font-bold">League activity</div>
                  {ACTIVITY.map((a) => (
                    <div key={a.text} className="flex gap-3 border-t-1 border-fs-line py-3">
                      <span className={cn('mt-1.5 size-2 flex-none rounded-full', a.dot)} />
                      <div className="min-w-0 flex-1 text-[14px] font-medium leading-snug">{a.text}</div>
                      <span className="whitespace-nowrap text-[12px] font-medium text-fs-text-3">{a.when}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TeamScore({
  name,
  meta,
  score,
  lead = false,
  right = false,
}: {
  name: string
  meta: string
  score: string
  lead?: boolean
  right?: boolean
}) {
  return (
    <div className={cn(right && 'text-right')}>
      <div className="text-[17px] font-bold">{name}</div>
      <div className="text-[12.5px] font-medium text-fs-text-3">{meta}</div>
      <div className={cn('mt-2 text-[28px] font-bold sm:text-[34px] tracking-[-0.03em]', lead && 'text-fs-blue')}>{score}</div>
      <div className="text-[12px] font-medium text-fs-text-3">Projected</div>
    </div>
  )
}
