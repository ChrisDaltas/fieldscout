/**
 * FieldScout Mobile — the shared bottom sheet's polish (gap list §4 item 3),
 * rendered: the optional blue header pill (the Lists and Rankings file's
 * Done / Cancel / Submit, lr-frame §2.10) in place of the ×, closing the
 * sheet by default; the grab zone a mouse pulls from; the slide up and down;
 * and the Lists and Rankings sheets the design draws carrying their pill.
 * Each "shown" case is paired with the "not shown" one.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement, forwardRef, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// Radix portals don't render on the server: the panel is drawn inline, and
// its children are kept so a test can press the header pill.
const drawn: { children: ReactNode } = { children: null }
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  SheetContent: forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(function Panel({ children, className }, ref) {
    drawn.children = children
    return createElement('div', { ref, 'data-panel': '', className }, children)
  }),
  SheetTitle: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
  SheetDescription: ({ children }: { children: ReactNode }) => createElement('p', null, children),
}))

import { MobileSheet, type MobileSheetAction } from './mobile-sheet'

function render(props: { action?: MobileSheetAction; showClose?: boolean; onOpenChange?: (open: boolean) => void }): string {
  const sheet: ComponentProps<typeof MobileSheet> = {
    open: true,
    onOpenChange: props.onOpenChange ?? (() => {}),
    title: 'Add players',
    subtitle: '4 in your list',
    action: props.action,
    showClose: props.showClose,
    children: createElement('p', null, 'rows'),
  }
  return renderToStaticMarkup(createElement(MobileSheet, sheet))
}

/** The element in the drawn tree carrying `data-sheet-action`. */
function pill(node: ReactNode): ReactElement<{ onClick: () => void }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = pill(child)
      if (hit) return hit
    }
    return null
  }
  if (!isValidElement<{ children?: ReactNode; 'data-sheet-action'?: boolean; onClick: () => void }>(node)) return null
  if (node.props['data-sheet-action']) return node
  return pill(node.props.children)
}

function buttonOf(html: string, marker: string): string {
  const hit = html.split('<button').slice(1).find((b) => b.includes(marker))
  if (!hit) throw new Error(`no button with ${marker}`)
  return hit
}

describe('MobileSheet header pill (lr-frame §2.10)', () => {
  it('draws the design’s blue pill — 32px tall, 14px sides, 13/600, white on blue — with its label', () => {
    const html = render({ action: { label: 'Done' } })
    const button = buttonOf(html, 'data-sheet-action')
    expect(button).toContain('>Done</button>')
    for (const cls of ['h-8', 'px-3.5', 'rounded-pill', 'text-[13px]', 'font-semibold', 'bg-accent', 'text-white', 'active:bg-accent-strong']) {
      expect(button).toContain(cls)
    }
  })

  it('takes the × slot: a sheet shows the pill or the ×, never both', () => {
    const withPill = render({ action: { label: 'Cancel' }, showClose: true })
    expect(withPill).toContain('>Cancel</button>')
    expect(withPill).not.toContain('aria-label="Close"')

    const withClose = render({ showClose: true })
    expect(withClose).toContain('aria-label="Close"')
    expect(withClose).not.toContain('data-sheet-action')
  })

  it('a plain sheet shows neither', () => {
    const html = render({})
    expect(html).not.toContain('data-sheet-action')
    expect(html).not.toContain('aria-label="Close"')
  })

  it('with no handler of its own, the pill closes the sheet (Done / Cancel)', () => {
    const onOpenChange = vi.fn()
    render({ action: { label: 'Done' }, onOpenChange })
    pill(drawn.children)?.props.onClick()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('with a handler (Submit), the pill runs it instead of closing', () => {
    const onOpenChange = vi.fn()
    const submit = vi.fn()
    render({ action: { label: 'Submit', onClick: submit }, onOpenChange })
    pill(drawn.children)?.props.onClick()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('a disabled pill greys out and can’t be pressed', () => {
    const button = buttonOf(render({ action: { label: 'Submit', disabled: true } }), 'data-sheet-action')
    expect(button).toContain('disabled=""')
    expect(button).toContain('disabled:bg-m-b3s')
  })

  it('centres the pill against the title and sub-line (the design’s align-items:center); the × stays top-aligned', () => {
    expect(render({ action: { label: 'Done' } })).toMatch(/class="[^"]*items-center[^"]*"><div class="flex min-w-0 flex-1/)
    expect(render({ showClose: true })).toMatch(/class="[^"]*items-start[^"]*"><div class="flex min-w-0 flex-1/)
  })
})

describe('MobileSheet pull-down and slide (gap list §4 item 3)', () => {
  it('the handle and title row are the grab zone, and the page doesn’t scroll or select text from it', () => {
    const html = render({ action: { label: 'Done' } })
    const zone = html.match(/<div class="([^"]*)" data-sheet-grab="true">/)
    expect(zone?.[1]).toContain('touch-none')
    expect(zone?.[1]).toContain('select-none')
    // The handle and the title are both inside it.
    const inside = html.slice(html.indexOf('data-sheet-grab'))
    expect(inside.indexOf('w-9 rounded-pill bg-m-b4')).toBeLessThan(inside.indexOf('<h2>Add players</h2>'))
  })

  const src = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')

  it('the phone panel slides up to open and down to close, 200ms linear, and not at all under reduced motion', () => {
    const sheet = src('src/components/ui/sheet.tsx')
    const mobile = sheet.match(/mobile:\s*"([^"]+)"/)?.[1] ?? ''
    expect(mobile).toContain('data-[state=open]:slide-in-from-bottom')
    expect(mobile).toContain('data-[state=closed]:slide-out-to-bottom')
    expect(mobile).toContain('motion-reduce:!animate-none')
    expect(mobile).not.toContain('animate-none data-')
    // The shared base supplies the 200ms linear animate-in / animate-out.
    expect(sheet).toMatch(/transition ease-linear data-\[state=closed\]:duration-200 data-\[state=open\]:duration-200 data-\[state=open\]:animate-in data-\[state=closed\]:animate-out/)
  })

  it('the backdrop fades with it (and not under reduced motion)', () => {
    const own = src('src/components/mobile/ui/mobile-sheet.tsx')
    const overlay = own.match(/overlayClassName="([^"]+)"/)?.[1] ?? ''
    expect(overlay).toContain('bg-black/[0.32]')
    expect(overlay).toContain('ease-linear')
    expect(overlay).toContain('motion-reduce:!animate-none')
    expect(overlay).not.toContain('animate-none data-')
  })

  it('the Lists and Rankings sheets the design draws carry its pill, not the ×', () => {
    const sheets: [string, string][] = [
      ['src/components/mobile/lists/add-players-sheet.tsx', 'Done'],
      ['src/components/mobile/lists/add-stats-sheet.tsx', 'Done'],
      ['src/components/mobile/lists/import-sheet.tsx', 'Cancel'],
    ]
    for (const [file, label] of sheets) {
      const code = src(file)
      expect(code, file).toContain(`action={{ label: '${label}' }}`)
      expect(code, file).not.toMatch(/\bshowClose\b/)
    }
    // The ranking editor's Add players sheet (its Scoring sheet keeps the ×).
    const editor = src('src/components/mobile/rankings/ranking-editor.tsx')
    expect(editor).toMatch(/title="Add players" subtitle=\{`\$\{count\} in your ranking`\} action=\{\{ label: 'Done' \}\}/)
  })
})
