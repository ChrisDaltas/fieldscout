/**
 * links-api-db.test.ts — migration 080's `list_links` and the attach / detach /
 * reorder surface at the WIRE layer: driven against the LOCAL Supabase stack
 * through PostgREST, with real signed-in users, through the SERVICE that
 * actually ships (`links-service.ts`).
 *
 * Division of labour: **pgTAP 029** owns the exhaustive DB-side matrix (shape,
 * golden-pinned constraints, the policy set, grants, per-role deny-by-default,
 * the league-shared read, the cascade). This suite proves the two things pgTAP
 * cannot — the production service composition (friendly, SPECIFIC 4xxs; the
 * 404-vs-403 split on a 0-row delete; the reorder set check) and that the
 * policies hold over real JWTs on the wire rather than over `set_config`
 * inside one transaction.
 *
 * The three claims the task names explicitly, each proven in BOTH directions
 * so no pin can pass against an empty table:
 *   1. a viewer of a PUBLIC list CAN read its links — and the same viewer gets
 *      nothing from a private one, with the row shown to exist privileged;
 *   2. a stranger CANNOT read a PRIVATE list's links;
 *   3. a NON-OWNER cannot write — not attach, not detach, not reorder — on a
 *      list they can read perfectly well.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips.
 *
 * Determinism: FIXED emails/usernames/slugs/urls + cleanup-first. No
 * wall-clock, no randomness. Usernames are prefixed `lnkw_` — distinct from
 * every other stack suite's fixture namespace (and from pgTAP 029's `lnk_`).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  addLink,
  DUPLICATE_LINK_MESSAGE,
  LINK_NOT_FOUND_MESSAGE,
  LIST_NOT_FOUND_MESSAGE,
  listLinks,
  MAX_LINKS_PER_LIST,
  NOT_OWNER_MESSAGE,
  REORDER_SET_MISMATCH_MESSAGE,
  removeLink,
  reorderLinks,
  TOO_MANY_LINKS_MESSAGE,
  URL_SCHEME_MESSAGE,
  type ListLink,
} from './links-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const USER_A = {
  email: 'links-a@fieldscout.test',
  password: 'pgtap-links-pass-1',
  username: 'lnkw_wire_alpha',
}
const USER_B = {
  email: 'links-b@fieldscout.test',
  password: 'pgtap-links-pass-2',
  username: 'lnkw_wire_bravo',
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
/** Signed-OUT client — the server-rendered share view's reader (plan D7). */
const anonClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
  auth: { persistSession: false },
})

let clientA: SupabaseClient<Database>
let clientB: SupabaseClient<Database>
let userA: string
let userB: string
let publicListId: string // owned by A, PUBLIC
let privateListId: string // owned by A, PRIVATE — invisible to B

const ABSENT_LIST_ID = '99999999-0000-4000-8000-00000000beef'
const ABSENT_LINK_ID = '99999999-0000-4000-8000-00000000cafe'

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  for (const u of [USER_A, USER_B]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: {
  email: string
  password: string
  username: string
}): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: {
  email: string
  password: string
}): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** Privileged read — the "the row really is there" control behind every
 *  0-result assertion below. Bypasses RLS deliberately. */
async function privilegedLinkCount(listId: string): Promise<number> {
  const { count, error } = await service
    .from('list_links')
    .select('*', { count: 'exact', head: true })
    .eq('list_id', listId)
  if (error) throw new Error(`privileged count failed: ${error.message}`)
  return count ?? 0
}

function links(body: unknown): ListLink[] {
  return (body as { links: ListLink[] }).links
}

function errorOf(body: unknown): string {
  return (body as { error: string }).error
}

async function createList(
  client: SupabaseClient<Database>,
  ownerId: string,
  title: string,
  slug: string,
  isPrivate: boolean,
): Promise<string> {
  const { data, error } = await client
    .from('lists')
    .insert({ owner_id: ownerId, title, slug, is_private: isPrivate })
    .select('id')
    .single()
  if (error) throw new Error(`list insert failed (${slug}): ${error.message}`)
  return data.id
}

