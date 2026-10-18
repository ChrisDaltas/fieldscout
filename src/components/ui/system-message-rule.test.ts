import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Bright red is for words and small icons, never a fill — and every system
 * message is a rounded rectangle (Chris, 2026-10-18; CLAUDE.md → Styling →
 * "Bright red is ink, never paint"). Ruled while looking at the phone's error
 * toast, a bright-red pill: "we don't want the ends of a system message like
 * this being rounded on the ends … or this bright of a red. That red is for
 * text and small icons not backgrounds."
 *
 * Two pins, same source-pin idiom as `elevation-rule.test.ts`:
 *
 * 1. **No bright-red background anywhere in `src/`.** The bright red is
 *    `negative-strong` / `--destructive` (#FF0028). A class, arbitrary value,
 *    inline style or SVG fill that paints a surface with it fails — unless the
 *    file is in SMALL_INDICATORS below, with the exact number of hits and why
 *    each is a small indicator (a live dot, a count badge, a logo glyph).
 *    The count is exact on purpose: a new red fill in an allowlisted file
 *    fails, and so does a removed one, so the list cannot go stale.
 * 2. **No pill-ended system message.** The toast container and every
 *    `role="alert"` / `role="status"` container must not use `rounded-pill` /
 *    `rounded-full`; the toast uses `rounded-message`. Buttons and chips
 *    INSIDE a message stay pills — that is their shape, not the message's.
 */

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')

/**
 * Small indicators — the only places the bright red may be a fill. Adding a
 * file here is a design decision, not a way to silence the test: the question
 * is "is this a dot, a count badge or an icon — or is it a surface (toast,
 * banner, button, chip with text, row, sheet, clock)?". Surfaces use a soft
 * tint (`bg-negative-soft` / `bg-m-gr`) with red text or a red icon instead.
 */
const SMALL_INDICATORS: Record<string, { count: number; why: string }> = {
  'src/components/draft/pick-clock.tsx': {
    count: 1,
    why: '6px status dot inside the low-time pick clock — the clock itself is the soft tint',
  },
  'src/components/mobile/ui/mobile-header.tsx': {
    count: 1,
    why: '16px notification count badge on a header icon',
  },
  'src/components/mobile/home/home-matchups.tsx': {
    count: 1,
    why: '8px "needs you" alert dot on a Home league card',
  },
  'src/components/mobile/league/match/mobile-match.tsx': {
    count: 2,
    why: '6px live dots beside the red "Live" text (week badge, scoreboard row)',
  },
  'src/components/mobile/league/game/nfl-game-screen.tsx': {
    count: 1,
    why: '6px live dot beside the game clock',
  },
  'src/components/mobile/lists/lists-parts.tsx': {
    count: 2,
    why: 'the YouTube play mark — a logo glyph with no text (over a video thumbnail, and the 20×14 inline badge)',
  },
  'src/components/mobile/community/community-detail.tsx': {
    count: 1,
    why: 'the YouTube play mark over a video thumbnail — a logo glyph with no text',
  },
}

/** The bright red as a Tailwind fill: `bg-` and gradient stops, any prefix. */
const RED_FILL_CLASS = /(?<![\w-])(?:bg|from|via|to)-(?:negative-strong|destructive)(?![\w-])/g

/** The bright red as an arbitrary-value fill: hex, rgb, its hsl or its var. */
const RED_FILL_ARBITRARY =
  /(?<![\w-])(?:bg|from|via|to|fill)-\[(?:color:)?(?:#ff0028|rgba?\(255[,_\s]+0[,_\s]+40|hsla?\((?:var\(--destructive|351[,_\s]+100%)|var\(--destructive)/gi

/** Inline style / CSS background or SVG fill set to the literal red. */
const RED_FILL_STYLE =
  /(?:background(?:-?color)?|fill)\s*[:=]\s*[{'"`]?[^;\n]{0,60}?(?:#ff0028|rgba?\(\s*255\s*[,\s]\s*0\s*[,\s]\s*40\b|var\(--destructive\)|hsla?\(\s*var\(--destructive)/gi

const PATTERNS = [RED_FILL_CLASS, RED_FILL_ARBITRARY, RED_FILL_STYLE]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** `src/…` path with forward slashes — the allowlist's keys. */
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

/** True when the match sits on a comment line — prose may name the classes. */
function inComment(source: string, index: number): boolean {
  const line = source.slice(source.lastIndexOf('\n', index) + 1, index)
  return /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)
}

/** Every bright-red fill in a source, as "line N: match". */
function redFillsIn(source: string): string[] {
  const hits = new Map<number, string>()
  for (const pattern of PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (inComment(source, match.index)) continue
      // One hit per position, whichever pattern saw it first.
      if (!hits.has(match.index)) {
        const line = source.slice(0, match.index).split('\n').length
        hits.set(match.index, `line ${line}: ${match[0]}`)
      }
    }
  }
  return [...hits.entries()].sort((a, b) => a[0] - b[0]).map(([, hit]) => hit)
}

const files = sourceFiles(SRC)

describe('bright red is for text and small icons, never a background', () => {
  it('finds the source files to check', () => {
    // Guards against the walk silently matching nothing after a move.
    expect(files.length).toBeGreaterThan(500)
    expect(files.map(rel)).toContain('src/components/ui/toast.tsx')
    expect(files.map(rel)).toContain('src/app/globals.css')
  })

  it('the patterns catch every spelling of a red fill (self-check)', () => {
    const samples = [
      'className="bg-negative-strong text-white"',
      "cls = 'hover:bg-negative-strong/90'",
      'className="mob:bg-destructive"',
      'className="bg-[#FF0028]"',
      'className="bg-[rgb(255_0_40)]"',
      'className="bg-[hsl(var(--destructive))]"',
      "style={{ backgroundColor: '#ff0028' }}",
      "style={{ background: 'hsl(var(--destructive))' }}",
      '<rect width="40" height="20" fill="#FF0028" />',
      '.x { background-color: rgba(255, 0, 40, 1); }',
      'className="bg-gradient-to-r from-negative-strong"',
    ]
    for (const sample of samples) expect(redFillsIn(sample), sample).toHaveLength(1)

    const allowed = [
      'className="text-negative-strong"',
      'className="bg-negative-soft text-negative-strong"',
      'className="hover:bg-negative-soft hover:text-negative-strong"',
      'className="border-negative-strong shadow-ring-negative"',
      'className="fill-negative-strong"', // an icon's glyph colour
      'className="bg-destructive-foreground"',
      '// bg-negative-strong in a comment',
      ' * bg-negative-strong in a block comment',
    ]
    for (const sample of allowed) expect(redFillsIn(sample), sample).toEqual([])
  })

  for (const file of files) {
    const key = rel(file)
    const allowance = SMALL_INDICATORS[key]
    if (allowance) {
      it(`${key} — only its small indicators (${allowance.why})`, () => {
        const hits = redFillsIn(readFileSync(file, 'utf8'))
        expect(
          hits.length,
          `${key} has ${hits.length} bright-red fills (${hits.join('; ')}), the allowlist says ` +
            `${allowance.count}. A new one is a surface until proven a dot/badge/icon — use a soft ` +
            'tint with red text or a red icon. A removed one: lower the count.',
        ).toBe(allowance.count)
      })
      continue
    }
    const hits = redFillsIn(readFileSync(file, 'utf8'))
    if (hits.length === 0) continue
    it(`${key} paints no surface bright red`, () => {
      expect(
        hits,
        `${key} fills a surface with the bright red (${hits.join('; ')}). That red is for text ` +
          'and small icons: give the surface a soft tint (bg-negative-soft / bg-negative on desktop, ' +
          'bg-m-gr on the phone) or the normal surface, and carry the red with text-negative-strong / ' +
          'text-m-tr or a small red icon. If it is genuinely a tiny dot, count badge or icon, add the ' +
          'file to SMALL_INDICATORS with a reason.',
      ).toEqual([])
    })
  }

  it('every allowlisted file still exists', () => {
    const present = new Set(files.map(rel))
    for (const key of Object.keys(SMALL_INDICATORS)) expect(present, key).toContain(key)
  })
})

// ---------------------------------------------------------------------------
// System messages are rounded rectangles
// ---------------------------------------------------------------------------

const PILL = /(?<![\w-])(?:[\w-]+:)*rounded-(?:pill|full)(?![\w-])/

describe('system messages are rounded rectangles, never pill-ended', () => {
  const toast = readFileSync(path.join(SRC, 'components/ui/toast.tsx'), 'utf8')
  const base = toast.slice(toast.indexOf('const toastVariants = cva('), toast.indexOf('variants: {'))

  it('the toast container is a rounded-message rectangle', () => {
    expect(base.length, 'toastVariants not found in toast.tsx').toBeGreaterThan(40)
    expect(base).toContain('rounded-message')
    expect(base, 'the toast container is pill-ended — use rounded-message').not.toMatch(PILL)
  })

  it('the error toast is the same surface as every other toast', () => {
    // The red rides on the leading alert icon (toaster.tsx), not the fill.
    const destructive = toast.match(/destructive:\s*("[^"]*"|'[^']*'|`[^`]*`)/)
    expect(destructive, 'no destructive variant in toastVariants').not.toBeNull()
    expect(destructive![1]).not.toMatch(/(?<![\w-])(?:[\w-]+:)*bg-/)
  })

  it('the error toast leads with a small bright-red alert icon, on both layouts', () => {
    const toaster = readFileSync(path.join(SRC, 'components/ui/toaster.tsx'), 'utf8')
    const alert = toaster.slice(toaster.indexOf('function ToastAlertIcon'))
    expect(alert.length, 'ToastAlertIcon not found in toaster.tsx').toBeGreaterThan(40)
    expect(alert.slice(0, 900)).toContain('text-negative-strong')
    expect(alert.slice(0, 900)).not.toContain('mob:hidden')
  })

  // Every role="alert" / role="status" container — banners, inline notices,
  // refusal boxes, the layout prompt. Spinners (animate-spin) are not messages.
  for (const file of files.filter((f) => f.endsWith('.tsx'))) {
    const source = readFileSync(file, 'utf8')
    if (!/role="(?:alert|status)"/.test(source)) continue
    const offenders: string[] = []
    for (const match of source.matchAll(/<[A-Za-z][\w.]*\b[^<>]*?role="(?:alert|status)"[^<>]*?>/g)) {
      const tag = match[0]
      if (/animate-spin/.test(tag)) continue
      if (PILL.test(tag)) offenders.push(`line ${source.slice(0, match.index).split('\n').length}`)
    }
    if (offenders.length === 0) continue
    it(`${rel(file)} — its system messages are not pill-ended`, () => {
      expect(
        offenders,
        `${rel(file)}: a role="alert"/"status" container is rounded-pill/rounded-full ` +
          `(${offenders.join(', ')}). System messages are rounded rectangles — use rounded-message.`,
      ).toEqual([])
    })
  }
})
