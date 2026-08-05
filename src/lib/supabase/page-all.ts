/**
 * Drain a paginated Supabase query past PostgREST's per-response row cap.
 *
 * PostgREST caps every response at `max_rows` (1000 here — supabase/config.toml,
 * and the hosted project matches). The cap is per *response*: a `.limit(1500)`
 * silently returns 1000, and so does a query with no limit at all. Offset paging
 * via `.range()` does get past it, which is what this helper does.
 *
 * The builder MUST apply a stable .order(...) ending in a UNIQUE column (`id`).
 * PostgREST pages are unspecified without one, and a non-unique final sort key
 * lets rows duplicate or vanish across a page boundary.
 *
 * Pass `{ count: 'exact' }` in .select() when completeness matters. Without a
 * count this helper stops when a page comes back short, which cannot tell
 * "pool exhausted" from "server capped below our page size" — exactly the
 * silent truncation this exists to prevent.
 */
/**
 * What pageAll needs back from a page request. Callers whose .select() uses a
 * runtime-built column string must cast to this — supabase-js can only infer
 * row types from a literal select, so a dynamic one widens to an error type.
 */
export type PageResponse<T> = PromiseLike<{
  data: T[] | null
  error: { message: string } | null
  count?: number | null
}>

export async function pageAll<T>(
  build: (from: number, to: number) => PageResponse<T>,
): Promise<T[]> {
  const pageSize = 1000
  let offset = 0
  let total: number | null = null
  const out: T[] = []

  while (true) {
    const { data, error, count } = await build(offset, offset + pageSize - 1)
    if (error) throw new Error(error.message)
    if (count !== null && count !== undefined) total = count
    if (!data || data.length === 0) break

    out.push(...data)

    if (total !== null) {
      // Authoritative finish line. Advance by what the server actually gave
      // us, so a cap below pageSize still converges instead of truncating.
      if (out.length >= total) break
      offset += data.length
      continue
    }

    if (data.length < pageSize) break
    offset += pageSize
  }

  return out
}