beforeAll(async () => {
  await cleanup()
  userA = await createUser(USER_A)
  userB = await createUser(USER_B)
  // The pre-leagues free-account cap trigger (one private list) fires for
  // every role; A holds a Big Board plus two fixture lists.
  await service.from('profiles').update({ is_pro: true }).eq('id', userA)
  clientA = await signIn(USER_A)
  clientB = await signIn(USER_B)

  publicListId = await createList(clientA, userA, 'lnkw public board', 'lnkw-pub', false)
  privateListId = await createList(clientA, userA, 'lnkw private board', 'lnkw-priv', true)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('attaching — the ruling’s two purposes', () => {
  it('starts empty, and an empty read is a 200 naming the list, never a bare []', async () => {
    const result = await listLinks(clientA, publicListId)
    expect(result.status).toBe(200)
    expect(links(result.body)).toEqual([])
    expect((result.body as { list_id: string }).list_id).toBe(publicListId)
  })

  it('a list that cannot be read is a 404, NOT an empty list of links', async () => {
    // The distinction CLAUDE.md exists for: "no links" and "no such list" are
    // different facts and must not render as the same empty state.
    const absent = await listLinks(clientA, ABSENT_LIST_ID)
    expect(absent.status).toBe(404)
    expect(errorOf(absent.body)).toBe(LIST_NOT_FOUND_MESSAGE)
  })

  it('attaches a creator video exactly as the reference card renders it', async () => {
    const result = await addLink(clientA, publicListId, userA, {
      kind: 'video',
      url: 'https://youtube.com/watch?v=lnkw-walkthrough',
      title: 'Round 1 walkthrough — every pick, ranked',
      source_label: 'Field Scout on YouTube',
      duration_label: '18:42',
    })
    expect(result.status).toBe(201)
    expect(links(result.body)).toHaveLength(1)
    expect(links(result.body)[0]).toMatchObject({
      kind: 'video',
      title: 'Round 1 walkthrough — every pick, ranked',
      source_label: 'Field Scout on YouTube',
      duration_label: '18:42',
      position: 0,
    })
  })

  it('attaches an attribution article with no source and no duration', async () => {
    const result = await addLink(clientA, publicListId, userA, {
      kind: 'article',
      url: 'https://example.com/lnkw-why-tiers',
      title: 'Why tiers beat ranks',
    })
    expect(result.status).toBe(201)
    const stored = links(result.body)
    expect(stored).toHaveLength(2)
    // Appended, not prepended — the design renders an ordered list.
    expect(stored[1]).toMatchObject({ position: 1, source_label: null, duration_label: null })
  })

  it('normalises the stored url, so what the DB checks is what the browser resolves', async () => {
    const result = await addLink(clientA, privateListId, userA, {
      kind: 'article',
      url: '  example.com/lnkw-bare  ',
      title: 'Bare domain, trimmed and schemed',
    })
    expect(result.status).toBe(201)
    expect(links(result.body)[0].url).toBe('https://example.com/lnkw-bare')
  })

  it('refuses the same url twice with a SPECIFIC 409, not a silent second card', async () => {
    const dupe = await addLink(clientA, publicListId, userA, {
      kind: 'video',
      url: 'https://youtube.com/watch?v=lnkw-walkthrough',
      title: 'the same video again',
    })
    expect(dupe.status).toBe(409)
    expect(errorOf(dupe.body)).toBe(DUPLICATE_LINK_MESSAGE)
    expect(await privilegedLinkCount(publicListId)).toBe(2)
  })
})

describe('the URL guard, on the wire', () => {
  /**
   * The unit suite pins `normalizeLinkUrl` in isolation and the pgTAP suite
   * pins the CHECK. These pin the whole path: a dangerous scheme sent at the
   * service boundary is a friendly 400 AND leaves nothing stored.
   */
  it.each([
    ['javascript:', 'javascript:alert(document.cookie)'],
    ['tab-smuggled javascript:', 'java\tscript:alert(1)'],
    ['data:', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
  ])('refuses %s with a 400 and stores nothing', async (_label, url) => {
    const before = await privilegedLinkCount(publicListId)

    const result = await addLink(clientA, publicListId, userA, {
      kind: 'video',
      url,
      title: 'stored xss attempt',
    })

    expect(result.status).toBe(400)
    expect(errorOf(result.body)).toBe(URL_SCHEME_MESSAGE)
    // The load-bearing half: refused AND not written. A 400 that still stored
    // the row would pass a status-only assertion.
    expect(await privilegedLinkCount(publicListId)).toBe(before)
  })

  it('stores only http/https, checked against the DB’s own view of the rows', async () => {
    const { data, error } = await service
      .from('list_links')
      .select('url')
      .in('list_id', [publicListId, privateListId])
    expect(error).toBeNull()
    expect(data?.length).toBeGreaterThan(0)
    for (const row of data ?? []) {
      expect(row.url, `${row.url} must be http/https`).toMatch(/^https?:\/\//)
    }
  })
})

describe('reads follow the list’s own visibility', () => {
  it('a viewer of a PUBLIC list can read its links', async () => {
    const result = await listLinks(clientB, publicListId)
    expect(result.status).toBe(200)
    expect(links(result.body)).toHaveLength(2)
  })

  it('a SIGNED-OUT reader can too — the share view renders anonymously (D7)', async () => {
    const result = await listLinks(anonClient, publicListId)
    expect(result.status).toBe(200)
    expect(links(result.body)).toHaveLength(2)
  })

  it('a stranger CANNOT read a PRIVATE list’s links — and the row provably exists', async () => {
    // Positive control first: the link really is stored, so the 404 below is
    // isolation and not an empty table.
    expect(await privilegedLinkCount(privateListId)).toBe(1)

    const asStranger = await listLinks(clientB, privateListId)
    expect(asStranger.status).toBe(404)
    expect(errorOf(asStranger.body)).toBe(LIST_NOT_FOUND_MESSAGE)

    const asAnon = await listLinks(anonClient, privateListId)
    expect(asAnon.status).toBe(404)

    // The other direction: the owner sees it on the same query.
    const asOwner = await listLinks(clientA, privateListId)
    expect(asOwner.status).toBe(200)
    expect(links(asOwner.body)).toHaveLength(1)
  })
})

describe('writes are owner-only — readable is not writable', () => {
  it('a non-owner cannot ATTACH to a list they can read perfectly well', async () => {
    const before = await privilegedLinkCount(publicListId)

    const result = await addLink(clientB, publicListId, userB, {
      kind: 'video',
      url: 'https://example.com/lnkw-b-attaches',
      title: 'B staples a video onto A’s list',
    })

    expect(result.status).toBe(403)
    expect(errorOf(result.body)).toBe(NOT_OWNER_MESSAGE)
    expect(await privilegedLinkCount(publicListId)).toBe(before)
  })

  it('a non-owner cannot DETACH — and A’s links are shown surviving', async () => {
    const beforeList = await listLinks(clientA, publicListId)
    const victim = links(beforeList.body)[0]

    const result = await removeLink(clientB, publicListId, victim.id, userB)
    expect(result.status).toBe(403)
    expect(errorOf(result.body)).toBe(NOT_OWNER_MESSAGE)

    const after = await listLinks(clientA, publicListId)
    expect(links(after.body).map((l) => l.id)).toContain(victim.id)
  })

  it('a non-owner cannot REORDER', async () => {
    const owned = links((await listLinks(clientA, publicListId)).body)
    const result = await reorderLinks(clientB, publicListId, userB, {
      link_ids: [...owned].reverse().map((l) => l.id),
    })
    expect(result.status).toBe(403)
    expect(errorOf(result.body)).toBe(NOT_OWNER_MESSAGE)

    // Order untouched.
    const after = links((await listLinks(clientA, publicListId)).body)
    expect(after.map((l) => l.id)).toEqual(owned.map((l) => l.id))
  })

  it('a stranger writing to a PRIVATE list gets 404, not 403 — no existence leak', async () => {
    const result = await addLink(clientB, privateListId, userB, {
      kind: 'article',
      url: 'https://example.com/lnkw-probe',
      title: 'probing a private list',
    })
    // Private, trashed and imaginary must be indistinguishable to a stranger.
    expect(result.status).toBe(404)
    expect(errorOf(result.body)).toBe(LIST_NOT_FOUND_MESSAGE)
  })
})

describe('detaching — a delete that removed nothing says WHY', () => {
  it('removes a link the owner attached, and reports the resulting order', async () => {
    const before = links((await listLinks(clientA, publicListId)).body)
    const victim = before[0]

    const result = await removeLink(clientA, publicListId, victim.id, userA)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ removed: true, link_id: victim.id })
    expect(links(result.body).map((l) => l.id)).not.toContain(victim.id)
    expect(await privilegedLinkCount(publicListId)).toBe(before.length - 1)
  })

  it('removing it AGAIN is a specific 404, never a cheerful removed:true', async () => {
    // The exact CLAUDE.md shape: 0 rows affected must not report success. A
    // stale card in an open tab learns that it is gone.
    const result = await removeLink(clientA, publicListId, ABSENT_LINK_ID, userA)
    expect(result.status).toBe(404)
    expect(errorOf(result.body)).toBe(LINK_NOT_FOUND_MESSAGE)
  })

  it('a malformed link id is a 404 about the LINK, not a 500', async () => {
    const result = await removeLink(clientA, publicListId, 'not-a-uuid', userA)
    expect(result.status).toBe(404)
    expect(errorOf(result.body)).toBe(LINK_NOT_FOUND_MESSAGE)
  })
})

describe('reordering', () => {
  let reorderListId: string

  beforeAll(async () => {
    reorderListId = await createList(clientA, userA, 'lnkw reorder board', 'lnkw-reorder', false)
    for (const n of [1, 2, 3]) {
      const added = await addLink(clientA, reorderListId, userA, {
        kind: 'article',
        url: `https://example.com/lnkw-order-${n}`,
        title: `Order fixture ${n}`,
      })
      expect(added.status).toBe(201)
    }
  }, 30_000)

  it('applies a full new order and reports it back', async () => {
    const before = links((await listLinks(clientA, reorderListId)).body)
    expect(before.map((l) => l.title)).toEqual([
      'Order fixture 1',
      'Order fixture 2',
      'Order fixture 3',
    ])

    const reversed = [...before].reverse().map((l) => l.id)
    const result = await reorderLinks(clientA, reorderListId, userA, { link_ids: reversed })
    expect(result.status).toBe(200)
    expect(links(result.body).map((l) => l.id)).toEqual(reversed)
    expect(links(result.body).map((l) => l.position)).toEqual([0, 1, 2])

    // And it PERSISTED — read back on a fresh query, not just echoed.
    const reread = links((await listLinks(clientA, reorderListId)).body)
    expect(reread.map((l) => l.id)).toEqual(reversed)
  })

  it('refuses a partial order rather than silently dropping a link', async () => {
    const current = links((await listLinks(clientA, reorderListId)).body)

    const result = await reorderLinks(clientA, reorderListId, userA, {
      link_ids: [current[0].id, current[1].id], // one short
    })
    expect(result.status).toBe(409)
    expect(errorOf(result.body)).toBe(REORDER_SET_MISMATCH_MESSAGE)
    // The refusal carries the TRUE order so the client can resynchronise.
    expect(links(result.body).map((l) => l.id)).toEqual(current.map((l) => l.id))
  })

  it('refuses a duplicated id and an unknown id', async () => {
    const current = links((await listLinks(clientA, reorderListId)).body)

    const duped = await reorderLinks(clientA, reorderListId, userA, {
      link_ids: [current[0].id, current[0].id, current[1].id],
    })
    expect(duped.status).toBe(409)

    const foreign = await reorderLinks(clientA, reorderListId, userA, {
      link_ids: [current[0].id, current[1].id, ABSENT_LINK_ID],
    })
    expect(foreign.status).toBe(409)

    // Neither attempt moved anything.
    const after = links((await listLinks(clientA, reorderListId)).body)
    expect(after.map((l) => l.id)).toEqual(current.map((l) => l.id))
  })
})

describe('the per-list cap', () => {
  it(`refuses the ${MAX_LINKS_PER_LIST + 1}th link with a specific 409`, async () => {
    const capListId = await createList(clientA, userA, 'lnkw cap board', 'lnkw-cap', false)

    for (let n = 0; n < MAX_LINKS_PER_LIST; n += 1) {
      const added = await addLink(clientA, capListId, userA, {
        kind: 'article',
        url: `https://example.com/lnkw-cap-${n}`,
        title: `Cap fixture ${n}`,
      })
      expect(added.status, `link ${n} should be accepted`).toBe(201)
    }

    const overflow = await addLink(clientA, capListId, userA, {
      kind: 'article',
      url: 'https://example.com/lnkw-cap-overflow',
      title: 'One too many',
    })
    expect(overflow.status).toBe(409)
    expect(errorOf(overflow.body)).toBe(TOO_MANY_LINKS_MESSAGE)
    expect(await privilegedLinkCount(capListId)).toBe(MAX_LINKS_PER_LIST)
  }, 60_000)
})
