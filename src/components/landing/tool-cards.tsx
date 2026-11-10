import { PosTag, ScoutDot } from '@/components/landing/landing-bits'
import { SAMPLE_WEEK, seasonCount, seasonRecord } from '@/components/landing/landing-data'
import { YouBadge } from '@/components/landing/league-home-preview'
import { cn } from '@/lib/utils'

/**
 * "Everything your league needs" — Scout AI and the six tools around it.
 * From tablet up it is a grid that shows every card at once (it was a
 * sideways-scrolling row that hid four of the seven), with Scout AI and
 * Advanced stats as the wide tiles. Phones keep the swipeable row.
 * Card contents are the v13 design's; static illustrations.
 */

type Tone = 'ink' | 'white' | 'green'

function Card({
  tone,
  eyebrow,
  title,
  wide,
  children,
}: {
  tone: Tone
  eyebrow: React.ReactNode
  title: string
  /** Two columns wide from this breakpoint up: heading left, widget right. */
  wide?: 'md' | 'xl'
  children: React.ReactNode
}) {
  return (
    <article
      className={cn(
        'relative flex min-h-[400px] w-[82vw] max-w-[360px] flex-none snap-start flex-col overflow-hidden rounded-fs-xl p-6 sm:p-8 md:min-h-[340px] md:w-auto md:max-w-none',
        wide === 'md' && 'md:col-span-2 md:flex-row md:items-end md:gap-10',
        wide === 'xl' && 'xl:col-span-2 xl:flex-row xl:items-end xl:gap-10',
        tone === 'ink' && 'bg-fs-ink text-white',
        tone === 'white' && 'bg-white text-fs-ink shadow-fs-ring',
        tone === 'green' && 'bg-fs-green text-fs-ink',
      )}
    >
      <div className={cn(wide === 'md' && 'md:flex-1 md:self-start', wide === 'xl' && 'xl:flex-1 xl:self-start')}>
        <div
          className={cn(
            'flex items-center gap-2 text-[14px] font-semibold',
            tone === 'ink' && 'text-fs-on-ink-2',
            tone === 'white' && 'text-fs-text-3',
          )}
        >
          {eyebrow}
        </div>
        <h3
          className={cn(
            'mt-2 text-[26px] font-bold leading-[1.15] tracking-[-0.03em]',
            wide === 'md' && 'md:max-w-[380px] md:text-[36px] md:leading-[1.08]',
            wide === 'xl' && 'xl:max-w-[300px]',
          )}
        >
          {title}
        </h3>
      </div>
      <div
        className={cn(
          'mt-auto pt-8',
          wide === 'md' && 'md:mt-0 md:w-[320px] md:flex-none md:pt-0',
          wide === 'xl' && 'xl:mt-0 xl:w-[340px] xl:flex-none xl:pt-0',
        )}
      >
        {children}
      </div>
    </article>
  )
}

const inset = 'rounded-[16px] bg-fs-page px-4 py-1'

