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
 * 2. **The red's raw values live only in its tokens.** `#FF0028`, its rgb
 *    triple `255 0 40`, its hsl `351 100% 50%`, `var(--destructive)` and a
 *    `theme('colors.negative.strong')` lookup appear (outside comments) only
 *    where the tokens are defined — so a new alias token (`--m-alarm: 255 0
 *    40` used as `bg-m-alarm`) or a string constant (`const RED = '#FF0028'`
 *    used in a `style`) cannot carry the red past pin 1's name-based
 *    patterns. The one alias that exists, the phone's `m-red` (the bright red
 *    text that brightens in phone dark mode, gap list §4 item 6), is a
 *    registered home below AND a name pin 1 watches — `bg-m-red` fails, and
 *    so do its var (`bg-[rgb(var(--m-red))]`, `background: rgb(var(--m-red))`)
 *    and a `theme('colors.m.red')` lookup.
 * 3. **No pill-ended system message.** The toast container and every element
 *    whose `role` is — or can be — `alert` / `status` (a literal
 *    `role="alert"` or an expression like `role={err ? 'alert' : undefined}`)
 *    must not use `rounded-pill` / `rounded-full`; the toast uses
 *    `rounded-message`. Buttons and chips INSIDE a message stay pills — that
 *    is their shape, not the message's. A message with no role at all is not
 *    seen here; a reviewer catches those (CLAUDE.md names what to look for).
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
  // The YouTube play mark is a wordless logo glyph, not a surface. Two of the
  // three are larger than the other indicators here (32×22, 40×28 — over a
  // video thumbnail); whether they stay red is Chris's call (asked
  // 2026-10-18). If not: a white play glyph on a `bg-black/75` scrim, or the
  // mark shrunk to ≤20px.
  'src/components/mobile/lists/lists-parts.tsx': {
    count: 2,
    why: 'the YouTube play mark — a wordless logo glyph: 32×22 over a video thumbnail, and the 20×14 inline badge',
  },
  'src/components/mobile/community/community-detail.tsx': {
    count: 1,
    why: 'the YouTube play mark — a wordless logo glyph, 40×28 over a video thumbnail',
  },
}

/** The bright red as a Tailwind fill: `bg-` and gradient stops, any prefix.
 *  `m-red` is the phone's themed name for the same red (text only). */
const RED_FILL_CLASS = /(?<![\w-])(?:bg|from|via|to)-(?:negative-strong|destructive|m-red)(?![\w-])/g

