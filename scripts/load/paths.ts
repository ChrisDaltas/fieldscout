/**
 * The load harness's fixed locations, resolved against the REPO ROOT — never
 * the caller's working directory (R1644: a seeder run from a subdirectory
 * must write the manifest the runners read).
 */
import { resolve } from 'node:path'

/** `scripts/load/` → the checkout root. */
export const REPO_ROOT = resolve(__dirname, '..', '..')

/** Seeder manifests (bot passwords + row ids) — gitignored. */
export const OUT_DIR = 'load/.out'

export function manifestPath(scenario: string): string {
  return resolve(REPO_ROOT, OUT_DIR, `${scenario}.manifest.json`)
}
