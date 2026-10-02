import { LogoTile } from '@/components/landing/fieldscout-logo'
import { CheckDisc, CreateAccountButton } from '@/components/landing/landing-bits'
import { cn } from '@/lib/utils'

/**
 * "Set the edge" comparison (Claude Design FieldScout Landing v13). Copy is
 * the design's, as of October 2026 — the footnote says so on the page.
 */

type Cell = 'yes' | 'no' | string
const ROWS: { label: string; others: [Cell, Cell, Cell] }[] = [
  { label: 'Full leagues', others: ['yes', 'yes', 'yes'] },
  { label: 'Live drafts', others: ['yes', 'yes', 'yes'] },
  { label: 'Expert and consensus rankings, side by side', others: ['Expert only', 'Expert only', 'Partial'] },
  { label: 'Ask in plain English, get a list back', others: ['no', 'no', 'no'] },
  { label: 'Start or sit calls that show their reasoning', others: ['no', 'no', 'no'] },
  { label: 'Vegas lines, matchups and weather in every projection', others: ['no', 'no', 'no'] },
  { label: 'Weekly waiver wire reports', others: ['Articles', 'Articles', 'Trending adds'] },
  { label: 'Advanced stats: target share, YPRR, snap %', others: ['Basic', 'Basic', 'Basic'] },
]
// Phones: four platform columns, each feature's name on its own full-width
// line above its row. sm+: the design's label column + four platforms.
const GRID = 'grid grid-cols-4 sm:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]'

function OtherCell({ cell }: { cell: Cell }) {
  if (cell === 'yes')
    return (
      <div className="flex justify-center">
        <CheckDisc size={18} muted />
      </div>
    )
  if (cell === 'no')
    return (
      <div className="text-center text-[18px] font-medium text-fs-text-5" aria-label="No">
        —
      </div>
    )
  return <div className="px-0.5 text-center text-[11px] font-medium leading-tight text-fs-text-3 sm:text-[14px]">{cell}</div>
}

export function CompareTable() {
  return (
    <>
      <div className="mt-12 overflow-hidden rounded-fs-xl bg-white shadow-fs-ring">
        <div>
          <div className={cn(GRID, 'items-stretch')}>
            <div className="hidden sm:block" />
            <div className="flex flex-col items-center gap-2 bg-fs-blue-tint px-1 pb-4 pt-5 sm:px-4 sm:pb-5 sm:pt-6">
              <LogoTile size={28} />
              <span className="text-[12px] font-bold sm:text-[17px]">FieldScout</span>
            </div>
            {['Yahoo', 'ESPN', 'Sleeper'].map((p) => (
              <div key={p} className="flex items-end justify-center px-1 pb-4 pt-5 text-[12px] font-semibold sm:px-4 sm:pb-5 sm:pt-6 sm:text-[17px]">
                {p}
              </div>
            ))}
          </div>
          {ROWS.map((r) => (
            <div key={r.label} className={cn(GRID, 'items-center border-t-1 border-fs-line')}>
              <div className="col-span-4 text-pretty px-4 pb-1.5 pt-3.5 text-[14px] font-semibold leading-snug sm:col-span-1 sm:px-[clamp(16px,2.5vw,32px)] sm:py-[18px] sm:text-[15px]">
                {r.label}
              </div>
              <div className="flex h-full items-center justify-center bg-fs-blue-tint py-2.5 sm:py-0">
                <CheckDisc size={20} />
              </div>
              {r.others.map((c, i) => (
                <OtherCell key={i} cell={c} />
              ))}
            </div>
          ))}
          <div className={cn(GRID, 'hidden items-center border-t-1 border-fs-line sm:grid')}>
            <div className="px-8 py-6" />
            <div className="flex h-full items-center justify-center bg-fs-blue-tint px-3 py-5">
              <CreateAccountButton size="md" className="px-[18px]" />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 text-center text-[12.5px] font-medium text-fs-text-3">Comparison as of October 2026.</div>
    </>
  )
}