/** The bright red as an arbitrary-value fill: hex, rgb, its hsl or its vars. */
const RED_FILL_ARBITRARY =
  /(?<![\w-])(?:bg|from|via|to|fill)-\[(?:color:)?(?:#ff0028|rgba?\(255[,_\s]+0[,_\s]+40|hsla?\((?:var\(--destructive|351[,_\s]+100%)|var\(--destructive|(?:rgba?\()?var\(--m-red\))/gi

/** Inline style / CSS background or SVG fill set to the literal red or its vars. */
const RED_FILL_STYLE =
  /(?:background(?:-?color)?|fill)\s*[:=]\s*[{'"`]?[^;\n]{0,60}?(?:#ff0028|rgba?\(\s*255\s*[,\s]\s*0\s*[,\s]\s*40\b|var\(--destructive\)|hsla?\(\s*var\(--destructive|var\(--m-red\))/gi

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

/**
 * Where a source's block comments are, as [start, end) ranges. An opener is
 * `/*` followed by whitespace, `*` or `!`, as a real comment always is — so a
 * glob's `/*.{ts,tsx}` opens nothing, and its `/**\/` closes at once.
 */
function blockComments(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const opener = /\/\*(?=[\s*!])/g
  for (let m = opener.exec(source); m; m = opener.exec(source)) {
    const close = source.indexOf('*/', m.index + 2)
    const end = close === -1 ? source.length : close + 2
    ranges.push([m.index, end])
    opener.lastIndex = end
  }
  return ranges
}

/**
 * True when the match is prose, not code — prose may name the classes and the
 * red. Covers comment lines, a trailing `// …` (not a URL's `://`) and the
 * inside of any block comment, including its continuation lines and a trailing
 * `/* #FF0028 *\/` after a declaration.
 */
function inComment(source: string, index: number, ranges = blockComments(source)): boolean {
  const line = source.slice(source.lastIndexOf('\n', index - 1) + 1, index)
  if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return true
  if (/(?<![:'"(])\/\//.test(line)) return true
  return ranges.some(([start, end]) => index >= start && index < end)
}

const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length

/** Every match of `patterns` outside comments, as "line N: match". */
function codeHits(source: string, patterns: RegExp[]): string[] {
  const ranges = blockComments(source)
  const hits = new Map<number, string>()
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (inComment(source, match.index, ranges)) continue
      // One hit per position, whichever pattern saw it first.
      if (!hits.has(match.index)) hits.set(match.index, `line ${lineOf(source, match.index)}: ${match[0]}`)
    }
  }
  return [...hits.entries()].sort((a, b) => a[0] - b[0]).map(([, hit]) => hit)
}

/** Every bright-red fill in a source, as "line N: match". */
const redFillsIn = (source: string) => codeHits(source, PATTERNS)

/**
 * The bright red's raw values, however spelled: the hex (with or without an
 * alpha pair), the rgb triple, the hsl, its CSS variables (`--destructive` and
 * the phone's `--m-red`), and a Tailwind `theme()` / resolved-config lookup of
 * any of its tokens. `--destructive-foreground` is the white "text on red"
 * var, not the red.
 */
const RED_VALUE =
  /#ff0028|(?<![\d.])255[,_\s]+0[,_\s]+40(?![\d.])|(?<![\d.])351(?:deg)?[,_\s]+100%|var\(--destructive\)|var\(--m-red\)|colors\.(?:negative\.strong|destructive|m\.red)(?![\w-])/gi

/** Every raw value of the bright red in a source, as "line N: match". */
const redValuesIn = (source: string) => codeHits(source, [RED_VALUE])

/**
 * The only places the red's raw value may be written: the token definitions.
 * Everything else names a token (`text-negative-strong`, `text-destructive`,
 * `shadow-ring-negative`), which pin 1 can see. Exact counts, like
 * SMALL_INDICATORS.
 */
const RED_VALUE_HOMES: Record<string, { count: number; why: string }> = {
  'tailwind.config.ts': {
    count: 4,
    why:
      '`negative.strong`, the `ring-negative` shadow, `destructive.DEFAULT` (its var), and the ' +
      "phone's `m.red` colour (`rgb(var(--m-red) / <alpha-value>)`)",
  },
  'src/app/globals.css': {
    count: 3,
    why:
      'the `--destructive` definition, and the phone\'s `--m-red` text token in the light palette and in ' +
      'the light reset for pages with no phone screen (its dark value is #FF6B6B)',
  },
}

const files = sourceFiles(SRC)
const CONFIG = path.join(ROOT, 'tailwind.config.ts')

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
      'className="bg-m-red text-white"',
      "cls = 'active:bg-m-red/90'",
      // The phone alias's var, past the bg-m-red name.
      'className="bg-[rgb(var(--m-red))] text-white"',
      "style={{ background: 'rgb(var(--m-red))' }}",
    ]
    for (const sample of samples) expect(redFillsIn(sample), sample).toHaveLength(1)

    const allowed = [
      'className="text-negative-strong"',
      'className="bg-negative-soft text-negative-strong"',
      'className="hover:bg-negative-soft hover:text-negative-strong"',
      'className="border-negative-strong shadow-ring-negative"',
      'className="fill-negative-strong"', // an icon's glyph colour
      'className="bg-destructive-foreground"',
      'className="text-m-red"', // the phone's bright red words
      'className="bg-m-gr text-m-red"',
      '// bg-negative-strong in a comment',
      ' * bg-negative-strong in a block comment',
      '/* a block comment\n   whose next line names bg-negative-strong */',
      'const x = 1 // bg-negative-strong in a trailing comment',
    ]
    for (const sample of allowed) expect(redFillsIn(sample), sample).toEqual([])
  })

  it('the red-value pattern catches an alias token or a constant (self-check)', () => {
    // Each of these dodges the name-based fill patterns above on its own.
    const samples = [
      "const RED = '#FF0028'", // then style={{ background: RED }}
      "const RED = '#ff002880'",
      '--m-red: 255 0 40;', // then bg-m-red
      "alert: 'rgb(255, 0, 40)',",
      "alarm: 'hsl(var(--destructive))',", // then bg-alarm
      '--alarm: 351 100% 50%;',
      "background: theme('colors.negative.strong');",
      'const c = fullConfig.theme.colors.destructive',
      // The phone alias `m-red`: its var and a theme lookup.
      'className="bg-[rgb(var(--m-red))] text-white"',
      "style={{ background: 'rgb(var(--m-red))' }}",
      "theme('colors.m.red')",
    ]
    for (const sample of samples) expect(redValuesIn(sample), sample).toHaveLength(1)

    const allowed = [
      "className='text-negative-strong'",
      "className='text-m-red'", // the token's name, not its value
      "foreground: 'hsl(var(--destructive-foreground))',",
      '--m-tr: 200 0 28;',
      '--x: 255 0 400;',
      '--shadow: 0 0 0 1px rgb(255 0 4);',
      '--destructive-foreground: 0 0% 100%; /* white text on #FF0028 */',
      "content: ['./src/**/*.{ts,tsx}'], // a glob is not a comment opener",
    ]
    for (const sample of allowed) expect(redValuesIn(sample), sample).toEqual([])
    // ...and a glob's `/*` does not hide the code after it.
    expect(redValuesIn("content: ['./src/**/*.tsx'],\nstrong: '#FF0028',")).toHaveLength(1)
  })

  for (const file of [...files, CONFIG]) {
    const key = rel(file)
    const home = RED_VALUE_HOMES[key]
    const hits = redValuesIn(readFileSync(file, 'utf8'))
    if (!home && hits.length === 0) continue
    it(`${key} — the bright red's raw value only where a token defines it`, () => {
      expect(
        hits,
        `${key} writes the bright red's raw value (${hits.join('; ')}). Outside its token ` +
          'definitions that is an alias or a constant the fill guard cannot see. Name the token ' +
          'instead (text-negative-strong / text-destructive / shadow-ring-negative)' +
          (home ? `; this file's definitions are: ${home.why}.` : '.'),
      ).toHaveLength(home ? home.count : 0)
    })
  }

  it('every red-value home still exists', () => {
    for (const key of Object.keys(RED_VALUE_HOMES)) {
      expect(() => statSync(path.join(ROOT, key)), key).not.toThrow()
    }
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
          'and small icons: give the surface a soft tint (bg-negative-soft on desktop, bg-m-gr on the ' +
          'phone) or the normal surface, and carry the red with text-negative-strong / ' +
          'text-m-tr / text-m-red or a small red icon. If it is genuinely a tiny dot, count badge or icon, add the ' +
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

/** A message role: `role="alert"`, or an expression that can yield one. */
const MESSAGE_ROLE = /\brole=(?:["'](?:alert|status)["']|\{[^}]*?["'`](?:alert|status)["'`][^}]*\})/

/** A JSX opening tag's `<Name` — not a generic (`useState<T>`) or a `<` comparison. */
const TAG_OPEN = /(?<![\w$)\]])<([A-Za-z][\w.]*)(?=[\s/>])/g

