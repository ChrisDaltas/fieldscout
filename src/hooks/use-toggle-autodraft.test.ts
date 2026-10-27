/**
 * use-toggle-autodraft.test.ts — the manager's own Auto-pick switch must not
 * bounce (review of feat/auto-draft-me-switch). The switch shows the value it
 * sent while the toggle is pending and the league detail's
 * `league_members.is_autodraft` after. If the mutation stopped being pending
 * BEFORE the detail re-read landed, the switch fell back to the OLD cached
 * value for the length of that refetch (measured locally: on → off → on in
 * ~250ms; on the hosted app, as long as the refetch takes).
 *
 * Pins, driving the hook's REAL options through a real `QueryClient` +
 * `MutationObserver` (the use-commish-log-receipt-hooks.test.ts rig —
 * `useQueryClient` answers the test's client, `useMutation` hands back its
 * options): a landed toggle stays pending until the re-read has written the
 * fresh detail into the cache; a refused toggle does not wait for it.
 */
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

let currentClient: QueryClient | null = null
let captured: unknown[] = []
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...orig,
    useQueryClient: () => currentClient,
    useMutation: (options: unknown) => {
      captured.push(options)
      return options
    },
  }
})

import { useToggleAutodraft } from './use-draft'
import { leaguesKeys } from './use-leagues'

const LEAGUE = 'c3310000-0000-4000-8000-000000000901'

type Detail = { is_autodraft: boolean }

const mount = { useMount: () => useToggleAutodraft(LEAGUE) }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function stubFetch(ok: boolean) {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok,
      status: ok ? 200 : 409,
      headers: new Headers(),
      json: () =>
        Promise.resolve(
          ok ? { team_id: 't1', is_autodraft: true, changed: true } : { error: 'The draft is over.' },
        ),
    } as unknown as Response),
  )
}

const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  vi.unstubAllGlobals()
  currentClient = null
  captured = []
})

/** A client whose league detail is on screen (an active observer) and whose
 *  re-read answers only when the test says so. */
function rig() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData<Detail>(leaguesKeys.detail(LEAGUE), { is_autodraft: false })
  const reread = deferred<Detail>()
  let rereads = 0
  const detail = new QueryObserver<Detail>(client, {
    queryKey: leaguesKeys.detail(LEAGUE),
    queryFn: () => {
      rereads += 1
      return reread.promise
    },
    staleTime: Infinity,
  })
  const unsubscribe = detail.subscribe(() => undefined)
  currentClient = client
  // A member call, as in the receipt rig — the hook only builds its options.
  mount.useMount()
  const options = captured[captured.length - 1]
  expect(options, 'the hook built its mutation').toBeTruthy()
  const toggle = new MutationObserver<unknown, Error, boolean>(client, options as never)
  const unsubscribeToggle = toggle.subscribe(() => undefined)
  return {
    client,
    toggle,
    reread,
    rereads: () => rereads,
    cleanup: () => {
      unsubscribe()
      unsubscribeToggle()
    },
  }
}

describe('useToggleAutodraft — the switch never snaps back between the answer and the re-read', () => {
  it('a landed toggle stays pending (showing the sent value) until the fresh detail is in the cache', async () => {
    stubFetch(true)
    const r = rig()
    const done = r.toggle.mutate(true)

    // The server answered and the re-read has started, but not landed.
    await vi.waitFor(() => expect(r.rereads()).toBe(1))
    await flush()
    expect(r.toggle.getCurrentResult().isPending).toBe(true)
    expect(r.toggle.getCurrentResult().variables).toBe(true)
    // The cache still holds the OLD value — exactly what the switch would
    // have shown had the mutation stopped being pending here.
    expect(r.client.getQueryData<Detail>(leaguesKeys.detail(LEAGUE))?.is_autodraft).toBe(false)

    r.reread.resolve({ is_autodraft: true })
    await done
    expect(r.toggle.getCurrentResult().isSuccess).toBe(true)
    // The moment it stops being pending, the server's value is already there.
    expect(r.client.getQueryData<Detail>(leaguesKeys.detail(LEAGUE))?.is_autodraft).toBe(true)
    r.cleanup()
  })

  it('a refused toggle does not wait for the re-read — the switch falls back with its toast at once', async () => {
    stubFetch(false)
    const r = rig()
    await r.toggle.mutate(true).catch(() => undefined)

    expect(r.toggle.getCurrentResult().isError).toBe(true)
    // It still re-reads (a resync), but the refusal did not sit behind it.
    expect(r.rereads()).toBe(1)
    expect(r.client.getQueryState(leaguesKeys.detail(LEAGUE))?.fetchStatus).toBe('fetching')

    r.reread.resolve({ is_autodraft: false })
    await flush()
    r.cleanup()
  })
})
