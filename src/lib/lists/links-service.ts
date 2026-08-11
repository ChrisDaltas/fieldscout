/**
 * Attached-links service — Lists v2, migration `080_list_links.sql`. The server
 * side of the **Attached links** section on the Details tab
 * (`docs/design/lists/screens/detail-tab-details.png`).
 *
 * **The ruling that authorises it** — Chris, 2026-08-11: *"lets create the
 * table for storing the link, we need a way to link back to resources used and
 * a way for creators to attached videos to their lists."* Two purposes —
 * **attribution** (what the list drew on) and a **creator video** — both of
 * them the author speaking about their own list. That is why reads follow the
 * list's visibility and writes are owner-only.
 *
 * Layering follows the LV.1.2 precedent (`drafted-service.ts`): a thin Route
 * Handler over an INJECTED Supabase client, with everything decidable here, so
 * the stack suite can drive the production composition over real PostgREST
 * with real signed-in users. 080's RLS is the ENFORCEMENT backstop; this
 * layer's job is friendly, SPECIFIC 4xxs.
 *
 * ## Nothing is fetched. Nothing is scraped.
 *
 * `title`, `source_label` and `duration_label` are typed by the person
 * attaching the link. There is a standing rule against reintroducing a
 * scraping service (CLAUDE.md — ingestion is plain fetch of RSS/YouTube feeds
 * only), and this file makes no network call of any kind. Auto-filling a
 * YouTube title/duration from its URL is a follow-up to PROPOSE, not to build.
 *
 * ## Every "nothing happened" answer carries its reason
 *
 * CLAUDE.md's hardest-won rule — an empty result must never be
 * indistinguishable from an error:
 *   - list unreadable / soft-deleted / nonexistent  → 404, never `{links: []}`
 *   - readable but not yours                        → 403, never a silent no-op
 *   - a read that errored                           → 500, never `{links: []}`
 *   - a DELETE that removed 0 rows                  → the row is PROBED before
 *     answering: gone already is 404, present-but-not-yours is 403. Never a
 *     cheerful `removed: true`.
 *   - a reorder whose UPDATE touched 0 rows         → 500 naming the link, plus
 *     the TRUE resulting order, never a silent success
 *
 * ## The URL is the security-shaped part
 *
 * It is user input that renders as an `href` on a PUBLIC, server-rendered page
 * (`/u/[username]/lists/[slug]`, SEO-critical per plan D7), so a `javascript:`
 * or `data:` href there is stored XSS with a click. Two independent layers:
 *
 *   1. **`normalizeLinkUrl` here** — parse with the WHATWG `new URL()`, assert
 *      `protocol` is `http:`/`https:`, store `parsed.href`.
 *   2. **080's `list_links_url_scheme_check`** — `^https?://[^[:space:]]+$` at
 *      the DATABASE, so every future route, RPC or seed script inherits it.
 *      (`duplicate_list` is this codebase's standing proof that a path which
 *      never sees Zod will eventually exist.)
 *
 * **Why parse-then-check rather than a regex on the raw string.** Browsers
 * strip TAB and newline out of a scheme, so `java<TAB>script:alert(1)` is a
 * live `javascript:` URL. `new URL()` performs exactly that normalisation —
 * measured: `new URL("java\tscript:alert(1)").protocol === "javascript:"` — so
 * the protocol check sees the URL as the BROWSER will, not as the bytes look.
 * Storing `.href` is then what makes the two layers agree: it is
 * percent-encoded, whitespace-free and scheme-normalised, so it always
 * satisfies the CHECK.
 *
 * **The bare-domain convenience is safe, and its safety is structural.**
 * `youtube.com/watch?v=x` is re-tried as `https://youtube.com/watch?v=x`, but
 * ONLY when the raw string failed to parse as a URL at all — and the retry's
 * result goes through the same protocol check. Anything carrying a scheme
 * (`javascript:`, `data:`, `vbscript:`) parses on the first attempt and is
 * rejected there, so it never reaches the prefix path. Pinned both ways.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

type Supabase = SupabaseClient<Database>

export interface ServiceResult {
  status: number
  body: Json
}

/** A link as the Details tab renders it. */
export interface ListLink {
  id: string
  list_id: string
  kind: 'video' | 'article'
  url: string
  title: string
  source_label: string | null
  duration_label: string | null
  position: number
}

