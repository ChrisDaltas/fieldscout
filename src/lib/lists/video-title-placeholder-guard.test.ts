import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Guard — the "YouTube video" placeholder title must not come back.
 *
 * Chris, 2026-10-15 (mobile gap list #11, correcting the first build): "we
 * need the actual YouTube titles or nothing. Having a bunch of videos with
 * the same title is useless." A video link's title is YouTube's real one or
 * NULL (migration 189) — never a stand-in, neither stored nor displayed.
 *
 * This scans every non-test source file under `src/` for the old placeholder
 * as a STRING or JSX TEXT — quoted ('…', "…", `…`) or between tags (>…<),
 * any casing. Comments are stripped first, so a docblock can tell the
 * history, and prose like "a YouTube video link" is not a literal.
 */

const ROOT = 'src'
const SOURCE = /\.(ts|tsx)$/
const TEST = /\.test\.(ts|tsx)$/

/** The placeholder as something that could be stored or rendered. */
const PLACEHOLDER_LITERAL = /(['"`>])\s*youtube video\s*(['"`<])/i

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function hasPlaceholderLiteral(source: string): boolean {
  return PLACEHOLDER_LITERAL.test(stripComments(source))
}

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (SOURCE.test(name) && !TEST.test(name)) out.push(full)
  }
  return out
}

describe('no "YouTube video" placeholder title in src', () => {
  it('the detector catches the placeholder in every shape it could ship in, and only those', () => {
    for (const shipped of [
      "export const VIDEO_TITLE_FALLBACK = 'YouTube video'",
      'title={link.title || "YouTube video"}',
      '<span>YouTube video</span>',
      'const t = `Youtube Video`',
      "{video.title ?? 'youtube video'}",
    ]) {
      expect(hasPlaceholderLiteral(shipped), shipped).toBe(true)
    }
    for (const prose of [
      '// A YouTube video POSTed without a title',
      '/** First YouTube video id on a list, if any. */',
      "/**\n * the placeholder 'YouTube video' — retired\n */",
      "{/* the old 'YouTube video' title */}",
      "const label = 'Watch on YouTube'",
    ]) {
      expect(hasPlaceholderLiteral(prose), prose).toBe(false)
    }
  })

  it('no source file under src/ (tests aside) carries it', () => {
    const files = walk(ROOT, [])
    // Not vacuous: the scan really read the app, including the files that
    // used to carry the placeholder.
    expect(files.length).toBeGreaterThan(500)
    for (const known of [
      'src/lib/lists/links-service.ts',
      'src/utils/youtube.ts',
      'src/components/mobile/lists/list-view.tsx',
      'src/components/lists/v2/list-details-tab.tsx',
    ]) {
      expect(files.map((f) => f.split(path.sep).join('/'))).toContain(known)
    }

    const offenders = files.filter((file) => hasPlaceholderLiteral(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
