'use client'

import { cn } from '@/lib/utils'

/**
 * The phone's account-settings parts (gap list §4 item 101). The handoff
 * draws no account Settings, so these extend its League settings pages
 * (m-community G): 13/600 t3 section titles over rows on the page itself,
 * split by b2 hairlines (the rows are the shared `FieldRow` / `ToggleRow`
 * in their phone skin — `SettingsSkin layout="mobile"`), sections 18px
 * apart; a field is a 14/600 label over the 48px b2 text field; the Scout
 * AI read is a b1 card under the phone's blue-dot "Scout AI" label (Home's
 * AI experts strip). Every colour is an `m-*` token, so the screens follow
 * the phone's light and dark themes.
 */

/** A section: its title (13/600 t3, the handoff's G rows) and its rows. */
export function SettingsGroup({
  title,
  aside,
  children,
  className,
}: {
  title: string
  /** Beside the title (the plan's Free / Pro chip). */
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col', className)} data-settings-group={title}>
      <div className="flex items-center gap-2 pb-1 pt-2.5">
        <h2 className="text-[13px] font-semibold text-m-t3">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** A field in a section: 14/600 label, the control, an optional t3 hint —
 *  on the rows' hairline rhythm. */
export function SettingsField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-m-b2 py-2.5 last:border-b-0">
      <label htmlFor={htmlFor} className="text-[14px] font-semibold text-m-t1">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[12px] font-medium leading-[1.35] text-m-t3">{hint}</p> : null}
    </div>
  )
}

/** A small chip beside a section title (Free / Pro). */
export function SettingsChip({ tone, children }: { tone: 'quiet' | 'accent'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'flex h-5 items-center rounded-pill px-2 text-[11px] font-semibold',
        tone === 'accent' ? 'bg-m-gb text-m-tb' : 'bg-m-b2 text-m-t1',
      )}
    >
      {children}
    </span>
  )
}

/** The Scout AI read (desktop's `AIInsight`) as a phone card: b1, 14px
 *  radius, the blue-dot label, a 15/600 heading and the 13/500 t2 line. */
export function ScoutAiCard({
  heading,
  label = 'Scout AI',
  children,
}: {
  heading: string
  label?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] bg-m-b1 px-3.5 py-3" data-scout-ai-card>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-m-t3">
        <span className="size-1.5 rounded-full bg-accent" aria-hidden />
        {label}
      </span>
      <p className="text-[15px] font-semibold leading-[1.3] text-m-t1">{heading}</p>
      {children ? <div className="text-[13px] font-medium leading-[1.45] text-m-t2">{children}</div> : null}
    </div>
  )
}

/** The 48px pill buttons at the end of a form (handoff G1's Save): blue when
 *  it can go, quiet grey when it can't — a disabled one never fires. */
export function settingsButtonClass(tone: 'primary' | 'quiet', enabled = true): string {
  return cn(
    'flex h-12 w-full items-center justify-center rounded-pill text-[15px] font-semibold',
    tone === 'quiet'
      ? 'bg-m-b2 text-m-t1 active:bg-m-b2h disabled:opacity-50'
      : enabled
        ? 'bg-accent text-white active:bg-accent-strong'
        : 'bg-m-b3s text-m-t3',
  )
}

/** Loading blocks in the screens' rhythm (b1, the rows' heights). */
export function SettingsSkeleton({ blocks }: { blocks: ReadonlyArray<'avatar' | 'row' | 'card'> }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-6" aria-busy="true" data-settings-loading>
      {blocks.map((block, i) =>
        block === 'avatar' ? (
          <span key={i} className="mx-auto mb-3 size-24 rounded-full bg-m-b1" />
        ) : block === 'card' ? (
          <span key={i} className="h-28 rounded-[14px] bg-m-b1" />
        ) : (
          <span key={i} className="h-12 rounded-[12px] bg-m-b1" />
        ),
      )}
    </div>
  )
}
