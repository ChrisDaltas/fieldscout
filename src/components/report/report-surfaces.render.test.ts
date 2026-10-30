/**
 * Report's form and controls (Community launch plan C10), phone and desktop.
 * Pinned:
 *  - the form: what's being reported (quoted), an OPTIONAL reason — Spam /
 *    Abusive / Something else, the chosen one pressed, pressing it again
 *    clears it — and an optional note capped at 500 characters with a
 *    counter; Send report sends the reason and the note;
 *  - the control: "Report list" / "Report comment", and once reported,
 *    "Reported" — a fact that can't be pressed, never greyed out;
 *  - the design rules: no bright red anywhere on it (it isn't destructive),
 *    the phone's on the m-* tokens with no `dark:` variants, the desktop's
 *    with no resting shadow.
 * The database's answers and what they show are pinned in report-ops.test.ts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  send: vi.fn(),
  reported: false,
  sending: false,
}))

vi.mock('@/hooks/use-report', () => ({
  useReport: () => ({ reported: h.reported, send: h.send, sending: h.sending }),
}))
// Radix portals don't render on the server: draw dialogs, sheets and menus inline.
vi.mock('@/components/ui/dialog', () => {
  const pass = (tag: string) => {
    const Part = ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) =>
      createElement(tag, Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('data-'))), children)
    Part.displayName = `Mock(${tag})`
    return Part
  }
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? createElement('div', { 'data-dialog': '' }, children) : null),
    DialogContent: pass('section'),
    DialogHeader: pass('header'),
    DialogTitle: pass('h2'),
    DialogDescription: pass('p'),
  }
})
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  MobileSheet: ({ open, title, subtitle, children, footer }: { open: boolean; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) =>
    open ? createElement('section', { 'data-sheet': title, 'data-sub': subtitle }, children, footer) : null,
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({ children, disabled, ...rest }: { children?: ReactNode; disabled?: boolean } & Record<string, unknown>) =>
    createElement(
      'div',
      { role: 'menuitem', 'aria-disabled': disabled ? 'true' : undefined, 'data-report': rest['data-report'], 'data-reported': rest['data-reported'], className: rest.className },
      children,
    ),
}))

import { ReportRow, ReportSheet, ReportSheetFields } from '@/components/mobile/community/report-sheet'
import { REPORT_NOTE_MAX } from '@/lib/community/report-content'

import { ReportDialog, ReportFields, ReportMenuItem } from './report-dialog'
import { REPORT_HELP } from './report-ops'

const noop = () => {}
const html = (node: ReactElement) => renderToStaticMarkup(node).replace(/&#x27;/g, '’')

/** Every element of a hookless tree whose props match. */
function find(node: ReactNode, match: (props: Record<string, unknown>) => boolean, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => find(n as ReactNode, match, out))
  else if (isValidElement<Record<string, unknown>>(node)) {
    if (match(node.props)) out.push(node)
    find(node.props.children as ReactNode, match, out)
  }
  return out
}

beforeEach(() => {
  h.send.mockReset()
  h.reported = false
  h.sending = false
})