/**
 * How many links one list may carry. The design renders a short stack of
 * cards, and this page is public — an unbounded list is a spam surface. Held
 * here rather than in a DB trigger: it is a product limit, not an invariant
 * anything else depends on, and a trigger would be a heavier thing to relax.
 */
export const MAX_LINKS_PER_LIST = 10

/** 080's `list_links_url_length_check` upper bound, mirrored. */
export const MAX_URL_LENGTH = 2048

/** Friendly copy — these strings are UX and are pinned by the suites. */
export const LIST_NOT_FOUND_MESSAGE = 'List not found'
export const NOT_OWNER_MESSAGE = 'Only the list owner can attach links.'
export const LINK_NOT_FOUND_MESSAGE = 'That link is not attached to this list.'
export const DUPLICATE_LINK_MESSAGE = 'That link is already attached to this list.'
export const TOO_MANY_LINKS_MESSAGE = `A list can carry at most ${MAX_LINKS_PER_LIST} attached links.`
export const URL_SCHEME_MESSAGE =
  'Links must start with http:// or https://.'
export const URL_INVALID_MESSAGE = 'That does not look like a web address.'
export const URL_TOO_LONG_MESSAGE = `A link must be under ${MAX_URL_LENGTH} characters.`
export const REORDER_SET_MISMATCH_MESSAGE =
  'The new order must list every attached link exactly once.'

const idSchema = z.uuid()

/**
 * The ORDER, in one place. `position` is what the owner arranged; `created_at`
 * then `id` make it TOTAL, so two rows that somehow share a position still
 * render in a stable, deterministic order rather than whatever the planner
 * felt like. Every reader — this service and `/api/lists/[id]`'s embed — sorts
 * through this function so there is exactly one answer.
 */
export function applyLinkOrder<T extends { position: number; created_at: string; id: string }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      a.position - b.position ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  )
}

const LINK_COLUMNS = 'id, list_id, kind, url, title, source_label, duration_label, position, created_at'

interface LinkRow {
  id: string
  list_id: string
  kind: string
  url: string
  title: string
  source_label: string | null
  duration_label: string | null
  position: number
  created_at: string
}

function toLink(row: LinkRow): ListLink {
  return {
    id: row.id,
    list_id: row.list_id,
    kind: row.kind === 'video' ? 'video' : 'article',
    url: row.url,
    title: row.title,
    source_label: row.source_label,
    duration_label: row.duration_label,
    position: row.position,
  }
}

/**
 * Read this list's links, in order, under the caller's own RLS.
 *
 * Exported raw (throwing on error rather than returning a ServiceResult) so
 * `/api/lists/[id]`'s GET can embed links in `ListWithDetails` without a second
 * round-trip, while still routing through the one ordering rule above. A
 * throw is deliberate: that route already turns a failed sub-query into a 500,
 * and an empty array on error is exactly the false-empty CLAUDE.md forbids.
 */
export async function fetchListLinks(supabase: Supabase, listId: string): Promise<ListLink[]> {
  const { data, error } = await supabase
    .from('list_links')
    .select(LINK_COLUMNS)
    .eq('list_id', listId)

  if (error) throw new Error(error.message)
  return applyLinkOrder((data ?? []) as LinkRow[]).map(toLink)
}

/**
 * Normalise and validate a user-supplied URL. See the file header for why this
 * parses rather than pattern-matches.
 *
 * Returns the string to STORE — `URL.href`, which is percent-encoded,
 * whitespace-free and scheme-normalised — so what the database checks is what
 * the browser will resolve.
 */
