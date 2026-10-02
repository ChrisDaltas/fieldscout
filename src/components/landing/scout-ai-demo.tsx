'use client'

import { CheckDisc, PosTag, ScoutDot } from '@/components/landing/landing-bits'
import {
  FIND_RESULTS,
  FIND_SCRIPT,
  SIT_FACTORS,
  SIT_SCRIPT,
  type DemoScript,
} from '@/components/landing/landing-data'
import { useDemoClock } from '@/hooks/use-demo-clock'
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion'
import { cn } from '@/lib/utils'

/* ---------- shared scripted-prompt machinery (also used by LineupDemo) ---------- */

export function scriptTimes(s: DemoScript) {
  const typed = s.typeMs + 400
  const result = typed + s.steps.length * s.stepMs + 300
  return { typed, result, end: result + s.holdMs }
}

/** Runs a script's clock. Paused or reduced-motion → parked on the answer. */
export function useScript(script: DemoScript, playing: boolean, onDone?: () => void) {
  const reduced = usePrefersReducedMotion()
  const times = scriptTimes(script)
  const live = playing && !reduced
  const clock = useDemoClock({
    loopMs: times.end,
    playing: live,
    passMs: times.result,
    onPass: onDone,
  })
  const t = live ? clock : times.result + 1500
  return { t, ...times }
}

/** White demo window with the "Scout AI" title bar. */
export function DemoWindow({
  label,
  context,
  children,
}: {
  label: string
  context: string
  children: React.ReactNode
}) {
  return (
    <div className="w-full overflow-hidden rounded-fs-xl bg-white text-left font-inter text-fs-ink shadow-fs-float [font-variant-numeric:tabular-nums]">
      <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center border-b-1 border-fs-line bg-fs-raised px-5">
        <div className="flex items-center gap-2">
          <ScoutDot />
          <span className="text-[15px] font-semibold">Scout AI</span>
        </div>
        <div className="whitespace-nowrap text-[13px] font-semibold text-fs-text-3">{label}</div>
        <div className="hidden justify-self-end whitespace-nowrap text-[13px] font-medium text-fs-text-3 sm:block">
          {context}
        </div>
      </div>
      <div className="h-[440px] overflow-hidden px-4 py-5 sm:h-[480px] sm:px-7 sm:py-6">{children}</div>
    </div>
  )
}

