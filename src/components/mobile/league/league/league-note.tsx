'use client'

import { useState } from 'react'

import {
  LEAGUE_NOTE_EDITOR_HELP,
  LEAGUE_NOTE_EMPTY_COMMISH,
  LEAGUE_NOTE_EMPTY_MEMBER,
  LEAGUE_NOTE_ERROR,
  LEAGUE_NOTE_HINT,
  LEAGUE_NOTE_MAX,
  LEAGUE_NOTE_UNAVAILABLE,
  noteByline,
  noteEditorState,
  noteSavedToast,
} from '@/components/leagues/league-note-ops'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { UsernameLink } from '@/components/shared/username-link'
import { useLeagueNote, useSetLeagueNote, type LeagueNoteView } from '@/hooks/use-league-note'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/**
 * The commissioner note on the phone (gap list #13; Chris 2026-10-15): one
 * short note the commissioner (or a co-commissioner) pins for the whole
 * league — on the LEAGUE tab, not the app Home.
 *
 *  - `LeagueNoteCard` — the card at the top of the League tab when a note is
 *    pinned: up to three lines, who pinned it and when; a tap opens it in
 *    full. Nothing when there is no note (the Menu's row is the door).
 *  - `LeagueNoteSheets` — the full note (the Menu's "Commissioner note" row
 *    and the card both open it) and, for commissioners, the edit sheet.
 */

type ShownNote = NonNullable<LeagueNoteView['note']>

function Byline({ note, className }: { note: ShownNote; className?: string }) {
  const by = noteByline(note, new Date())
  if (!by.username && !by.when) return null
  return (
    <p className={cn('text-[12px] font-medium text-m-t3', className)} data-league-note-byline>
      {by.username ? (
        <>
          Pinned by <UsernameLink username={by.username} className="font-semibold text-m-t2" />
        </>
      ) : (
        'Pinned'
      )}
      {by.when ? ` · ${by.when}` : ''}
    </p>
  )
}

