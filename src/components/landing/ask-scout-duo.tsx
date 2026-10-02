'use client'

import { useEffect, useRef, useState } from 'react'

import { LineupDemo } from '@/components/landing/lineup-demo'
import { ScoutAIDemo } from '@/components/landing/scout-ai-demo'
import { cn } from '@/lib/utils'

const W = 720 // demo window's native width
const H = 537 // and height
const GAP = 32

const PANELS = [
  { key: 'a', title: 'Weekly projections', sub: 'Start or sit, with every check shown.' },
  { key: 'b', title: 'Lineup adjustments', sub: 'Tell Scout what to do. It handles the rest.' },
] as const

/**
 * Two Scout AI demos side by side in a centred carousel (Claude Design
 * AskScoutDuo). The active one plays when the section is in view; when it
 * reaches its answer the carousel waits 3s and moves to the other. Clicking
 * the dimmed panel or a dot switches straight away.
 */
export function AskScoutDuo() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)
  const [active, setActive] = useState<0 | 1>(0)
  const [hover, setHover] = useState<0 | 1 | null>(null)
  const [inView, setInView] = useState(false)
  const flip = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.intersectionRatio >= 0.6) setInView(true)
        else if (e.intersectionRatio < 0.2) {
          clearTimeout(flip.current)
          setInView(false)
        }
      },
      { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
    )
    io.observe(el)
    return () => {
      ro.disconnect()
      io.disconnect()
      clearTimeout(flip.current)
    }
  }, [])

  const pick = (i: 0 | 1) => {
    clearTimeout(flip.current)
    setActive(i)
    setHover(null)
  }
  const queueFlip = (from: 0 | 1) => {
    clearTimeout(flip.current)
    flip.current = setTimeout(() => setActive((cur) => (cur === from ? ((1 - from) as 0 | 1) : cur)), 3000)
  }

  // Phones: panels go near full width at native size (no scaling — scaled
  // text is unreadable); the neighbour peeks in from the side.
  const narrow = width < 640
  const touchX = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0].clientX
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    touchX.current = null
    if (dx < -40 && active === 0) pick(1)
    else if (dx > 40 && active === 1) pick(0)
  }

  const cw = Math.max(320, width)
  const pw = narrow ? cw - 48 : Math.floor(Math.min(W, cw * 0.8))
  const scale = narrow ? 1 : pw / W
  const tx = Math.round(cw / 2 - pw / 2 - active * (pw + GAP))

  return (
    <div
      ref={wrapRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="w-full touch-pan-y overflow-hidden pb-6 pt-2 font-inter text-fs-ink"
    >
      <div
        className="flex transition-transform duration-700 ease-[cubic-bezier(.2,.8,.2,1)]"
        style={{ gap: narrow ? 16 : GAP, transform: `translateX(${narrow ? Math.round(cw / 2 - pw / 2 - active * (pw + 16)) : tx}px)` }}
      >
        {PANELS.map((p, i) => {
          const on = active === i
          return (
            <div
              key={p.key}
              onClick={on ? undefined : () => pick(i as 0 | 1)}
              onMouseEnter={() => setHover(i as 0 | 1)}
              onMouseLeave={() => setHover(null)}
              className={cn(
                'flex-none transition-opacity duration-500',
                on ? 'opacity-100' : hover === i ? 'cursor-pointer opacity-95' : 'cursor-pointer opacity-[.45]',
              )}
              style={{ width: pw }}
              aria-hidden={!on}
            >
              <div className="flex h-16 flex-col justify-end px-1 pb-3.5">
                <div className="text-[19px] font-bold tracking-[-0.02em] sm:text-[21px]">{p.title}</div>
                <div className="mt-0.5 text-[15px] font-medium text-fs-text-3">{p.sub}</div>
              </div>
              <div
                className={cn('overflow-hidden rounded-fs-xl transition-shadow', on ? 'shadow-fs-float' : 'shadow-fs-ring')}
                style={{ width: pw, height: narrow ? undefined : Math.round(H * scale) }}
              >
                <div
                  className="origin-top-left [&>div]:shadow-none"
                  style={narrow ? { width: pw } : { width: W, transform: `scale(${scale})` }}
                >
                  {i === 0 ? (
                    <ScoutAIDemo mode="sit" playing={on && inView} onDone={() => queueFlip(0)} />
                  ) : (
                    <LineupDemo playing={on && inView} onDone={() => queueFlip(1)} />
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-7 flex items-center justify-center gap-2.5">
        {PANELS.map((p, i) => (
          <button
            key={p.key}
            type="button"
            onClick={() => pick(i as 0 | 1)}
            aria-label={`Show ${p.title}`}
            aria-current={active === i}
            className={cn(
              'h-2 rounded-[4px] transition-[width,background-color] duration-300',
              active === i ? 'w-7 bg-fs-ink' : 'w-2 bg-fs-fill-off',
            )}
          />
        ))}
      </div>
    </div>
  )
}
