'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { readLastRankPos, rememberRankPos } from '@/components/mobile/rankings/last-position'
import { NewRanking } from '@/components/mobile/rankings/new-ranking'
import { RkIcon, RK_ICON } from '@/components/mobile/rankings/rank-parts'
import { RankingEditor } from '@/components/mobile/rankings/ranking-editor'
import { RankingsHub, type RankingsNav } from '@/components/mobile/rankings/rankings-hub'
import {
  activeWeekOf,
  parseRankingsParams,
  positionInUse,
  rankPosOr,
  toRankingsSearch,
  type RankFrom,
  type RankOverlay,
  type RankPos,
  type RankingsUrlState,
  type RankType,
} from '@/components/mobile/rankings/rankings-ops'
import { appEntryBehind, useGoBack } from '@/components/mobile/ui/back-nav'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'

type EditOverlay = Extract<RankOverlay, { kind: 'edit' }>

function sameEdit(a: EditOverlay | null, b: EditOverlay | null): boolean {
  if (!a || !b) return a === b
  return a.type === b.type && a.pos === b.pos && a.from === b.from
}

/** Route entry: `useSearchParams` needs a Suspense boundary on static routes. */
export function MobileRankingsScreen(props: { currentWeek: number; initialEdit?: RankType }) {
  return (
    <Suspense fallback={null}>
      <MobileRankings {...props} />
    </Suspense>
  )
}

/** `/app/big-board` on a phone: the mobile app has one Rankings area, at
 *  `/app/weekly-ranks` — hand over to it, keeping any filters. */
export function MobileRankingsRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace(`/app/weekly-ranks${window.location.search}`)
  }, [router])
  return null
}

/** `/app/big-board/week/<not a week>` on a phone (desktop shows the same
 *  "That week doesn't exist"). Back goes to where you came from, else the
 *  Rankings Mine tab (gap list #27). */
