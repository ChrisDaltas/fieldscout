import { PosTag, ScoutDot } from '@/components/landing/landing-bits'
import { YouBadge } from '@/components/landing/league-home-preview'
import { cn } from '@/lib/utils'

/**
 * "The future is finally here" — six tools as a horizontal snap-scroll row
 * of cards (Claude Design FieldScout Landing v13). Static illustrations.
 */

type Tone = 'ink' | 'white' | 'green'

function Card({
  tone,
  eyebrow,
  title,
  children,
}: {
  tone: Tone
  eyebrow: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <article
      className={cn(
        'relative flex h-[460px] w-[min(360px,82vw)] flex-none snap-start flex-col overflow-hidden rounded-fs-xl p-8',
        tone === 'ink' && 'bg-fs-ink text-white',
        tone === 'white' && 'bg-white text-fs-ink shadow-fs-ring',
        tone === 'green' && 'bg-fs-green text-fs-ink',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 text-[14px] font-semibold',
          tone === 'ink' && 'text-fs-on-ink-2',
          tone === 'white' && 'text-fs-text-3',
        )}
      >
        {eyebrow}
      </div>
      <h3 className="mt-2 text-[26px] font-bold leading-[1.15] tracking-[-0.03em]">{title}</h3>
      <div className="mt-auto">{children}</div>
    </article>
  )
}

const inset = 'rounded-[16px] bg-fs-page px-4 py-1'

export function ToolCards() {
  return (
    <div className="mt-11 flex snap-x snap-mandatory gap-5 overflow-x-auto px-[clamp(24px,11vw,160px)] pb-5 [scroll-padding-left:clamp(24px,11vw,160px)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Card
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
            { n: 1, name: 'Gridiron Gurus', rec: '3–0' },
            { n: 2, name: 'Your team', rec: '2–1', you: true },
            { n: 3, name: 'Bijan Mustard', rec: '2–1' },
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
            { act: 'Add', name: "Wan'Dale Robinson", stat: '29 tgts' },
            { act: 'Add', name: 'Jalen Coker', stat: '26 tgts' },
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

      <Card tone="white" eyebrow="Advanced stats & metrics" title="The numbers that matter, readable at a glance.">
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

      <div className="w-[140px] flex-none" aria-hidden="true" />
    </div>
  )
}
