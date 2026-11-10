/**
 * Football-field sidelines behind the landing page body: two gutter rails
 * with hash ticks and rotated yard numbers. The numbers are spread evenly
 * down whatever height the field has (10 → 50 → 10), so the last "10" always
 * sits just above the goal line, where the green end zone begins — the page
 * reads as one drive down the field. Decorative only.
 * Hidden on phones (Chris, 2026-10-02) — the gutters eat too much width.
 */

const GUTTER = 'clamp(16px,8vw,120px)'
const YARDS = [10, 20, 30, 40, 50, 40, 30, 20, 10]
const HASHES = 'repeating-linear-gradient(to bottom, #DCDCDF 0 1px, transparent 1px 24px)'

export function FieldLines() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 hidden overflow-hidden sm:block">
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
      {YARDS.map((n, i) => {
        const top = `${((i + 0.5) / YARDS.length) * 100}%`
        return (
          <div key={i}>
            <div className="absolute left-0 h-px bg-fs-line-field" style={{ top, width: GUTTER }} />
            <div className="absolute right-0 h-px bg-fs-line-field" style={{ top, width: GUTTER }} />
            {(['left', 'right'] as const).map((side) => (
              <div
                key={side}
                className="absolute mt-6 w-[72px] text-center font-bold tracking-[.04em] text-black/[.07]"
                style={{
                  [side]: `calc(${GUTTER} / 2 - 36px)`,
                  top,
                  fontSize: 'clamp(20px,3vw,44px)',
                  transform: `rotate(${side === 'left' ? 90 : -90}deg)`,
                }}
              >
                {n}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