export function normalizeLinkUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; reason: string } {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, reason: URL_INVALID_MESSAGE }
  // Bound BEFORE parsing so a megabyte of input is never handed to the parser.
  if (trimmed.length > MAX_URL_LENGTH) return { ok: false, reason: URL_TOO_LONG_MESSAGE }

  let parsed: URL | null = null
  try {
    parsed = new URL(trimmed)
  } catch {
    // Only a string that is not a URL AT ALL reaches here — anything carrying a
    // scheme, `javascript:` included, parsed above and is judged on its
    // protocol below. So the bare-domain convenience cannot launder a
    // dangerous scheme; it can only complete an absent one.
    try {
      parsed = new URL(`https://${trimmed}`)
    } catch {
      return { ok: false, reason: URL_INVALID_MESSAGE }
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: URL_SCHEME_MESSAGE }
  }
  // Percent-encoding can grow the string past the DB's ceiling.
  if (parsed.href.length > MAX_URL_LENGTH) {
    return { ok: false, reason: URL_TOO_LONG_MESSAGE }
  }
  return { ok: true, url: parsed.href }
}

/**
 * Wire contract for attaching a link. Bounds mirror 080's CHECK constraints so
 * a rejection is a friendly 400 here rather than a raw `23514` surfaced as a
 * 500 — the exact failure mode PROGRESS §3 Q2 documents for the tier route.
 *
 * `duration_label` is a CLOCK duration (`18:42`, `1:02:33`) and not free text,
 * because the screenshot renders it as a bare figure beside the source; an
 * unbounded string there would be a second caption on a public page.
 */