export function ToolCards({ week = SAMPLE_WEEK }: { week?: number }) {
  return (
    <div
      className={cn(
        // Phones: a swipeable row that bleeds to the screen edges.
        '-mx-4 mt-9 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 [scroll-padding-left:16px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // Tablet and up: a grid showing every card.
        'md:mx-auto md:mt-11 md:grid md:max-w-[1120px] md:grid-cols-2 md:gap-5 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-3',
      )}
    >
      <Card
        wide="md"
        tone="ink"
        eyebrow={
          <span className="flex items-center gap-2 text-fs-on-ink-3">
            <ScoutDot />
            Meet Scout AI
          </span>
        }
        title="Your analyst for every question, all season."
      >
        <div className="flex flex-col items-start gap-2">
          {["Who's available at TE?", 'Start Waddle or Meyers?', 'Best pick at 2.04?'].map((q) => (
            <span key={q} className="inline-flex h-[38px] items-center rounded-pill bg-fs-ink-2 px-3.5 text-[14px] font-medium">
              {q}
            </span>
          ))}
          <div className="mt-2 flex h-[46px] w-full items-center gap-2.5 rounded-fs-md bg-white pl-4 pr-2 text-[14px] font-medium text-fs-text-4">
            Ask Scout AI
            <span className="ml-auto flex size-[30px] items-center justify-center rounded-full bg-fs-blue text-[15px] font-bold animate-fs-scout-hue motion-reduce:animate-none">
              <span className="text-white">↑</span>
            </span>
          </div>
        </div>
      </Card>

      <Card tone="white" eyebrow="Full leagues" title="Run your whole league on FieldScout.">
        <div className={inset}>
          {[
            { n: 1, name: 'Gridiron Gurus', rec: seasonRecord(3, week) },
            { n: 2, name: 'Your team', rec: seasonRecord(2, week), you: true },
            { n: 3, name: 'Bijan Mustard', rec: seasonRecord(2, week) },
          ].map((r, i) => (
            <div
              key={r.name}
              className={cn('flex items-center gap-2.5 py-[11px]', i < 2 && 'border-b-1 border-fs-fill')}
            >
              <span className="text-[13px] font-semibold text-fs-text-4">{r.n}</span>
              <span className="text-[15px] font-semibold">{r.name}</span>
              {r.you && <YouBadge />}
              <span className="ml-auto text-[14px] font-semibold">{r.rec}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card tone="ink" eyebrow="Live drafts" title="Draft live, with Scout AI on the clock with you.">
        <div className="rounded-[16px] bg-fs-ink-2 p-[18px]">
          <div className="flex items-center">
            <span className="text-[13px] font-semibold text-fs-on-ink-2">On the clock · Round 2, pick 4</span>
            <span className="ml-auto text-[20px] font-bold text-fs-green">0:42</span>
          </div>
          <div className="mt-3.5 flex items-center gap-2.5">
            <PosTag pos="TE" />
            <span className="text-[16px] font-semibold">Brock Bowers</span>
            <span className="ml-auto text-[12px] font-semibold text-fs-on-ink-2">ADP 16.2</span>
          </div>
          <div className="mt-3 text-[13px] font-medium leading-snug text-fs-on-ink-3">
            Scout AI pick: you&apos;re thin at TE and he&apos;s the last one in tier 1.
          </div>
        </div>
      </Card>

      <Card tone="white" eyebrow="Expert & consensus rankings" title="Scout AI's take, side by side with the consensus.">
        <div className={inset}>
          <div className="grid grid-cols-[minmax(0,1fr)_64px_76px] pb-1.5 pt-2.5 text-[11.5px] font-semibold text-fs-text-3">
            <span>WR</span>
            <span className="text-right">Scout AI</span>
            <span className="text-right">Consensus</span>
          </div>
          {[
            ['Puka Nacua', 4, 7],
            ['Nico Collins', 9, 11],
            ['Jaylen Waddle', 14, 19],
          ].map(([name, ai, cons]) => (
            <div key={name} className="grid grid-cols-[minmax(0,1fr)_64px_76px] items-center border-t-1 border-fs-fill py-[9px]">
              <span className="text-[15px] font-semibold">{name}</span>
              <span className="text-right text-[15px] font-bold text-fs-blue">{ai}</span>
              <span className="text-right text-[15px] font-medium text-fs-text-3">{cons}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card tone="green" eyebrow="Waiver wire reports" title="Who to add and who to watch, every Tuesday morning.">
        <div className="flex flex-col gap-2">
          {[
            { act: 'Add', name: "Wan'Dale Robinson", stat: `${seasonCount(29, week)} tgts` },
            { act: 'Add', name: 'Jalen Coker', stat: `${seasonCount(26, week)} tgts` },
            { act: 'Watch', name: 'Harold Fannin Jr.' },
          ].map((r) => (
            <div
              key={r.name}
              className={cn(
                'flex h-12 items-center gap-2.5 rounded-fs-md px-3.5',
                r.act === 'Watch' ? 'bg-white/60' : 'bg-white',
              )}
            >
              <span className="w-12 text-[12px] font-bold">{r.act}</span>
              <span className="text-[15px] font-semibold">{r.name}</span>
              {r.stat && <span className="ml-auto text-[12px] font-semibold">{r.stat}</span>}
            </div>
          ))}
        </div>
      </Card>

      <Card tone="white" eyebrow="Start or sit" title="One call, with the numbers that made it.">
        <div className="flex flex-col gap-2">
          {[
            { call: 'Start', name: 'Jaylen Waddle', proj: '14.8', start: true },
            { call: 'Sit', name: 'Jakobi Meyers', proj: '10.9' },
          ].map((r) => (
            <div key={r.name} className="flex h-12 items-center gap-2.5 rounded-fs-md bg-fs-page px-3.5">
              <span
                className={cn(
                  'inline-flex h-6 w-11 items-center justify-center rounded-pill text-[12px] font-bold text-fs-ink',
                  r.start ? 'bg-fs-green' : 'bg-fs-fill-strong',
                )}
              >
                {r.call}
              </span>
              <span className="text-[15px] font-semibold">{r.name}</span>
              <span className={cn('ml-auto text-[14px]', r.start ? 'font-bold text-fs-blue' : 'font-semibold text-fs-text-3')}>
                {r.proj}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card wide="xl" tone="white" eyebrow="Advanced stats & metrics" title="The numbers that matter, readable at a glance.">
        <div className="rounded-[16px] bg-fs-page p-5">
          <div className="text-[15px] font-bold">Puka Nacua</div>
          {[
            ['Target share', '31%', 31],
            ['YPRR percentile', '96', 96],
            ['Snap %', '92%', 92],
          ].map(([label, value, w]) => (
            <div key={label}>
              <div className="mt-3 flex justify-between text-[12.5px] font-medium text-fs-text-3">
                <span>{label}</span>
                <span className="font-semibold text-fs-ink">{value}</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-[3px] bg-fs-fill">
                <div className="h-full rounded-[3px] bg-fs-blue" style={{ width: `${w}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
