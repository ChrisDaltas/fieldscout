'use client'

import { PosTag, ScoutDot } from '@/components/landing/landing-bits'
import { LINEUP_ROSTER, LINEUP_SCRIPT } from '@/components/landing/landing-data'
import { DemoWindow, ScriptedPrompt, useScript } from '@/components/landing/scout-ai-demo'
import { cn } from '@/lib/utils'

/**
 * Lineup-adjustment demo (Claude Design LineupDemo): Scout AI arms a
 * conditional swap. Scripted marketing demo, not live.
 */
export function LineupDemo({ playing = true, onDone }: { playing?: boolean; onDone?: () => void }) {
  const { t, typed, result } = useScript(LINEUP_SCRIPT, playing, onDone)
  const cardOn = t >= result + 300

  return (
    <DemoWindow label="Lineup adjustments" context="Week 4 · your team">
      <ScriptedPrompt
        script={LINEUP_SCRIPT}
        t={t}
        typed={typed}
        result={result}
        thinkingLabel="Scout AI is setting it up"
        summary={`Agent Scout move added · ${LINEUP_SCRIPT.steps.length} checks`}
      >
        <div className="mt-3 overflow-hidden rounded-[16px] shadow-fs-inset">
          <div className="flex items-baseline gap-2.5 px-4 pb-2.5 pt-3">
            <span className="text-[16px] font-bold">Your team</span>
            <span className="text-[12.5px] font-medium text-fs-text-3">Gridiron Gurus · 2–1</span>
          </div>

          <div
            className={cn(
              'mx-3 rounded-fs-md bg-fs-ink px-3.5 py-3 text-white transition-[opacity,transform] duration-300',
              cardOn ? 'translate-y-0 opacity-100' : '-translate-y-1.5 opacity-0',
            )}
          >
            <div className="flex items-center gap-2">
              <ScoutDot size={7} />
              <span className="text-[13px] font-bold">Agent Scout moves</span>
              <span className="ml-auto text-[11.5px] font-semibold text-fs-on-ink-2">1 active</span>
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold leading-snug">
                  If Justin Jefferson is ruled out, start Jordan Addison at WR
                </div>
                <div className="mt-0.5 text-[12px] font-medium text-fs-on-ink-2">
                  Checks inactives Sun 11:30 AM ET
                </div>
              </div>
              <span className="inline-flex h-[22px] flex-none items-center rounded-pill bg-fs-ink-2 px-[9px] text-[11.5px] font-bold text-fs-green">
                Armed
              </span>
              <span className="relative h-6 w-10 flex-none rounded-pill bg-fs-green" aria-hidden="true">
                <span className="absolute right-0.5 top-0.5 size-5 rounded-full bg-white shadow-fs-seg" />
              </span>
            </div>
          </div>

          <div className="mt-2">
            {LINEUP_ROSTER.map((p) => (
              <div
                key={p.name}
                className={cn(
                  'grid h-9 grid-cols-[44px_minmax(0,1fr)_auto_48px] items-center gap-2.5 border-t-1 border-fs-page px-4',
                  p.tag && 'bg-fs-violet-wash',
                )}
              >
                <PosTag pos={p.slot} className="w-full" />
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[14px] font-semibold">{p.name}</span>
                  <span className="text-[12px] font-medium text-fs-text-3">{p.team}</span>
                  {p.questionable && (
                    <span className="inline-flex h-[18px] items-center rounded-fs-xs bg-fs-caution px-1.5 text-[10.5px] font-bold">
                      Q
                    </span>
                  )}
                </div>
                {p.tag ? (
                  <span className="hidden h-5 items-center gap-[5px] whitespace-nowrap rounded-pill bg-fs-violet-soft px-2 text-[11px] font-bold text-fs-violet sm:inline-flex">
                    <span className="size-[5px] rounded-full bg-fs-violet-scout animate-fs-scout-hue motion-reduce:animate-none" />
                    {p.tag}
                  </span>
                ) : (
                  <span />
                )}
                <span className="text-right text-[13.5px] font-semibold">{p.proj}</span>
              </div>
            ))}
          </div>
        </div>
      </ScriptedPrompt>
    </DemoWindow>
  )
}