export const addLinkInputSchema = z.object({
  kind: z.enum(['video', 'article']),
  url: z.string().min(1).max(MAX_URL_LENGTH),
  title: z.string().trim().min(1).max(200),
  source_label: z.string().trim().min(1).max(80).nullish(),
  duration_label: z
    .string()
    .trim()
    .regex(/^[0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?$/, 'Use a clock duration, like 18:42.')
    .nullish(),
})

export const reorderLinksInputSchema = z.object({
  link_ids: z.array(z.uuid()).min(1).max(MAX_LINKS_PER_LIST),
})

function notFound(): ServiceResult {
  return { status: 404, body: { error: LIST_NOT_FOUND_MESSAGE } }
}

/**
 * Can the caller WRITE this list's links? Owner-only, per the ruling.
 *
 * The 404/403 split is the house form (`/api/lists/[id]` PATCH): the SELECT
 * runs under `lists`'s own RLS, so a miss means "private, trashed, or
 * imaginary" — one answer for all three, leaking nothing — while a hit the
 * caller does not own is a specific 403 rather than a silent no-op.
 */
async function assertOwner(
  supabase: Supabase,
  listId: string,
  userId: string,
): Promise<ServiceResult | null> {
  const { data, error } = await supabase
    .from('lists')
    .select('id, owner_id')
    .eq('id', listId)
    .is('deleted_at', null)
    .maybeSingle()

  // A failed probe is NOT a missing list. Say so loudly rather than 404ing.
  if (error) return { status: 500, body: { error: error.message } }
  if (!data) return notFound()
  if (data.owner_id !== userId) {
    return { status: 403, body: { error: NOT_OWNER_MESSAGE } }
  }
  return null
}

/** Read — used by the routes' GET and by every mutation's response. */
async function currentLinks(
  supabase: Supabase,
  listId: string,
): Promise<{ links: ListLink[] } | ServiceResult> {
  try {
    return { links: await fetchListLinks(supabase, listId) }
  } catch (err) {
    return { status: 500, body: { error: (err as Error).message } }
  }
}

function isServiceResult(value: { links: ListLink[] } | ServiceResult): value is ServiceResult {
  return 'status' in value
}

function linksBody(listId: string, links: ListLink[]): Json {
  return { list_id: listId, links: links as unknown as Json }
}

/**
 * GET — this list's links, in order.
 *
 * Reads follow the LIST's visibility (080's SELECT policy defers to `lists`'s
 * own RLS), so the readability probe here is the same one the drafted service
 * uses: a list you cannot see is a 404, never an empty array.
 */
export async function listLinks(supabase: Supabase, listId: string): Promise<ServiceResult> {
  if (!idSchema.safeParse(listId).success) return notFound()

  const { data, error } = await supabase
    .from('lists')
    .select('id')
    .eq('id', listId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) return { status: 500, body: { error: error.message } }
  if (!data) return notFound()

  const result = await currentLinks(supabase, listId)
  if (isServiceResult(result)) return result
  return { status: 200, body: linksBody(listId, result.links) }
}

/** POST — attach a link. Owner-only. */
export async function addLink(
  supabase: Supabase,
  listId: string,
  userId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  if (!idSchema.safeParse(listId).success) return notFound()

  const parsed = addLinkInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }

  const normalized = normalizeLinkUrl(parsed.data.url)
  if (!normalized.ok) {
    return { status: 400, body: { error: normalized.reason } }
  }

  const ownerProblem = await assertOwner(supabase, listId, userId)
  if (ownerProblem) return ownerProblem

  const existing = await currentLinks(supabase, listId)
  if (isServiceResult(existing)) return existing

  if (existing.links.length >= MAX_LINKS_PER_LIST) {
    return { status: 409, body: { error: TOO_MANY_LINKS_MESSAGE } }
  }

  // Append. `position` is 0-based and contiguous; taking max+1 rather than
  // `length` keeps it correct even if a row was removed out from under us.
  const nextPosition = existing.links.reduce((max, link) => Math.max(max, link.position + 1), 0)

  const { data, error } = await supabase
    .from('list_links')
    .insert({
      list_id: listId,
      kind: parsed.data.kind,
      url: normalized.url,
      title: parsed.data.title,
      source_label: parsed.data.source_label ?? null,
      duration_label: parsed.data.duration_label ?? null,
      position: nextPosition,
    })
    .select(LINK_COLUMNS)
    .single()

  if (error) {
    // Already attached — the unique (list_id, url). A specific answer, not a
    // second identical card and not a 500.
    if (error.code === '23505') {
      return { status: 409, body: { error: DUPLICATE_LINK_MESSAGE } }
    }
    // RLS refused (not the owner, or the list was trashed mid-request). 080's
    // WITH CHECK is the gate; this is its friendly face.
    if (error.code === '42501') {
      return { status: 403, body: { error: NOT_OWNER_MESSAGE } }
    }
    // A CHECK rejected it — 080's url/title/duration guards. Reachable only if
    // this file's validation and the migration's constraints ever drift apart,
    // which is exactly when a raw 500 would be least useful.
    if (error.code === '23514') {
      return { status: 400, body: { error: URL_INVALID_MESSAGE } }
    }
    return { status: 500, body: { error: error.message } }
  }

  const after = await currentLinks(supabase, listId)
  if (isServiceResult(after)) return after

  return {
    status: 201,
    body: {
      list_id: listId,
      link: toLink(data as LinkRow) as unknown as Json,
      links: after.links as unknown as Json,
    },
  }
}

/**
 * DELETE — detach one link. Owner-only.
 *
 * A 0-row delete is PROBED before it is answered. The owner check above
 * already separates "not your list" from "no such list", so what remains is
 * "was this link ever on this list?" — and a delete that quietly removed
 * nothing is precisely the shape CLAUDE.md forbids.
 */