/**
 * Index of the `>` that closes the opening tag whose attributes start at
 * `from`, or -1. Brace- and quote-aware, so `onClick={() => …}`,
 * `className="[&>svg]:…"` and nested `{cn(…)}` don't end the tag early.
 */
function tagEnd(source: string, from: number): number {
  const stack: string[] = []
  for (let i = from; i < source.length; i++) {
    const c = source[i]
    const top = stack[stack.length - 1]
    if (top === '"' || top === "'" || top === '`') {
      if (c === '\\') i++
      else if (c === top) stack.pop()
      else if (top === '`' && c === '$' && source[i + 1] === '{') {
        stack.push('{')
        i++
      }
      continue
    }
    if (top === '{' && c === '/' && (source[i + 1] === '*' || source[i + 1] === '/')) {
      const close = source[i + 1] === '*' ? source.indexOf('*/', i + 2) + 1 : source.indexOf('\n', i)
      if (close <= 0) return -1
      i = close
      continue
    }
    if (c === '"' || c === "'" || c === '`') stack.push(c)
    else if (c === '{') stack.push('{')
    else if (c === '}') stack.pop()
    else if (stack.length === 0 && c === '>') return i
    else if (stack.length === 0 && c === '<') return -1 // not a tag after all
  }
  return -1
}

