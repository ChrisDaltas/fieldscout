'use client'

import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { cn } from '@/lib/utils'

import { TYPE_CHIPS, teamAvatarClass, teamInitial, type TxFilter } from './league-tab-ops'

/**
 * Transaction filters (handoff m-league §2.6): "Transaction type" chips
 * (single choice, applied live) and — except on My moves — a Teams list
 * (any number; "All teams" clears it and is checked exactly when nothing
 * is). Done, the backdrop or Escape closes it.
 */
export function TxFilterSheet({
  open,
  onOpenChange,
  filter,
  onChange,
  myMoves,
  teams,
  managerOf,
  teamIds,
  myTeamId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filter: TxFilter
  onChange: (patch: Partial<TxFilter>) => void
  myMoves: boolean
  /** The league's teams, in league order. */
  teams: ReadonlyArray<{ id: string; name: string }>
  managerOf: (teamId: string) => string | null
  teamIds: readonly string[]
  myTeamId: string | null
}) {
  const toggle = (id: string) =>
    onChange({ teams: filter.teams.includes(id) ? filter.teams.filter((t) => t !== id) : [...filter.teams, id] })

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Transaction filters"
      footer={
        <div className="px-5 pt-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-[50px] w-full items-center justify-center rounded-pill bg-accent text-[16px] font-semibold text-white active:bg-accent-strong"
          >
            Done
          </button>
        </div>
      }
    >
      <p className="px-5 pb-1.5 text-[12px] font-semibold text-m-t3" id="tx-type-label">
        Transaction type
      </p>
      <div className="flex gap-1.5 overflow-x-auto px-5 pb-3.5 scrollbar-none" role="group" aria-labelledby="tx-type-label">
        {TYPE_CHIPS.map((c) => {
          const on = filter.type === c.value
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ type: c.value })}
              className={cn(
                'flex h-9 flex-none items-center whitespace-nowrap rounded-pill px-4 text-[13px] font-semibold',
                on ? 'bg-accent text-white' : 'bg-m-b2 text-m-t1',
              )}
            >
              {c.label}
            </button>
          )
        })}
      </div>
      {!myMoves && (
        <>
          <p className="px-5 pb-1 text-[12px] font-semibold text-m-t3" id="tx-teams-label">
            Teams
          </p>
          <div role="group" aria-labelledby="tx-teams-label">
            <TeamRow
              label="All teams"
              glyph="•"
              avClass="bg-m-t5"
              on={filter.teams.length === 0}
              onClick={() => onChange({ teams: [] })}
            />
            {teams.map((t) => (
              <TeamRow
                key={t.id}
                label={managerOf(t.id) ?? t.name}
                glyph={teamInitial(t.name)}
                avClass={teamAvatarClass(t.id, teamIds, myTeamId)}
                on={filter.teams.includes(t.id)}
                onClick={() => toggle(t.id)}
              />
            ))}
          </div>
        </>
      )}
    </MobileSheet>
  )
}

function TeamRow({ label, glyph, avClass, on, onClick }: { label: string; glyph: string; avClass: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="mx-5 flex h-12 w-[calc(100%-40px)] items-center gap-3 border-b border-m-b2 text-left"
    >
      <span aria-hidden="true" className={cn('flex size-7 flex-none items-center justify-center rounded-full text-[11px] font-semibold text-white', avClass)}>
        {glyph}
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-m-t1">{label}</span>
      <span
        aria-hidden="true"
        className={cn('flex size-[22px] flex-none items-center justify-center rounded-full', on ? 'bg-accent' : 'bg-m-b0 ring-[1.5px] ring-inset ring-m-b4m')}
      >
        {on && (
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="text-white">
            <path d="M3 8.5l3.2 3L13 4.5" />
          </svg>
        )}
      </span>
    </button>
  )
}