export async function removeLink(
  supabase: Supabase,
  listId: string,
  linkId: string,
  userId: string,
): Promise<ServiceResult> {
  if (!idSchema.safeParse(listId).success) return notFound()
  if (!idSchema.safeParse(linkId).success) {
    return { status: 404, body: { error: LINK_NOT_FOUND_MESSAGE } }
  }

  const ownerProblem = await assertOwner(supabase, listId, userId)
  if (ownerProblem) return ownerProblem

  const { data, error } = await supabase
    .from('list_links')
    .delete()
    .eq('id', linkId)
    .eq('list_id', listId)
    .select('id')

  if (error) return { status: 500, body: { error: error.message } }

  const removed = (data ?? []).length
  if (removed === 0) {
    // The caller owns the list, so RLS did not filter this — the row is simply
    // not here. Reported as a specific 404 rather than a cheerful no-op, so a
    // stale UI learns that its card is gone.
    return { status: 404, body: { error: LINK_NOT_FOUND_MESSAGE } }
  }

  const after = await currentLinks(supabase, listId)
  if (isServiceResult(after)) return after

  return {
    status: 200,
    body: { list_id: listId, link_id: linkId, removed: true, links: after.links as unknown as Json },
  }
}

/**
 * PATCH — reorder. Owner-only. Body is the COMPLETE new order by id.
 *
 * **The set must match exactly** — same ids, no extras, no omissions, no
 * duplicates. A "reorder" that silently dropped a link, or that quietly
 * ignored one added on another device a second ago, is the same false-success
 * class as a 0-row update; refusing with a specific 409 and returning the TRUE
 * current order lets the client resynchronise instead of guessing.
 *
 * **Not atomic, and deliberately so.** PostgREST cannot express one UPDATE
 * with a per-row CASE, and the alternative — a SECURITY DEFINER RPC — is a far
 * larger surface (in-body auth, `search_path=''`, REVOKE) than reordering at
 * most ten rows warrants. The exposure is bounded rather than waved away: on a
 * partial failure the response is a 500 that NAMES the link it stopped at and
 * carries the real resulting order, and because the read path sorts by
 * `(position, created_at, id)` — total — a half-applied reorder is a different
 * order, never a lost link or an unstable render.
 */
export async function reorderLinks(
  supabase: Supabase,
  listId: string,
  userId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  if (!idSchema.safeParse(listId).success) return notFound()

  const parsed = reorderLinksInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { link_ids } = parsed.data

  const ownerProblem = await assertOwner(supabase, listId, userId)
  if (ownerProblem) return ownerProblem

  const existing = await currentLinks(supabase, listId)
  if (isServiceResult(existing)) return existing

  const stored = new Set(existing.links.map((link) => link.id))
  const requested = new Set(link_ids)
  const sameSet =
    requested.size === link_ids.length &&
    stored.size === requested.size &&
    [...stored].every((id) => requested.has(id))

  if (!sameSet) {
    return {
      status: 409,
      body: {
        error: REORDER_SET_MISMATCH_MESSAGE,
        list_id: listId,
        links: existing.links as unknown as Json,
      },
    }
  }

  const updatedAt = new Date().toISOString()
  for (const [index, linkId] of link_ids.entries()) {
    const { data, error } = await supabase
      .from('list_links')
      .update({ position: index, updated_at: updatedAt })
      .eq('id', linkId)
      .eq('list_id', listId)
      .select('id')

    if (error) return { status: 500, body: { error: error.message } }

    // 0 rows here is not "already in place" — the WHERE names a row this
    // request just read. Either it vanished or RLS filtered the UPDATE, and
    // neither is a success.
    if ((data ?? []).length === 0) {
      const after = await currentLinks(supabase, listId)
      return {
        status: 500,
        body: {
          error: `Reorder stopped at link ${linkId}: it could not be moved. The order below is what is actually stored.`,
          list_id: listId,
          links: isServiceResult(after) ? [] : (after.links as unknown as Json),
        },
      }
    }
  }

  const after = await currentLinks(supabase, listId)
  if (isServiceResult(after)) return after

  return { status: 200, body: linksBody(listId, after.links) }
}
