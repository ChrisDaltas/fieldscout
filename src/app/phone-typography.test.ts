import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'

import postcss, { type Declaration, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * Phone typography (gap list §4 item 4): every handoff screen sets
 * `font-feature-settings:'tnum' 1,'cv11' 1` on the phone root — even-width
 * digits so number columns line up, and Inter's single-storey "a". The phone
 * layout gets both everywhere; desktop keeps proportional digits and the
 * Google Inter it had.
 *
 * Google's Inter has `tnum` but strips the character variants, so `cv11` needs
 * the full Inter build (src/app/fonts/inter-variable.woff2), loaded for the
 * phone layout only. These pins hold the three pieces together: the CSS, the
 * font file's features, and how layout.tsx loads it.
 */

const ROOT = process.cwd()
const PHONE = "html[data-layout='mobile']"
const FEATURES = "'tnum' 1, 'cv11' 1"

const css = postcss.parse(readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8'))

/** Every declaration of `prop` in globals.css, with its rule's selector. */
function decls(prop: string): { selector: string; value: string }[] {
  const out: { selector: string; value: string }[] = []
  css.walkDecls(prop, (d: Declaration) => {
    out.push({ selector: (d.parent as Rule).selector, value: d.value })
  })
  return out
}

function declIn(selector: string, prop: string): string | undefined {
  return decls(prop).find((d) => d.selector === selector)?.value
}

describe('phone layout: tabular digits and the single-storey "a"', () => {
  it('the whole phone layout gets tnum + cv11 (body, so overlays and portals have it too)', () => {
    expect(declIn(`${PHONE} body`, 'font-feature-settings')).toBe(FEATURES)
  })

  it('.fs-num keeps the "a" on the phone (its own tnum-only setting would drop cv11)', () => {
    expect(declIn('.fs-num', 'font-feature-settings')).toBe("'tnum' 1")
    expect(declIn(`${PHONE} .fs-num`, 'font-feature-settings')).toBe(FEATURES)
  })

  it('the phone font leads the stack, with Google Inter behind it while it loads', () => {
    for (const prop of ['--font-sans', '--font-mono']) {
      expect(declIn(`${PHONE} body`, prop)).toBe('var(--font-inter-phone), var(--font-inter)')
    }
  })

  it('desktop is untouched: cv11 and the phone font only ever appear under the phone selector', () => {
    for (const { selector, value } of decls('font-feature-settings')) {
      if (/cv11/.test(value)) expect(selector.startsWith(PHONE)).toBe(true)
    }
    css.walkDecls((d: Declaration) => {
      if (/--font-inter-phone/.test(d.value)) expect((d.parent as Rule).selector.startsWith(PHONE)).toBe(true)
    })
    // The plain body rule still points every face at the Google Inter.
    expect(declIn('body', '--font-sans')).toBe('var(--font-inter)')
    expect(declIn('body', '--font-mono')).toBe('var(--font-inter)')
  })

  it('no component sets its own font features (it would switch the phone’s tnum/cv11 off)', () => {
    const offenders = sourceFiles(path.join(ROOT, 'src'))
      .filter((f) => !f.endsWith(path.join('src', 'app', 'globals.css')))
      .filter((f) => /font-feature-settings|fontFeatureSettings/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f))
    expect(offenders).toEqual([])
  })
})

describe('the phone font file', () => {
  const font = readWoff2(path.join(ROOT, 'src/app/fonts/inter-variable.woff2'))

  it('has the features the phone turns on (Google’s copy lacks cv11)', () => {
    const features = gsubFeatureTags(font.get('GSUB')!)
    expect(features).toContain('tnum')
    expect(features).toContain('cv11')
  })

  it('has the optical-size axis up to Display (opsz 32) and the full weight range', () => {
    const axes = fvarAxes(font.get('fvar')!)
    expect(axes.opsz).toEqual({ min: 14, max: 32 })
    expect(axes.wght).toEqual({ min: 100, max: 900 })
  })

  it('ships with its OFL licence and copyright (OFL 1.1 condition 2: every copy carries both)', () => {
    expect(nameRecord(font.get('name')!, 13)).toMatch(/SIL Open Font License/)
    expect(nameRecord(font.get('name')!, 0)).toMatch(/Inter Project Authors/)
    // The name table only points at the licence, so its full text sits beside the font.
    const licence = readFileSync(path.join(ROOT, 'src/app/fonts/LICENSE-inter.txt'), 'utf8')
    expect(licence).toMatch(/^Copyright 2016 The Inter Project Authors \(https:\/\/github\.com\/rsms\/inter\)/)
    expect(licence).toMatch(/SIL OPEN FONT LICENSE Version 1\.1 - 26 February 2007/)
    expect(licence).toMatch(/PERMISSION & CONDITIONS[\s\S]*TERMINATION[\s\S]*DISCLAIMER/)
  })

  it('stays subset (L.F1.4): the full 367 KB build cost a phone ~1.8 s of first paint; the subset is 114,940 bytes', () => {
    // A re-export of the full build (every script, 2,937 glyphs) fails here.
    expect(statSync(path.join(ROOT, 'src/app/fonts/inter-variable.woff2')).size).toBeLessThanOrEqual(120_000)
  })

  it('layout.tsx loads it as --font-inter-phone without a preload, so desktop never downloads it', () => {
    const layout = readFileSync(path.join(ROOT, 'src/app/layout.tsx'), 'utf8')
    const call = /localFont\(\{([\s\S]*?)\}\)/.exec(layout)?.[1] ?? ''
    expect(call).toMatch(/src: '\.\/fonts\/inter-variable\.woff2'/)
    expect(call).toMatch(/preload: false/)
    expect(call).toMatch(/variable: '--font-inter-phone'/)
    expect(layout).toMatch(/interPhone\.variable/)
  })
})

// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** WOFF2 → its sfnt tables by tag. A transformed table (glyf/loca/hmtx in a
 *  standard WOFF2) comes back in its transformed form — fine for the tables
 *  read here, which are never transformed. */
