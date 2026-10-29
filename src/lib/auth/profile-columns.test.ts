/**
 * PROFILE_READABLE_COLUMNS mirrors migration 210's column GRANT (F720), and no
 * app read of `profiles` through a user's client asks for everything.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { PROFILE_READABLE_COLUMNS } from './profile-columns'

const ROOT = process.cwd()
const MIGRATION = readFileSync(path.join(ROOT, 'supabase/migrations/210_security_hardening_followups.sql'), 'utf8')

const split = (list: string) => list.split(',').map((c) => c.trim()).filter(Boolean)

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('PROFILE_READABLE_COLUMNS', () => {
  it('is exactly the column list migration 210 grants to anon / authenticated', () => {
    const grant = MIGRATION.match(/GRANT SELECT \(([^)]*)\)\s+ON public\.profiles TO anon, authenticated;/)
    expect(grant, '210 no longer carries the profiles column GRANT').not.toBeNull()
    expect(split(PROFILE_READABLE_COLUMNS)).toEqual(split(grant![1]!))
  })

  it('leaves out the two columns 210 took out of public reads', () => {
    expect(split(PROFILE_READABLE_COLUMNS)).not.toContain('is_admin')
    expect(split(PROFILE_READABLE_COLUMNS)).not.toContain('stripe_customer_id')
  })
})

/** Every profiles EMBED in a select string — `profiles(…)`, `profiles!fk(…)`,
 *  `alias:profiles!fk(…)` — whose column list asks for `*` or for one of the
 *  two restricted columns (review R1706). An embed is checked against the
 *  same column privileges as a direct read, so `profiles(*)` is refused too. */
function badProfileEmbeds(src: string): string[] {
  const found: string[] = []
  const re = /\bprofiles(?:![a-z0-9_]+)?\s*\(([^()]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const cols = m[1]!
    if (/\*/.test(cols)) found.push(`${m[0]} (asks for every column)`)
    if (/\b(is_admin|stripe_customer_id)\b/.test(cols)) found.push(`${m[0]} (a restricted column)`)
  }
  return found
}

describe('the embed check itself (R1706)', () => {
  it.each([
    ["owner:profiles!lists_owner_id_fkey(*)", 1],
    ["profiles(*)", 1],
    ["author:profiles!list_comments_author_id_fkey(id, is_admin)", 1],
    ["profiles(username, stripe_customer_id)", 1],
    ["profiles ( * )", 1],
    ["owner:profiles!lists_owner_id_fkey(id, username, avatar_url, cred_score, is_pro)", 0],
    ["profiles(username)", 0],
  ] as const)('%s → %i finding(s)', (embed, n) => {
    expect(badProfileEmbeds(`.select('id, ${embed}')`)).toHaveLength(n)
  })
})

describe('no app read of profiles asks for every column', () => {
  const files = walk(path.join(ROOT, 'src'))

  it('scans a real tree (non-vacuous)', () => {
    expect(files.length).toBeGreaterThan(500)
  })

  it('no .from(\'profiles\') chain selects *, () or the two columns', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const re = /\.from\(\s*['"]profiles['"]\s*\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        // the chain up to the end of its statement
        const chunk = src.slice(m.index, m.index + 600)
        const end = chunk.search(/\n\s*\n|;\s*\n|\)\s*\n\s*(const|let|if|return|await|\})/)
        const chain = end > 0 ? chunk.slice(0, end + 1) : chunk
        const line = src.slice(0, m.index).split('\n').length
        const where = `${path.relative(ROOT, file)}:${line}`
        if (/\.select\(\s*\)/.test(chain) || /\.select\(\s*['"`]\s*\*/.test(chain)) offenders.push(`${where} select *`)
        if (/\.select\([^)]*\b(is_admin|stripe_customer_id)\b/.test(chain)) offenders.push(`${where} restricted column`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no profiles embed in any select asks for * or a restricted column (R1706)', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const hit of badProfileEmbeds(readFileSync(file, 'utf8'))) {
        offenders.push(`${path.relative(ROOT, file)}: ${hit}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