/** Typing prompt box → running checks → `children` (the answer). */
export function ScriptedPrompt({
  script,
  t,
  typed: tTyped,
  result: tResult,
  thinkingLabel,
  summary,
  children,
}: {
  script: DemoScript
  t: number
  typed: number
  result: number
  thinkingLabel: string
  summary: string
  children: React.ReactNode
}) {
  const chars = Math.min(script.prompt.length, Math.floor((t / script.typeMs) * script.prompt.length))
  const showResult = t >= tResult
  const steps = script.steps
    .map(([text, detail], i) => ({
      text,
      detail,
      visible: t >= tTyped + i * script.stepMs,
      done: t >= tTyped + (i + 1) * script.stepMs,
    }))
    .filter((s) => s.visible)

  return (
    <>
      <div className="flex h-14 items-center gap-3 rounded-[14px] bg-fs-page pl-5 pr-2.5">
        <div className="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap text-[15px] font-medium sm:text-[17px]">
          {chars === 0 && <span className="text-fs-text-4">Ask Scout AI</span>}
          <span className="truncate">{script.prompt.slice(0, chars)}</span>
          {t < tTyped && (
            <span className="ml-px h-5 w-0.5 flex-none animate-fs-blink bg-fs-blue" aria-hidden="true" />
          )}
        </div>
        <div
          aria-hidden="true"
          className={cn(
            'flex size-9 flex-none items-center justify-center rounded-full text-[18px] font-bold text-white transition-colors',
            chars >= script.prompt.length ? 'bg-fs-blue' : 'bg-fs-fill-off',
          )}
        >
          ↑
        </div>
      </div>

      {t >= tTyped && !showResult && (
        <>
          <div className="mt-[22px] flex flex-col gap-1 px-1.5">
            {steps.map((s) => (
              <div key={s.text} className="flex h-[34px] items-center gap-3">
                {s.done ? (
                  <>
                    <CheckDisc />
                    <span className="truncate text-[15px] font-medium text-fs-text-3">{s.text}</span>
                    <span className="ml-auto hidden whitespace-nowrap text-[13px] font-semibold sm:inline">
                      {s.detail}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="mx-0.5 size-3 flex-none animate-spin rounded-full border-2 border-fs-fill border-t-fs-violet-scout" />
                    <span className="truncate text-[15px] font-semibold">{s.text}…</span>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3.5 flex items-center gap-2 px-1.5 text-[13px] font-medium text-fs-text-3">
            <ScoutDot size={6} />
            {thinkingLabel} · {(Math.max(0, Math.min(t, tResult) - tTyped) / 1000).toFixed(1)}s
          </div>
        </>
      )}

      {showResult && (
        <>
          <div className="mt-4 flex items-center gap-2 px-1.5 text-[13px] font-medium text-fs-text-3">
            <CheckDisc size={16} />
            {summary}
          </div>
          {children}
        </>
      )}
    </>
  )
}

/* ---------- Scout AI demo ---------- */

/**
 * Scout AI demo window (Claude Design ScoutAIDemo). `mode="find"` builds a
 * player list; `mode="sit"` makes a start-or-sit call. Scripted, not live.
 */
export function ScoutAIDemo({
  mode,
  playing = true,
  onDone,
}: {
  mode: 'find' | 'sit'
  playing?: boolean
  onDone?: () => void
}) {
  const script = mode === 'find' ? FIND_SCRIPT : SIT_SCRIPT
  const { t, typed, result } = useScript(script, playing, onDone)

  return (
    <DemoWindow
      label={mode === 'find' ? 'Find players' : 'Weekly projections'}
      context="Week 4 · your league"
    >
      <ScriptedPrompt
        script={script}
        t={t}
        typed={typed}
        result={result}
        thinkingLabel="Scout AI is thinking"
        summary={`Thought for ${((result - typed) / 1000).toFixed(1)}s · ${script.steps.length} checks`}
      >
        {mode === 'find' ? <FindResult t={t - result} /> : <SitResult />}
      </ScriptedPrompt>
    </DemoWindow>
  )
}

function FindResult({ t }: { t: number }) {
  return (
    <div className="mt-3.5 overflow-hidden rounded-[16px] shadow-fs-inset">
      <div>
        <div className="grid h-9 grid-cols-[24px_minmax(0,1fr)_64px] sm:grid-cols-[32px_minmax(0,1fr)_72px_84px_84px] items-center bg-fs-raised px-[18px] text-[12px] font-semibold text-fs-text-3">
          <span>#</span>
          <span>Available WR</span>
          <span className="text-right">Targets</span>
          <span className="hidden text-right sm:block">Tgt share</span>
          <span className="hidden text-right sm:block">Rostered</span>
        </div>
        {FIND_RESULTS.map((r, i) => {
          const on = t >= i * 140
          return (
            <div
              key={r.name}
              className={cn(
                'grid h-[46px] grid-cols-[24px_minmax(0,1fr)_64px] sm:grid-cols-[32px_minmax(0,1fr)_72px_84px_84px] items-center border-t-1 border-fs-line px-[18px] transition-[opacity,transform] duration-300',
                on ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
              )}
            >
              <span className="text-[14px] font-semibold text-fs-text-4">{i + 1}</span>
              <div className="flex min-w-0 items-center gap-2.5">
                <PosTag pos="WR" />
                <span className="truncate text-[15px] font-semibold sm:text-[16px]">{r.name}</span>
                <span className="hidden text-[13px] font-medium text-fs-text-3 sm:inline">{r.team}</span>
              </div>
              <span className="text-right text-[17px] font-bold text-fs-blue">{r.tgt}</span>
              <span className="hidden text-right text-[14px] font-semibold sm:block">{r.share}</span>
              <span className="hidden text-right text-[14px] font-medium text-fs-text-3 sm:block">{r.rost}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SitResult() {
  return (
    <div className="mt-3.5 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
      <div className="rounded-[16px] p-6 shadow-fs-inset">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-[22px] items-center gap-1.5 rounded-pill bg-fs-ink px-[9px] text-[12px] font-bold text-white">
            <ScoutDot size={6} />
            Scout AI call
          </span>
          <span className="text-[13px] font-medium text-fs-text-3">74% confidence</span>
        </div>
        <div className="mt-3.5 text-[28px] font-bold sm:text-[34px] leading-[1.05] tracking-[-0.035em]">
          Start Jaylen Waddle.
        </div>
        <div className="mt-2.5 text-pretty text-[16px] font-medium leading-normal text-fs-text-3">
          Miami is implied for 25.3 points against a defense allowing the 3rd-most WR points, and
          Waddle owns a 26% target share.
        </div>
        <div className="mt-[18px] flex flex-wrap gap-1.5">
          {SIT_FACTORS.map((f) => (
            <span
              key={f}
              className="inline-flex h-[26px] items-center rounded-pill bg-fs-page px-2.5 text-[12.5px] font-semibold"
            >
              {f}
            </span>
          ))}
        </div>
      </div>
      <div className="hidden rounded-[16px] bg-fs-page p-6 sm:block">
        <div className="text-[13px] font-semibold text-fs-text-3">Projected points</div>
        <ProjBar name="Jaylen Waddle" value="14.8" width="100%" lead />
        <ProjBar name="Jakobi Meyers" value="10.9" width="74%" />
        <div className="mt-[22px] border-t-1 border-fs-fill pt-3.5 text-[12.5px] font-medium leading-snug text-fs-text-3">
          MIA @ LV · Sunday 4:05 PM · Dome
        </div>
      </div>
    </div>
  )
}

function ProjBar({
  name,
  value,
  width,
  lead = false,
}: {
  name: string
  value: string
  width: string
  lead?: boolean
}) {
  return (
    <div className={lead ? 'mt-[18px]' : 'mt-5'}>
      <div className="flex items-baseline justify-between">
        <span className="text-[15px] font-semibold">{name}</span>
        <span className={cn('text-[22px] font-bold tracking-[-0.02em]', lead && 'text-fs-blue')}>
          {value}
        </span>
      </div>
      <div className="mt-2 h-2 rounded-[4px] bg-fs-fill">
        <div
          className={cn('h-full rounded-[4px]', lead ? 'bg-fs-blue' : 'bg-fs-text-5')}
          style={{ width }}
        />
      </div>
    </div>
  )
}