function readWoff2(file: string): Map<string, Buffer> {
  const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca',
    'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE',
    'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
    'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx',
    'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill']
  const buf = readFileSync(file)
  expect(buf.toString('latin1', 0, 4)).toBe('wOF2')
  let p = 48
  const base128 = () => {
    let v = 0
    for (let i = 0; i < 5; i++) {
      const b = buf[p++]
      v = v * 128 + (b & 0x7f)
      if (!(b & 0x80)) return v
    }
    throw new Error('bad UIntBase128')
  }
  const entries: { tag: string; length: number }[] = []
  for (let i = 0, n = buf.readUInt16BE(12); i < n; i++) {
    const flags = buf[p++]
    let tag = KNOWN[flags & 0x3f]
    if ((flags & 0x3f) === 0x3f) {
      tag = buf.toString('latin1', p, p + 4)
      p += 4
    }
    const origLength = base128()
    const version = flags >> 6
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0
    entries.push({ tag, length: transformed ? base128() : origLength })
  }
  const data = brotliDecompressSync(buf.subarray(p, p + buf.readUInt32BE(20)))
  const tables = new Map<string, Buffer>()
  let offset = 0
  for (const { tag, length } of entries) {
    tables.set(tag, data.subarray(offset, offset + length))
    offset += length
  }
  return tables
}

function gsubFeatureTags(gsub: Buffer): string[] {
  const list = gsub.readUInt16BE(6)
  const count = gsub.readUInt16BE(list)
  return Array.from({ length: count }, (_, i) => gsub.toString('latin1', list + 2 + 6 * i, list + 6 + 6 * i))
}

function fvarAxes(fvar: Buffer): Record<string, { min: number; max: number }> {
  const start = fvar.readUInt16BE(4)
  const size = fvar.readUInt16BE(10)
  const axes: Record<string, { min: number; max: number }> = {}
  for (let i = 0, n = fvar.readUInt16BE(8); i < n; i++) {
    const o = start + size * i
    axes[fvar.toString('latin1', o, o + 4)] = { min: fvar.readInt32BE(o + 4) / 65536, max: fvar.readInt32BE(o + 12) / 65536 }
  }
  return axes
}

function nameRecord(name: Buffer, id: number): string | undefined {
  const strings = name.readUInt16BE(4)
  for (let i = 0, n = name.readUInt16BE(2); i < n; i++) {
    const o = 6 + 12 * i
    if (name.readUInt16BE(o) === 3 && name.readUInt16BE(o + 6) === id) {
      const len = name.readUInt16BE(o + 8)
      const at = strings + name.readUInt16BE(o + 10)
      return Buffer.from(name.subarray(at, at + len)).swap16().toString('utf16le')
    }
  }
  return undefined
}