/** Every pill-ended alert/status container in a source, as "line N". */
function pillMessagesIn(source: string): string[] {
  const ranges = blockComments(source)
  const offenders: string[] = []
  for (const match of source.matchAll(TAG_OPEN)) {
    const end = tagEnd(source, match.index + match[0].length)
    if (end === -1) continue
    const tag = source.slice(match.index, end + 1)
    if (!MESSAGE_ROLE.test(tag) || /animate-spin/.test(tag)) continue
    if (inComment(source, match.index, ranges)) continue
    if (PILL.test(tag)) offenders.push(`line ${lineOf(source, match.index)}`)
  }
  return offenders
}

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

  it('the message-tag scan sees every way a message is written (self-check)', () => {
    const pills = [
      '<div role="alert" className="rounded-pill px-3">',
      // A conditional role — InlineIssue, the phone Notice, refusal boxes.
      "<div role={err ? 'alert' : undefined} className=\"rounded-pill px-3\">",
      "<p role={tone === 'error' ? 'alert' : 'status'} className={cn('px-3', 'rounded-full')}>",
      // A `>` before the className must not end the tag early.
      '<div onClick={() => x()} role="alert" className="rounded-pill px-3">',
      '<div role="status" className="[&>svg]:size-3 rounded-pill px-3">',
      '<Notice\n  role="status"\n  className={cn(\n    "flex",\n    wide && "md:rounded-full",\n  )}\n>',
    ]
    for (const sample of pills) expect(pillMessagesIn(sample), sample).toHaveLength(1)

    const fine = [
      '<div role="alert" className="rounded-message px-3">',
      '<div role="status" className="rounded-xl">',
      // A pill INSIDE a message is a control, not the message.
      '<div role="alert" className="rounded-message"><button className="rounded-pill">Undo</button></div>',
      '<span role="status" className="animate-spin rounded-full" />', // a spinner
      '<button className="rounded-pill" onClick={() => go()}>Save</button>', // no role
      "<div role={open ? 'dialog' : undefined} className=\"rounded-full\">", // not a message role
      '{/* <div role="alert" className="rounded-pill"> */}',
      'const n = items.length<limit ? 1 : 2',
    ]
    for (const sample of fine) expect(pillMessagesIn(sample), sample).toEqual([])
  })

  // Every element whose role is (or can be) alert / status — banners, inline
  // notices, refusal boxes, the layout prompt. Spinners are not messages.
  for (const file of files.filter((f) => f.endsWith('.tsx'))) {
    const source = readFileSync(file, 'utf8')
    if (!/\brole=/.test(source)) continue
    const offenders = pillMessagesIn(source)
    if (offenders.length === 0) continue
    it(`${rel(file)} — its system messages are not pill-ended`, () => {
      expect(
        offenders,
        `${rel(file)}: an alert/status container is rounded-pill/rounded-full ` +
          `(${offenders.join(', ')}). System messages are rounded rectangles — use rounded-message.`,
      ).toEqual([])
    })
  }
})