/** The League tab's card — only when a note is pinned. */
export function LeagueNoteCard({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const query = useLeagueNote(leagueId)
  const [open, setOpen] = useState(false)
  const view = query.data
  const note = view?.available ? view.note : null

  return (
    <>
      {!view && query.isError ? (
        // A read that failed before any note loaded. A failed RE-read keeps
        // the note React Query already has, so the card below stays up.
        <div className="px-3 pt-2.5">
          <div role="alert" className="flex items-center justify-between gap-3 rounded-[16px] bg-m-b1 px-3.5 py-3 text-[13px] font-medium text-m-t3">
            {LEAGUE_NOTE_ERROR}
            <button type="button" onClick={() => query.refetch()} className="text-[13px] font-semibold text-accent">
              Retry
            </button>
          </div>
        </div>
      ) : note ? (
        <div className="px-3 pt-2.5" data-league-note="shown">
          <div className="flex flex-col gap-1.5 rounded-[16px] bg-m-b1 px-3.5 pb-3 pt-3">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              className="flex flex-col gap-1.5 text-left"
              data-league-note-open
            >
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-m-t2">
                <MIcon name="news" size={13} stroke={1.8} />
                Commissioner note
                <MIcon name="chevronRight" size={10} stroke={2} className="ml-auto text-m-t5" />
              </span>
              <span className="line-clamp-3 whitespace-pre-line break-words text-[14px] font-medium leading-[1.4] text-m-t1" data-league-note-text>
                {note.text}
              </span>
            </button>
            <Byline note={note} />
          </div>
        </div>
      ) : null}
      {/* Mounted whatever the card shows (the sheets portal — nothing renders
          here while they are closed): an open note, and the commissioner's
          draft in the edit sheet behind it, outlive a failed re-read (a save
          that fails offline re-reads too) and a note cleared meanwhile. */}
      <LeagueNoteSheets open={open} onOpenChange={setOpen} leagueId={leagueId} canEdit={canEdit} />
    </>
  )
}

/** The full note, and the commissioner's edit sheet behind it. */
export function LeagueNoteSheets({
  open,
  onOpenChange,
  leagueId,
  canEdit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leagueId: string
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  // Each opening of the editor starts from the note as it stands (a fresh mount).
  const [editKey, setEditKey] = useState(0)
  // Read while either sheet is up — the editor needs the note it replaces.
  const query = useLeagueNote(open || editing ? leagueId : undefined)
  const view = query.data
  const note = view?.note ?? null
  const editable = canEdit && view?.available === true

  return (
    <>
      <MobileSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Commissioner note"
        showClose
        footer={
          editable ? (
            <div className="px-4 pt-2.5">
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false)
                  setEditKey((k) => k + 1)
                  setEditing(true)
                }}
                className="flex h-12 w-full items-center justify-center rounded-[14px] bg-accent text-[15px] font-semibold text-white active:bg-accent-strong"
                data-league-note-edit
              >
                {note ? 'Edit note' : 'Add a note'}
              </button>
            </div>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3 px-5 pb-3">
          {query.isPending ? (
            <div className="h-16 rounded-xl bg-m-b1" aria-hidden />
          ) : !view ? (
            // Failed before any note loaded (a failed RE-read keeps the note).
            <p role="alert" className="text-[14px] font-medium text-m-t3">
              {LEAGUE_NOTE_ERROR}{' '}
              <button type="button" onClick={() => query.refetch()} className="font-semibold text-accent">
                Retry
              </button>
            </p>
          ) : !view?.available ? (
            <p className="text-[14px] font-medium text-m-t3">{LEAGUE_NOTE_UNAVAILABLE}</p>
          ) : note ? (
            <>
              <p className="whitespace-pre-line break-words text-[16px] font-medium leading-[1.45] text-m-t1" data-league-note-full>
                {note.text}
              </p>
              <Byline note={note} />
            </>
          ) : (
            <p className="text-[14px] font-medium leading-[1.4] text-m-t3">{canEdit ? LEAGUE_NOTE_EMPTY_COMMISH : LEAGUE_NOTE_EMPTY_MEMBER}</p>
          )}
        </div>
      </MobileSheet>
      {canEdit && (
        <LeagueNoteEditSheet key={editKey} open={editing} onOpenChange={setEditing} leagueId={leagueId} current={note?.text ?? null} />
      )}
    </>
  )
}

/** The commissioner's editor: the note, a counter, Save; Clear when one is pinned. */
export function LeagueNoteEditSheet({
  open,
  onOpenChange,
  leagueId,
  current,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leagueId: string
  current: string | null
}) {
  const [draft, setDraft] = useState(current ?? '')
  const save = useSetLeagueNote(leagueId)
  const state = noteEditorState(draft, current)

  const submit = (note: string) =>
    save.mutate(
      { note },
      {
        onSuccess: (result) => {
          toast(noteSavedToast(result))
          onOpenChange(false)
        },
        onError: (error) => toast({ title: 'The note wasn’t saved', description: error.message, variant: 'destructive' }),
      },
    )

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Commissioner note"
      subtitle={LEAGUE_NOTE_EDITOR_HELP}
      showClose
      footer={
        <div className="flex flex-col gap-1 px-4 pt-2.5">
          <button
            type="button"
            onClick={() => submit(draft)}
            disabled={!state.canSave || save.isPending}
            className={cn(
              'flex h-12 w-full items-center justify-center rounded-[14px] text-[15px] font-semibold',
              state.canSave ? 'bg-accent text-white active:bg-accent-strong' : 'bg-m-b3s text-m-t3',
            )}
            data-league-note-save
          >
            {save.isPending ? 'Saving…' : state.saveLabel}
          </button>
          {current !== null && (
            <button
              type="button"
              onClick={() => submit('')}
              disabled={save.isPending}
              className="flex h-11 w-full items-center justify-center text-[15px] font-semibold text-m-red"
              data-league-note-clear
            >
              Clear note
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-2 px-4 pb-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={5}
          placeholder={LEAGUE_NOTE_HINT}
          aria-label="Commissioner note"
          aria-invalid={state.tooLong || undefined}
          className="resize-none rounded-xl bg-m-b1 p-3 text-[15px] font-medium leading-[1.4] text-m-t1 outline-none placeholder:text-m-t3"
        />
        <span
          className={cn('self-end text-[12px] font-semibold tabular-nums', state.tooLong ? 'text-m-red' : 'text-m-t3')}
          data-league-note-counter
        >
          {state.tooLong ? `Too long — ${state.counter}` : `${state.counter}`}
        </span>
        <span className="sr-only">Up to {LEAGUE_NOTE_MAX} characters.</span>
      </div>
    </MobileSheet>
  )
}
