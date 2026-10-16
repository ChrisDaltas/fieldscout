'use client'

import { useState } from 'react'

import { UsernameLink } from '@/components/shared/username-link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { useLeagueNote, useSetLeagueNote, type LeagueNoteView } from '@/hooks/use-league-note'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import {
  LEAGUE_NOTE_EDITOR_HELP,
  LEAGUE_NOTE_EMPTY_COMMISH,
  LEAGUE_NOTE_ERROR,
  LEAGUE_NOTE_HINT,
  LEAGUE_NOTE_MAX,
  noteByline,
  noteEditorState,
  noteSavedToast,
} from './league-note-ops'

const CARD_TITLE = 'text-[13px] font-bold tracking-[-0.01em] text-ink'

/**
 * The commissioner note on League Home (gap list #13; Chris 2026-10-15 —
 * the LEAGUE home, not the app Home). One short note the commissioner (or a
 * co-commissioner) pins for the whole league, like ESPN's LM Note.
 *
 *  - A note: the card at the top of the page — the text, who pinned it and
 *    when; commissioners get Edit (inline).
 *  - No note: members see nothing; a commissioner sees a one-line prompt to
 *    pin one.
 *  - Before the database has notes (`available: false`): nothing.
 *  - A failed read: said plainly, with Retry (never a silent "no note") —
 *    but only for a note never loaded. A failed RE-read (React Query keeps
 *    the note it had) keeps showing that note, and an open editor stays open:
 *    a save that fails offline re-reads the note too, and swapping in the
 *    error card would unmount the editor and throw away what the
 *    commissioner typed.
 */
export function LeagueNoteCard({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)
  return <LeagueNoteCardView leagueId={leagueId} canEdit={canEdit} editing={editing} onEditingChange={setEditing} />
}

/** The card for a given editing state — controlled, so the editor's
 *  survival through a failed re-read can be pinned without a click. */
export function LeagueNoteCardView({
  leagueId,
  canEdit,
  editing,
  onEditingChange,
}: {
  leagueId: string
  canEdit: boolean
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const query = useLeagueNote(leagueId)
  const view = query.data

  if (query.isPending) return null
  // The editor first: it outlives a failed re-read (its draft is the
  // commissioner's typing), editing against the last note we loaded.
  if (editing && canEdit && view?.available) {
    return <LeagueNoteEditor leagueId={leagueId} current={view.note?.text ?? null} onDone={() => onEditingChange(false)} />
  }
  if (!view) {
    // Not pending and no data: the read failed before any note loaded.
    return (
      <Card className="border-transparent bg-surface-sunken" data-league-note="error">
        <CardContent className="flex items-center justify-between gap-3 px-[15px] py-[11px]">
          <p className="text-[11px] font-medium text-n-3" role="alert">
            {LEAGUE_NOTE_ERROR}
          </p>
          <Button variant="stroke" size="sm" onClick={() => query.refetch()}>
            <Icon name="reset" size={11} /> Retry
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (!view.available) return null
  const note = view.note

  if (!note) {
    if (!canEdit) return null
    return (
      <Card className="border-dashed" data-league-note="empty">
        <CardContent className="flex items-center justify-between gap-3 px-[15px] py-[11px]">
          <p className="flex items-center gap-2 text-[11px] font-medium text-n-3">
            <Icon name="marker" size={13} className="flex-none text-n-6" />
            {LEAGUE_NOTE_EMPTY_COMMISH}
          </p>
          <Button variant="stroke" size="sm" onClick={() => onEditingChange(true)} data-league-note-add>
            <Icon name="plus" size={11} /> Add note
          </Button>
        </CardContent>
      </Card>
    )
  }

  return <LeagueNoteShown note={note} canEdit={canEdit} onEdit={() => onEditingChange(true)} />
}

function LeagueNoteShown({
  note,
  canEdit,
  onEdit,
}: {
  note: NonNullable<LeagueNoteView['note']>
  canEdit: boolean
  onEdit: () => void
}) {
  const by = noteByline(note, new Date())
  return (
    <Card className="border-transparent bg-accent-soft" data-league-note="shown">
      <CardHeader className="min-h-0 border-b-0 px-[15px] pb-0 pt-[13px]">
        <CardTitle className={cn('flex items-center gap-1.5', CARD_TITLE)}>
          <Icon name="marker" size={13} className="text-accent" />
          Commissioner note
        </CardTitle>
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit} data-league-note-edit>
            <Icon name="edit" size={11} /> Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-[15px] pb-[13px] pt-2">
        <p className="whitespace-pre-line break-words text-[13px] font-medium leading-[1.45] text-ink" data-league-note-text>
          {note.text}
        </p>
        {(by.username || by.when) && (
          <p className="text-[10px] font-medium text-n-6" data-league-note-byline>
            {by.username ? (
              <>
                Pinned by <UsernameLink username={by.username} className="font-semibold text-n-3" />
              </>
            ) : (
              'Pinned'
            )}
            {by.when ? ` · ${by.when}` : ''}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** The inline editor (commissioners): the text, a counter, Save / Clear / Cancel. */
function LeagueNoteEditor({ leagueId, current, onDone }: { leagueId: string; current: string | null; onDone: () => void }) {
  const [draft, setDraft] = useState(current ?? '')
  const save = useSetLeagueNote(leagueId)
  const state = noteEditorState(draft, current)

  const submit = (note: string) =>
    save.mutate(
      { note },
      {
        onSuccess: (result) => {
          toast(noteSavedToast(result))
          onDone()
        },
        onError: (error) => toast({ title: 'The note wasn’t saved', description: error.message, variant: 'destructive' }),
      },
    )

  return (
    <Card data-league-note="editing">
      <CardHeader className="min-h-0 border-b-0 px-[15px] pb-0 pt-[13px]">
        <CardTitle className={cn('flex items-center gap-1.5', CARD_TITLE)}>
          <Icon name="marker" size={13} className="text-accent" />
          Commissioner note
        </CardTitle>
        <span className={cn('text-[10px] font-semibold tabular-nums', state.tooLong ? 'text-negative-strong' : 'text-n-6')} data-league-note-counter>
          {state.counter}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-[15px] pb-[13px] pt-2">
        <textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={LEAGUE_NOTE_HINT}
          aria-label="Commissioner note"
          aria-invalid={state.tooLong || undefined}
          className={cn(
            'w-full resize-y rounded-md bg-surface-control p-2.5 text-[12px] font-medium leading-relaxed text-ink outline-none transition-shadow focus-visible:bg-white focus-visible:shadow-field',
            // One class on its own: the copy census reads multi-word strings as copy.
            'placeholder:text-n-6',
          )}
        />
        <p className="text-[10px] font-medium text-n-6" data-league-note-help>
          {LEAGUE_NOTE_EDITOR_HELP} Up to {LEAGUE_NOTE_MAX} characters.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {current !== null && (
            <Button variant="destructive" size="sm" className="mr-auto" disabled={save.isPending} onClick={() => submit('')} data-league-note-clear>
              Clear note
            </Button>
          )}
          <Button variant="stroke" size="sm" disabled={save.isPending} onClick={onDone}>
            Cancel
          </Button>
          <Button variant="blue" size="sm" disabled={!state.canSave || save.isPending} onClick={() => submit(draft)} data-league-note-save>
            {save.isPending ? 'Saving…' : state.saveLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
