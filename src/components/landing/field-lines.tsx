/**
 * Football-field sidelines behind the landing page body: two gutter rails
 * with hash ticks and rotated yard numbers every 600px (10 → 50 → 10).
 * Decorative only; ends 64px above the footer (Claude Design v13).
 */

const GUTTER = 'clamp(16px,8vw,120px)'
const YARDS = [10, 20, 30, 40, 50, 40, 30, 20, 10]
const HASHES = 'repeating-linear-gradient(to bottom, #DCDCDF 0 1px, transparent 1px 24px)'

export function FieldLines() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-16 top-0 z-0 overflow-hidden">
      <div className="absolute bottom-0 left-0 h-px bg-fs-line-field" style={{ width: GUTTER }} />
      <div className="absolute bottom-0 right-0 h-px bg-fs-line-field" style={{ width: GUTTER }} />
      <div className="absolute inset-y-0 w-px bg-fs-line-field" style={{ left: GUTTER }} />
      <div className="absolute inset-y-0 w-px bg-fs-line-field" style={{ right: GUTTER }} />
      {[
        { left: `calc(${GUTTER} - 10px)`, width: 10 },
        { right: `calc(${GUTTER} - 10px)`, width: 10 },
        { left: 0, width: 8 },
        { right: 0, width: 8 },
      ].map((s, i) => (
        <div
          key={i}
          className="absolute inset-y-0"
          style={{ ...s, backgroundImage: HASHES, backgroundPosition: '0 12px' }}
        />
      ))}
      {YARDS.map((n, i) => (
        <div key={i}>
          <div className="absolute left-0 h-px bg-fs-line-field" style={{ top: 396 + i * 600, width: GUTTER }} />
          <div className="absolute right-0 h-px bg-fs-line-field" style={{ top: 396 + i * 600, width: GUTTER }} />
          {(['left', 'right'] as const).map((side) => (
            <div
              key={side}
              className="absolute w-[72px] text-center font-bold tracking-[.04em] text-black/[.07]"
              style={{
                [side]: `calc(${GUTTER} / 2 - 36px)`,
                top: 420 + i * 600,
                fontSize: 'clamp(20px,3vw,44px)',
                transform: `rotate(${side === 'left' ? 90 : -90}deg)`,
              }}
            >
              {n}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
