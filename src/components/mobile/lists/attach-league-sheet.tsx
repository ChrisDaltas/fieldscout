'use client'

import * as React from 'react'

import { attachedToastLine, leagueOptions } from '@/components/leagues/attach-list-ops'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useAuth } from '@/hooks/use-auth'
import { useAttachListAnyLeague, useListAttachments } from '@/hooks/use-league-lists'
import { useLeagues } from '@/hooks/use-leagues'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import { cn } from '@/lib/utils'

import { SheetRow } from './folder-sheets'
import { CenterNote, LIcon, PillButton, SwitchTrack } from './lists-parts'

/**
 * FieldScout Mobile — "Attach to league" from a list's options (leagues test
 * cohort, `featureFlags.leagues`). The desktop `AttachListToLeagueModal` in
 * the mobile sheet language (the design has no such screen; CLAUDE.md: extend
 * the new design language to features the prototype lacks): the same reads
 * (`useLeagues`, `useListAttachments`), the same §15.5 POST
 * (`useAttachListAnyLeague`), the same ordering and toast copy
 * (`attach-list-ops.ts`), the same primary-board and share toggles (§7.4).
 */
export function AttachLeagueSheet({
  open,
  onOpenChange,
  list,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  list: { id: string; title: string }
}) {
  const { user } = useAuth()
  const leagues = useLeagues({ enabled: open })
  const attachments = useListAttachments(list.id, user?.id, open)
  const attach = useAttachListAnyLeague()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [primary, setPrimary] = React.useState(true)
  const [shared, setShared] = React.useState(false)

  React.useEffect(() => {
    if (open) setSelectedId(null)
  }, [open])

  const options = React.useMemo(
    () => leagueOptions(leagues.data ?? [], new Set((attachments.data ?? []).map((row) => row.league_id))),
    [leagues.data, attachments.data],
  )
  const selected = options.find((option) => option.id === selectedId) ?? null
  // Without the attachments read an attached league would look attachable,
  // so its failure is an error too (CLAUDE.md, loud failure).
  const failed = [leagues, attachments].filter((query) => query.isError)
  const loading = leagues.isPending || (Boolean(user?.id) && attachments.isPending)

  const submit = () => {
    if (!selected || attach.isPending) return
    attach.mutate(
      { leagueId: selected.id, list_id: list.id, is_primary_board: primary, shared_with_league: shared },
      {
        onSuccess: () => {
          toast({ title: attachedToastLine(list.title, selected.name, primary, shared) })
          onOpenChange(false)
        },
        onError: (error) =>
          toast({
            title: 'Attach failed',
            description: error instanceof LeagueActionError ? error.message : 'Please try again.',
          }),
      },
    )
  }

  const ready = !loading && failed.length === 0 && options.length > 0

  return (
    <MobileSheet
      bodyClassName="leading-[normal] tabular-nums"
      open={open}
      onOpenChange={onOpenChange}
      title="Attach to league"
      subtitle={`Make “${list.title}” a draft reference in one of your leagues.`}
      showClose
      footer={
        ready ? (
          <div className="border-t border-m-b2 px-4 pt-2.5">
            <button
              type="button"
              onClick={submit}
              disabled={!selected || attach.isPending}
              className={cn(
                'flex h-12 w-full items-center justify-center rounded-[14px] text-[15px] font-semibold',
                selected ? 'bg-accent text-white active:bg-accent-strong' : 'bg-m-b3s text-m-t3',
              )}
            >
              {attach.isPending ? 'Attaching…' : 'Attach to league'}
            </button>
          </div>
        ) : undefined
      }
    >
      {failed.length > 0 ? (
        <CenterNote
          className="py-8"
          title="Your leagues could not be loaded."
          body={failed[0].error?.message}
          action={<PillButton onClick={() => failed.forEach((query) => void query.refetch())}>Try again</PillButton>}
        />
      ) : loading ? (
        <div className="flex flex-col gap-2 px-4 pb-2" aria-busy="true" aria-label="Loading your leagues">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-[14px] bg-m-b1" />
          ))}
        </div>
      ) : options.length === 0 ? (
        <CenterNote className="py-8" title="You’re not in any leagues yet." body="Create or join one first." />
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          <div className="flex flex-col px-3" role="group" aria-label="Your leagues">
            {options.map((option) => {
              const on = selectedId === option.id
              return (
                <SheetRow
                  key={option.id}
                  icon={<LIcon name="league" size={15} />}
                  label={option.name}
                  sub={option.attached ? 'Attached' : option.status === 'drafting' ? 'Draft live' : option.status === 'scheduled' ? 'Scheduled' : undefined}
                  disabled={option.attached}
                  trailing={on ? <MIcon name="check" size={14} stroke={2.2} className="text-accent" /> : null}
                  onClick={() => setSelectedId(option.id)}
                />
              )
            })}
          </div>
          <div className="flex flex-col gap-2 px-4">
            <ToggleRow
              label="Set as my primary board"
              sub="Feeds your draft Targets and autopick for this league (one per league)."
              on={primary}
              onClick={() => setPrimary(!primary)}
            />
            <ToggleRow
              label="Share with the league"
              sub="Every member can open it. Off, it stays visible only to you."
              on={shared}
              onClick={() => setShared(!shared)}
            />
          </div>
        </div>
      )}
    </MobileSheet>
  )
}

/** A b1 card that is one switch (the editor's Ranked / Tiers card, with a sub-line). */
function ToggleRow({ label, sub, on, onClick }: { label: string; sub: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl bg-m-b1 py-2.5 pl-3 pr-2.5 text-left active:bg-m-b2h"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-m-t1">{label}</span>
        <span className="text-[11px] font-medium leading-[1.35] text-m-t3">{sub}</span>
      </span>
      <SwitchTrack on={on} />
    </button>
  )
}
