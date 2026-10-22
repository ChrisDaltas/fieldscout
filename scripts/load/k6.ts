/**
 * k6 — the wrapper every §22.6 k6 run goes through (M7 L.F2.1; TD2).
 *
 *   npx tsx scripts/load/k6.ts s1|s2|s3|s4 --target test --profile y2026 [--minutes N] [-- <extra k6 args>]
 *
 * It resolves the target (refusing production by name — target.ts), tells
 * k6 where the repo's link file is (FS_LOAD_REPO_ROOTS — k6's init context
 * opens it and derives the production name ITSELF, so `k6 run` by hand
 * against production is refused too, and refused outright with no link file;
 * R1641), adds the other names as FS_LOAD_DENY (additions only), points k6
 * at the seeder's manifest, and
 * runs the entry. Keys and names travel in the child's environment only —
 * nothing is printed, nothing is written.
 *
 * Needs the k6 binary (v1.x — `k6/websockets`, native TypeScript). It is
 * not an npm dependency; install it on the machine that runs the load.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { resolveProfile } from '../../load/k6/config'
import { REPO_ROOT, manifestPath } from './paths'
import { resolveTarget } from './target'

const ENTRIES: Record<string, { file: string; seed: 'snake' | 'auction' | 'leagues' }> = {
  s1: { file: 'load/k6/s1-snake-drafts.k6.ts', seed: 'snake' },
  s2: { file: 'load/k6/s2-auction-storm.k6.ts', seed: 'auction' },
  s3: { file: 'load/k6/s3-sunday-viewers.k6.ts', seed: 'leagues' },
  s4: { file: 'load/k6/s4-soak.k6.ts', seed: 'leagues' },
}

function main(): number {
  const argv = process.argv.slice(2)
  const split = argv.indexOf('--')
  const own = split >= 0 ? argv.slice(0, split) : argv
  const passthrough = split >= 0 ? argv.slice(split + 1) : []
  const [scenario, ...rest] = own
  const entry = scenario ? ENTRIES[scenario] : undefined
  if (!entry) {
    console.error('usage: k6.ts s1|s2|s3|s4 --target local|test --profile smoke|y2026|ga [--minutes N] [-- k6 args]')
    return 2
  }
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name)
    return i >= 0 ? rest[i + 1] : undefined
  }
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--target', '--profile', '--minutes'].includes(rest[i]!)) {
      console.error(`unknown argument '${rest[i]}' (refused, never ignored)`)
      return 2
    }
  }
  const target = resolveTarget(flag('--target'))
  const profile = resolveProfile(flag('--profile'))
  const probe = spawnSync('k6', ['version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    console.error('k6 is not installed on this machine — install k6 v1.x, or exercise the same scenario bodies with scripts/load/run-node.ts')
    return 2
  }
  const env = {
    ...process.env,
    FS_LOAD_TARGET: target.kind,
    FS_LOAD_URL: target.url,
    FS_LOAD_ANON_KEY: target.anonKey,
    FS_LOAD_SERVICE_KEY: target.serviceKey,
    FS_LOAD_DENY: target.deny.join(','),
    FS_LOAD_REPO_ROOTS: target.linkRoots.join(','),
    FS_LOAD_PROFILE: profile.name,
    FS_LOAD_MANIFEST: manifestPath(entry.seed),
    ...(flag('--minutes') ? { FS_LOAD_MINUTES: flag('--minutes') } : {}),
  }
  const run = spawnSync('k6', ['run', ...passthrough, resolve(REPO_ROOT, entry.file)], { stdio: 'inherit', env })
  return run.status ?? 1
}

process.exit(main())
