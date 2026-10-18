'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { CompareScreen } from './compare-screen'
import { ListDetailsScreen } from './list-details-screen'
import { ListEditor } from './list-editor'
import { ListView } from './list-view'
import { ListsGrid } from './lists-grid'
import { compareIdsOf } from './list-tools'
import { editorHref, listHref } from './lists-nav'

/**
 * FieldScout Mobile — Lists (`/app/lists`). One route, five screens chosen by
 * the query string (see `lists-nav.ts` for the URL map). `?list=` is also the
 * desktop deep link (`/app/lists/<id>` redirects to it), so a shared or
 * recently-viewed list link opens the List view on a phone.
 *
 * `currentWeek` (the NFL week, 0 = offseason — the server's) names the
 * rankings the editor's Import a ranking sheet offers ("Week 5 · RB",
 * "Rest of season" or "Pre-draft").
 */
export function MobileLists({ currentWeek = 0 }: { currentWeek?: number }) {
  const params = useSearchParams()
  const pathname = usePathname()
  const listId = params.get('list')
  const urlEdit: EditTarget | null =
    listId && params.get('edit') === '1'
      ? { listId, autoAdd: params.get('add') === '1', href: `${pathname}?${params.toString()}` }
      : null
  const guard = useEditorBackGuard(urlEdit, params.get('from'))
  const compare = compareIdsOf(params.get('compare'))

  if (guard.editing) {
    const edit = guard.editing
    return (
      <ListEditor
        key={edit.listId}
        listId={edit.listId}
        autoAdd={edit.autoAdd}
        currentWeek={currentWeek}
        promptSeq={guard.promptSeq}
        onDirtyChange={guard.setDirty}
        onLeave={guard.leave}
      />
    )
  }
  if (compare.length > 0) return <CompareScreen ids={compare} />
  if (listId && params.get('details') === '1') return <ListDetailsScreen key={listId} listId={listId} />
  if (listId) return <ListView key={listId} listId={listId} />
  return <ListsGrid tab={params.get('tab') === 'saved' ? 'saved' : 'mine'} />
}

interface EditTarget {
  listId: string
  autoAdd: boolean
  /** The editor's own URL, to put back. */
  href: string
}

/**
 * The editor's guard for the OS back gesture (Chris, 2026-10-15, gap list
 * #16): Back discards the draft, and with changes it asks first. The
 * on-screen Back asks in the editor itself; this covers the gesture (and the
 * browser's Back), which changes the URL before anything can ask.
 *
 * - When the URL drops an editor that still has changes — and the editor
 *   didn't leave on its own (Update, Discard: `leave`) — the editor stays on
 *   screen in that very render, so its draft survives; its URL is pushed
 *   back and the editor asks "Discard changes?" (`promptSeq`).
 * - An editor the page **opened on** without its List view behind it (New
 *   list → Next, which replaces New list; a deep link) gets that entry put
 *   behind it once, on mount, so the gesture lands on this page — where the
 *   guard can catch it — rather than leaving it with the draft. The List
 *   view keeps where *it* goes back to (`from=grid` or none).
 *
 * The pattern is the mobile ranking editor's (`mobile-rankings.tsx`); the
 * native History API calls are kept in sync with `useSearchParams` by Next.
 */
function useEditorBackGuard(urlEdit: EditTarget | null, from: string | null) {
  const [dirty, setDirty] = useState(false)
  /** Set just before the editor leaves on its own, so the guard lets it go. */
  const [leaving, setLeaving] = useState(false)
  const [prev, setPrev] = useState<EditTarget | null>(urlEdit)
  const [stuck, setStuck] = useState<EditTarget | null>(null)
  const [promptSeq, setPromptSeq] = useState(0)

  const href = urlEdit?.href ?? null
  if ((prev?.href ?? null) !== href) {
    setPrev(urlEdit)
    if (prev && urlEdit?.listId !== prev.listId && dirty && !leaving) setStuck(prev)
  }

  const restored = useRef<EditTarget | null>(null)
  useEffect(() => {
    if (!stuck) {
      restored.current = null
      return
    }
    if (urlEdit?.listId === stuck.listId) {
      setStuck(null)
      return
    }
    if (restored.current === stuck) return
    restored.current = stuck
    window.history.pushState(null, '', stuck.href)
    setPromptSeq((n) => n + 1)
    // `href` stands for `urlEdit` (a new object every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stuck, href])

  useEffect(() => {
    if (!href && !stuck && leaving) setLeaving(false)
  }, [href, stuck, leaving])

  const rooted = useRef(false)
  useEffect(() => {
    if (rooted.current) return
    rooted.current = true
    if (!urlEdit || from === 'view') return
    window.history.replaceState(null, '', listHref(urlEdit.listId, from === 'grid' ? 'grid' : undefined))
    window.history.pushState(null, '', editorHref(urlEdit.listId, urlEdit.autoAdd, 'view'))
    // Mount only: this re-roots the entry the page loaded on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const leave = useCallback(() => setLeaving(true), [])

  return { editing: urlEdit ?? stuck, promptSeq, setDirty, leave }
}
