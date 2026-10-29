/**
 * Trash's doors (audit frame-1, item #34). Trash (`/app/trash`) existed on
 * both layouts, and every list delete said "moved to trash", but nothing in
 * the app linked to it. Now the delete toast carries a View trash action, and
 * the Lists page has a door on desktop (the header) and the phone (the foot
 * of My lists — pinned in `mobile/lists/mobile-lists.render.test.ts`).
 *
 * The toast is checked as the element it hands the toaster (Radix renders a
 * toast through a portal, which a static render never reaches); the doors'
 * mounts are source pins, like `ai-surfaces.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import Link from 'next/link'
import { isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const toastSpy = vi.fn()
vi.mock('@/hooks/use-toast', () => ({ toast: (arg: unknown) => toastSpy(arg) }))

import { ToastAction } from '@/components/ui/toast'

import { TRASH_HREF, VIEW_TRASH, toastMovedToTrash } from './trash-door'

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')
const code = (file: string) =>
  read(file).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_match, before) => before ?? '')

/** Every `.tsx` under `src/`, repo-relative. */
const tsxTree = (dir = 'src'): string[] =>
  readdirSync(path.resolve(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) return tsxTree(rel)
    return entry.name.endsWith('.tsx') ? [rel] : []
  })

const DOOR = 'src/components/lists/trash-door.tsx'
const TRASH_PAGE = 'src/app/app/(shell)/trash/page.tsx'
const LISTS_PAGE_V2 = 'src/components/lists/v2/lists-page-v2.tsx'
const PHONE_GRID = 'src/components/mobile/lists/lists-grid.tsx'
/** The three places a list is deleted from. */
const DELETE_SITES = [
  LISTS_PAGE_V2, // desktop Cards mode, the card's menu
  'src/components/lists/v2/list-detail-panel.tsx', // desktop open list, the hero's menu
  'src/components/mobile/lists/list-actions-sheet.tsx', // phone, the list's ⋯ sheet
] as const

describe('the “moved to trash” toast offers a way to Trash', () => {
  it('says the list moved to trash, with a View trash action that links to /app/trash', () => {
    toastSpy.mockClear()
    toastMovedToTrash('Sleepers to stash')
    expect(toastSpy).toHaveBeenCalledTimes(1)
    const arg = toastSpy.mock.calls[0][0] as { title: string; action: ReactElement<{ altText: string; asChild: boolean; children: ReactElement<{ href: string; children: string }> }> }
    expect(arg.title).toBe('“Sleepers to stash” moved to trash')

    // The toast's own action pill (a pill inside a message is allowed; the
    // message stays a rounded rectangle), as a link so it navigates.
    expect(isValidElement(arg.action)).toBe(true)
    expect(arg.action.type).toBe(ToastAction)
    expect(arg.action.props.asChild).toBe(true)
    // Radix requires words for screen readers that can't reach the toast.
    expect(arg.action.props.altText).toMatch(/Trash/)
    const link = arg.action.props.children
    expect(link.type).toBe(Link)
    expect(link.props.href).toBe('/app/trash')
    expect(renderToStaticMarkup(link)).toMatch(/^<a [^>]*href="\/app\/trash"[^>]*>View trash<\/a>$/)
  })

  it('Trash’s address and the action’s words are one constant each', () => {
    expect(TRASH_HREF).toBe('/app/trash')
    expect(VIEW_TRASH).toBe('View trash')
    // …and the address is a real page on both layouts.
    expect(read(TRASH_PAGE)).toMatch(/ByLayout desktop=\{<DesktopTrash \/>\} mobile=\{<MobileTrash \/>\}/)
  })

  it('every list delete says it through the shared toast — no bare “moved to trash” left', () => {
    for (const file of DELETE_SITES) {
      expect(code(file), file).toMatch(/toastMovedToTrash\(list\.title\)/)
    }
    // The words live in one place, so a new delete can't bring back the
    // dead-end version without failing here.
    const bare = tsxTree().filter((file) => file !== DOOR && /moved to trash/i.test(code(file)))
    expect(bare).toEqual([])
  })
})

describe('the Lists page has a door to Trash on both layouts', () => {
  it('desktop: a quiet Trash link leads the Lists header actions, before Create with AI', () => {
    const source = code(LISTS_PAGE_V2)
    const door = source.match(/<Button asChild variant="ghost" size="sm">\s*<Link href=\{TRASH_HREF\} data-lists-trash-door aria-label="Trash" title="Trash">\s*<Icon name="remove" size=\{13\} \/>\s*<span className="hidden xl:inline">Trash<\/span>\s*<\/Link>\s*<\/Button>/)
    // The word shows from `xl` only, so the 1024px desktop minimum keeps the
    // page title whole; below that the can is still named and has a tooltip.
    expect(door).not.toBeNull()
    const actions = source.slice(source.indexOf('actions={'))
    expect(actions.indexOf('data-lists-trash-door')).toBeGreaterThan(-1)
    expect(actions.indexOf('data-lists-trash-door')).toBeLessThan(actions.indexOf('<GenerateAiButton'))
  })

  it('phone: the Lists grid mounts its Trash door on My lists only', () => {
    const source = code(PHONE_GRID)
    expect(source).toMatch(/\{tab === 'mine' && \(lists\.isSuccess \|\| lists\.isError \|\| paused\) && <TrashDoor \/>\}/)
    expect(source).toMatch(/<Link\s+href=\{TRASH_HREF\}/)
  })
})