export function MobileInvalidWeek() {
  const goBack = useGoBack()
  return (
    <MobileScreen
      header={
        <div className="flex items-center gap-2.5 px-4 pt-[2px]">
          <button
            type="button"
            onClick={() => goBack('/app/weekly-ranks?view=mine')}
            aria-label="Back"
            className="flex size-[34px] flex-none items-center justify-center rounded-full bg-m-b2 text-m-t1"
          >
            <RkIcon d={RK_ICON.back} size={16} stroke={2} />
          </button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-1.5 px-6 py-14 text-center">
        <span className="text-[15px] font-semibold text-m-t1">That week doesn&apos;t exist</span>
        <span className="text-[13px] font-medium text-m-t3">Week must be between 1 and 18.</span>
      </div>
    </MobileScreen>
  )
}

/**
 * The mobile Rankings area (FieldScout Mobile "Lists and Rankings"): ONE
 * Rankings screen — tabs Experts · Scout AI · Users · Mine, where Mine is
 * what used to be the separate My rankings (gap list #28) — and, over it,
 * the New ranking wizard and the ranking editor as full-screen layers that
 * hide the dock (lr-frame §1.1).
 *
 * Every screen and filter lives in the URL — `?view=mine` (the Mine tab),
 * `?src=`, `?scoring=`, `?pos=`, `?new=1|2&nt=&np=`, `?edit=&ep=&from=` — so
 * browser / OS Back steps through them and a link can open any of them.
 * Updates go through the native History API, which Next keeps in sync with
 * `useSearchParams` without a server round trip. The hub stays mounted under
 * the overlays, so its scroll position and filters survive them.
 *
 * A URL that names no position opens on the one last used on this device
 * (gap list #32); the position in use is remembered as it changes.
 *
 * Back and Close go to where you came from (gap list #27): an overlay the
 * hub opened pops back to the hub as it was; one a link opened (Profile's
 * New ranking, Community's Create) goes back to that screen.
 *
 * Unpublished edits are guarded on every way out of the editor (Back
 * discards them, Chris 2026-10-15 — but asks first): its own back asks,
 * browser / OS Back (or a swipe) re-opens the editor at once and asks the
 * same question, and a reload or tab close gets the browser's leave-page
 * prompt.
 */
export function MobileRankings({
  currentWeek,
  initialEdit,
}: {
  currentWeek: number
  /** Open the editor for this period when the URL names no screen
   *  (`/app/big-board/week/[week]`). */
  initialEdit?: RankType
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  const goBack = useGoBack()
  // Where a URL with no position opens: the last one used on this device.
  // Read once — every URL the hub writes names its position, so only links
  // from outside fall back to it.
  const [startPos] = useState<RankPos>(() => readLastRankPos() ?? 'RB')
  const state = useMemo<RankingsUrlState>(() => {
    // `?new=1` with no type opens on this week, like the handoff's #new-ranking.
    const active = activeWeekOf(currentWeek)
    const s = parseRankingsParams(params, { type: active <= 18 ? `w${active}` : 'season', pos: startPos })
    if (!s.overlay && initialEdit && !params.has('closed')) {
      return { ...s, overlay: { kind: 'edit', type: initialEdit, pos: rankPosOr(s.pos, startPos), from: null } }
    }
    return s
  }, [params, initialEdit, currentWeek, startPos])

  // Remember the position in use — the hub's chips, New ranking's, the
  // editor's — so Rankings starts there next time (gap list #32).
  const usedPos = positionInUse(state)
  useEffect(() => {
    if (usedPos) rememberRankPos(usedPos)
  }, [usedPos])

  // Was the open overlay pushed by us (so Back can simply pop it)?
  const pushedOverlay = useRef(false)
  useEffect(() => {
    if (!state.overlay) pushedOverlay.current = false
  }, [state.overlay])

  const hrefOf = useCallback(
    (next: RankingsUrlState) => {
      let search = toRankingsSearch(next)
      // The week route opens its editor by default; once closed, say so.
      if (initialEdit && !next.overlay) search += search ? '&closed=1' : '?closed=1'
      return `${pathname}${search}`
    },
    [pathname, initialEdit],
  )

  const write = useCallback(
    (next: RankingsUrlState, mode: 'push' | 'replace') => {
      const url = hrefOf(next)
      if (mode === 'push') window.history.pushState(null, '', url)
      else window.history.replaceState(null, '', url)
    },
    [hrefOf],
  )

  // An editor the page OPENED on (a `?edit=` link — Profile's ranking rows
  // — or the week route) gets its own history entry over the Mine tab, so
  // browser / OS Back from it lands on that tab — inside the
  // unpublished-changes guard below — instead of leaving the page with the
  // edits. The Mine entry is ours, not somewhere you came from, so the
  // editor's own Back steps over it (`linkRooted`).
  const mounted = useRef(false)
  const linkRooted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    if (state.overlay?.kind !== 'edit') return
    write({ ...state, src: 'mine', overlay: null }, 'replace')
    write({ ...state, src: 'mine' }, 'push')
    pushedOverlay.current = true
    linkRooted.current = true
    // Mount only: this re-roots the entry the page loaded on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- unpublished-changes guard for browser / OS Back ---------------------
  const [editorDirty, setEditorDirty] = useState(false)
  /** Set just before WE close the editor, so the guard lets it go. */
  const [leaving, setLeaving] = useState(false)
  const urlEdit: EditOverlay | null = state.overlay?.kind === 'edit' ? state.overlay : null
  const [prevEdit, setPrevEdit] = useState<EditOverlay | null>(urlEdit)
  const [stuck, setStuck] = useState<EditOverlay | null>(null)
  const [promptSeq, setPromptSeq] = useState(0)
  if (!sameEdit(prevEdit, urlEdit)) {
    // The URL dropped a dirty editor without us closing it (browser / OS
    // Back, a swipe): keep the editor on screen in this very render, so its
    // draft survives, and put its URL back below.
    setPrevEdit(urlEdit)
    if (prevEdit && !urlEdit && editorDirty && !leaving) setStuck(prevEdit)
  }
  useEffect(() => {
    if (!stuck) return
    if (urlEdit) {
      setStuck(null)
      return
    }
    write({ ...state, overlay: stuck }, 'push')
    pushedOverlay.current = true
    setPromptSeq((n) => n + 1)
  }, [stuck, urlEdit, state, write])
  useEffect(() => {
    if (!urlEdit && !stuck && leaving) setLeaving(false)
  }, [urlEdit, stuck, leaving])
  // Once the linked editor has closed for good, the next editor is one the
  // hub opens — its Back is a plain pop. (A dirty editor put back on screen
  // by the guard is still the linked one.) Browser / OS Back from a clean
  // linked editor lands on the Mine entry we put under it, which is not
  // where you came from: carry on back to the screen that linked here, as
  // the editor's own Back does (gap list #27). Our own close (`leaving`)
  // has already gone where it meant to.
  useEffect(() => {
    if (urlEdit || stuck) return
    const linked = linkRooted.current
    linkRooted.current = false
    if (linked && !leaving && appEntryBehind()) window.history.back()
  }, [urlEdit, stuck, leaving])

  const nav: RankingsNav = {
    state,
    currentWeek,
    setHub: (patch) => write({ ...state, ...patch }, 'replace'),
    open: (overlay: RankOverlay, mode = 'push') => {
      if (mode === 'push') pushedOverlay.current = true
      write({ ...state, overlay }, mode)
    },
  }

  /** Wizard X — to where you came from (gap list #27): the hub exactly as it
   *  was (lr-frame §3.1 `go("rk")`) when the hub opened it, the screen that
   *  linked here (Profile's New ranking, Community's Create), else the hub. */
  const closeOverlay = () => {
    if (pushedOverlay.current) window.history.back()
    else goBack(hrefOf({ ...state, overlay: null }))
  }

  /** Editor back — to where you came from (gap list #27): the tab (or the
   *  AI expert's board) it was opened over, the screen that linked to it
   *  (Profile's ranking rows) or to New ranking, else the Mine tab. */
  const editorBack = () => {
    setLeaving(true)
    // A linked editor sits on the Mine entry we put under it: step over
    // that too, back to the screen that linked here — when there is one.
    if (linkRooted.current && appEntryBehind(2)) window.history.go(-2)
    else if (pushedOverlay.current) window.history.back()
    else goBack(hrefOf({ ...state, src: 'mine', overlay: null }))
  }

  const ov = state.overlay
  const edit = urlEdit ?? stuck
  return (
    <>
      <RankingsHub nav={nav} />
      {ov?.kind === 'new' && (
        <NewRanking
          step={ov.step}
          type={ov.type}
          pos={ov.pos}
          currentWeek={currentWeek}
          onClose={closeOverlay}
          onChange={(c) =>
            write(
              { ...state, overlay: { kind: 'new', step: c.step ?? ov.step, type: c.type ?? ov.type, pos: c.pos ?? ov.pos } },
              'replace',
            )
          }
          onOpenEditor={(type, pos, from: RankFrom | null) =>
            write({ ...state, overlay: { kind: 'edit', type, pos, from } }, 'replace')
          }
        />
      )}
      {edit && (
        <RankingEditor
          key={`${edit.type}:${edit.pos}`}
          type={edit.type}
          pos={edit.pos}
          from={edit.from}
          currentWeek={currentWeek}
          promptSeq={promptSeq}
          onDirtyChange={setEditorDirty}
          onBack={editorBack}
          onPublished={() => {
            if (edit.from) write({ ...state, overlay: { ...edit, from: null } }, 'replace')
          }}
        />
      )}
    </>
  )
}
