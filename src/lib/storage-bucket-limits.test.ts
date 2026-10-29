/**
 * The four public buckets' limits (migration 210, F715) equal what their four
 * upload routes accept, so nothing a route lets through is refused by the
 * bucket, and nothing the bucket accepts is broader than the route.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const MIGRATION = readFileSync(path.join(ROOT, 'supabase/migrations/210_security_hardening_followups.sql'), 'utf8')

const ROUTES: Array<[bucket: string, file: string]> = [
  ['user-avatars', 'src/app/api/profile/avatar/route.ts'],
  ['list-thumbnails', 'src/app/api/lists/[id]/thumbnail/route.ts'],
  ['folder-thumbnails', 'src/app/api/folders/[id]/thumbnail/route.ts'],
  ['league-avatars', 'src/app/api/leagues/[id]/profile/route.ts'],
]

const bucketUpdate = MIGRATION.match(
  /SET file_size_limit = (\d+),\s+allowed_mime_types = ARRAY\[([^\]]*)\]\s+WHERE id IN \(([^)]*)\);/,
)

describe('210 bucket limits vs the upload routes', () => {
  it('210 sets one size and one type list on exactly the four buckets', () => {
    expect(bucketUpdate).not.toBeNull()
    const ids = bucketUpdate![3]!.split(',').map((s) => s.trim().replace(/'/g, '')).sort()
    expect(ids).toEqual(ROUTES.map(([b]) => b).sort())
  })

  it.each(ROUTES)('%s: the route uploads to it with the same size cap and the same types', (bucket, file) => {
    const src = readFileSync(path.join(ROOT, file), 'utf8')
    expect(src).toContain(`const BUCKET = '${bucket}'`)
    expect(src).toMatch(/const MAX_BYTES = 5 \* 1024 \* 1024/)
    expect(Number(bucketUpdate![1])).toBe(5 * 1024 * 1024)
    const routeTypes = [...(src.match(/const ALLOWED_MIME = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
    const bucketTypes = [...bucketUpdate![2]!.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(routeTypes.length).toBeGreaterThan(0)
    expect(bucketTypes).toEqual(routeTypes)
    // The route sends the file's own type, which the bucket then checks.
    expect(src).toMatch(/contentType: file\.type/)
  })
})