/** Bright red as a fill, on either layout (CLAUDE.md: red is ink, never paint). */
const RED_FILL = /bg-(m-red|negative-strong|destructive)\b|bg-\[#FF0028\]/

describe('the desktop Report dialog', () => {
  const dialog = (type: 'list' | 'comment' = 'comment') =>
    html(createElement(ReportDialog, { open: true, onOpenChange: noop, target: { type, id: 'c1' }, quote: 'Kelly says hold him' }))

  it('names what it reports, quotes it, and says only FieldScout sees it', () => {
    let out = dialog('comment')
    expect(out).toContain('Report this comment')
    expect(out).toContain('Kelly says hold him')
    expect(out).toContain(REPORT_HELP)
    out = dialog('list')
    expect(out).toContain('Report this list')
  })

  it('three optional reasons, a 500-character note with its counter, Cancel and Send report', () => {
    const out = dialog()
    for (const reason of ['>Spam<', '>Abusive<', '>Something else<']) expect(out).toContain(reason)
    expect(out).toContain('Reason (optional)')
    expect(out).toMatch(new RegExp(`<textarea[^>]*maxLength="${REPORT_NOTE_MAX}"`))
    expect(out).toContain('0 / 500')
    expect(out).toContain('>Cancel<')
    expect(out).toContain('>Send report<')
    expect(out).not.toMatch(RED_FILL)
    // A dialog is an overlay (its own resting shadow, from the primitive);
    // nothing inside it lifts at rest.
    expect(out).not.toMatch(/(?<![a-z-]:)shadow-hard/)
  })

  it('Send report sends the reason and the note; sending, it says so and can’t be pressed twice', () => {
    // A press can't happen in a static render: the wiring is read from source.
    for (const file of ['src/components/report/report-dialog.tsx', 'src/components/mobile/community/report-sheet.tsx']) {
      expect(readFileSync(path.resolve(process.cwd(), file), 'utf8')).toMatch(/report\.send\(\{ reason, note \}, /)
    }
    const out = dialog()
    expect(out).not.toContain('Sending…')
    h.sending = true
    const busy = dialog()
    expect(busy).toContain('Sending…')
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*data-report-send/)
  })

  it('closed, nothing is drawn', () => {
    expect(html(createElement(ReportDialog, { open: false, onOpenChange: noop, target: { type: 'list', id: 'l1' }, quote: 'x' }))).toBe('')
  })
})

describe('the reason is optional — both layouts', () => {
  for (const [name, Fields] of [
    ['desktop', ReportFields],
    ['phone', ReportSheetFields],
  ] as const) {
    it(`${name}: the chosen reason is pressed; pressing it again clears it; another switches`, () => {
      const onReason = vi.fn()
      const tree = Fields({ reason: 'spam', onReason, note: '', onNote: noop })
      const out = html(createElement('div', null, tree))
      expect(out).toMatch(/aria-pressed="true"[^>]*data-report-reason="spam"/)
      expect(out).toMatch(/aria-pressed="false"[^>]*data-report-reason="abusive"/)
      const buttons = find(tree, (p) => typeof p['data-report-reason'] === 'string')
      expect(buttons.map((b) => b.props['data-report-reason'])).toEqual(['spam', 'abusive', 'other'])
      ;(buttons[0]!.props.onClick as () => void)()
      expect(onReason).toHaveBeenLastCalledWith(null)
      ;(buttons[2]!.props.onClick as () => void)()
      expect(onReason).toHaveBeenLastCalledWith('other')
    })

    it(`${name}: no reason chosen is fine — none is pressed`, () => {
      const out = html(createElement('div', null, Fields({ reason: null, onReason: noop, note: 'rude', onNote: noop })))
      expect(out).not.toContain('aria-pressed="true"')
      expect(out).toContain('4 / 500')
    })
  }
})

describe('the phone Report sheet', () => {
  const sheet = (type: 'list' | 'comment' = 'list') =>
    html(createElement(ReportSheet, { open: true, onOpenChange: noop, target: { type, id: 'l1' }, quote: 'Week 7 board' }))

  it('the same form in the sheets’ language: title, help, quote, reasons, note, Send report', () => {
    const out = sheet()
    expect(out).toContain('data-sheet="Report this list"')
    expect(out).toContain(`data-sub="${REPORT_HELP}"`)
    expect(out).toContain('Week 7 board')
    for (const reason of ['>Spam<', '>Abusive<', '>Something else<']) expect(out).toContain(reason)
    expect(out).toMatch(new RegExp(`<textarea[^>]*maxLength="${REPORT_NOTE_MAX}"`))
    expect(out).toContain('>Send report<')
  })

  it('light and dark: m-* tokens and the blue action, no dark: variants, no red paint', () => {
    const out = sheet('comment')
    expect(out).toContain('bg-m-b1')
    expect(out).toContain('text-m-t1')
    expect(out).toContain('bg-accent')
    expect(out).not.toMatch(/\bdark:/)
    expect(out).not.toMatch(RED_FILL)
  })
})

describe('the control: Report, then "Reported"', () => {
  it('desktop menu item: Report list / Report comment, with the flag', () => {
    const list = html(createElement(ReportMenuItem, { type: 'list', reported: false, onSelect: noop }))
    expect(list).toContain('Report list')
    expect(list).toContain('data-report="list"')
    expect(list).not.toContain('aria-disabled')
    expect(html(createElement(ReportMenuItem, { type: 'comment', reported: false, onSelect: noop }))).toContain('Report comment')
  })

  it('desktop, reported: "Reported" — can’t be pressed, and stays legible (not the greyed-out look)', () => {
    const out = html(createElement(ReportMenuItem, { type: 'list', reported: true, onSelect: noop }))
    expect(out).toContain('>Reported')
    expect(out).toContain('aria-disabled="true"')
    expect(out).toContain('data-[disabled]:opacity-100')
    expect(out).not.toContain('Report list')
  })

  it('phone row: Report list, then "Reported" (not a button)', () => {
    const row = html(createElement(ReportRow, { type: 'list', reported: false, onReport: noop }))
    expect(row).toContain('Report list')
    expect(row).toContain('<button')
    const done = html(createElement(ReportRow, { type: 'list', reported: true, onReport: noop }))
    expect(done).toContain('>Reported<')
    expect(done).not.toContain('<button')
    expect(done).toContain('text-m-t3')
  })
})
