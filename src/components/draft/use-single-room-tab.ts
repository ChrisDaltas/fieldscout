'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  isRoomTabClaim,
  outcomeForClaim,
  parseStoredClaim,
  roomTabKey,
  type RoomTabClaim,
  type RoomTabRole,
} from './single-room-tab-ops'

/**
 * The two-tabs guard — spec §9.3 v2.12 / §16.2; tasks-DR D156; DR.6.
 * **RULED by Chris (2026-08-17, Q14): "The most recent one takes over and
 * the others disconnect."**
 *
 * Desktop entry opens the room in a NEW browser tab (§16.1), so a user can
 * trivially hold two tabs of one draft: two sockets, two `draft:<id>`
 * subscriptions against §9.3's ≤3-channel budget, two `draft_touch`
 * liveness loops, and a presence key tracked twice. This hook is
 * client-local leader election over that: the NEWEST tab of a given draft
 * holds the connection; older tabs release it and render the takeover
 * state, whose "Use this tab instead" button re-claims (and the then-older
 * holder releases in turn).
 *
 * **The guard is a courtesy over a correctness boundary, never a
 * substitute for one (D156).** The server is authoritative (§8.1): a stale
 * tab that somehow acts is refused by the same validators as anyone else's
 * request. Nothing that matters for correctness may ever move into this
 * hook — what it saves is sockets, subscriptions, heartbeats and a doubled
 * presence entry, nothing more.
 *
 * **Scoped per browser profile, not per user — by construction.** Both
 * buses (`BroadcastChannel`, with `localStorage` `storage` events as the
 * fallback for browsers without it) are same-origin AND same-profile
 * transports; no claim can reach another device or profile, so a manager
 * legitimately watching on a laptop and a phone is two clients and is left
 * alone (D156). The hook adds **no channel, no route, no server state** —
 * it only ever RELEASES a subscription, and the release itself is the
 * caller's: `draft-room.tsx` withholds the draft id from `useDraftRoom`
 * while released, so `use-draft.ts`'s own §9.3 effect cleanup unsubscribes
 * `draft:<id>` and its heartbeat effect's cleanup stops `draft_touch` — the
 * existing teardown paths, no second mechanism.
 *
 * Election semantics live in `single-room-tab-ops.ts` (pure, pinned);
 * this file owns only the buses and the React lifecycle. Every claim is
 * published on BOTH buses: BroadcastChannel does not echo to its sender,
 * `storage` events only fire in OTHER tabs, and receiving is idempotent —
 * double delivery is harmless by design.
 */

export interface SingleRoomTabGuard {
  /** 'holding' — this tab owns the room's connection. 'released' — a newer
   *  tab took the room; render the takeover state. */
  role: RoomTabRole
  /** "Use this tab instead": re-claims the room with a fresh (newest)
   *  claim; the current holder releases in turn. */
  reclaim: () => void
}

export function useSingleRoomTab(draftId: string | undefined): SingleRoomTabGuard {
  const [role, setRole] = useState<RoomTabRole>('holding')
  // Handler closures need the CURRENT role/claim without re-subscribing the
  // buses; refs mirror them (neither drives render on its own).
  const roleRef = useRef<RoomTabRole>('holding')
  const tabIdRef = useRef<string | null>(null)
  const seqRef = useRef(0)
  const myClaimRef = useRef<RoomTabClaim | null>(null)
  const announceRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    // No draft id ⇒ no channel, no heartbeat, nothing to guard (the
    // practice launcher and the no-draft resolver arms live here).
    if (!draftId) return

    // One id per tab INSTANCE, minted lazily on first guarded mount and
    // kept for the tab's lifetime (it is the deterministic tie-breaker for
    // two claims landing in the same millisecond).
    if (tabIdRef.current === null) tabIdRef.current = crypto.randomUUID()
    const tabId = tabIdRef.current
    const key = roomTabKey(draftId)
    const bus = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(key) : null

    const setRoleBoth = (next: RoomTabRole) => {
      roleRef.current = next
      setRole(next)
    }

    const publish = (claim: RoomTabClaim) => {
      bus?.postMessage(claim)
      try {
        window.localStorage.setItem(key, JSON.stringify(claim))
      } catch {
        // Storage can be unavailable (quota, private mode); BroadcastChannel
        // still carries the claim wherever it exists. Best-effort, like the
        // guard itself.
      }
    }

    const claim = () => {
      seqRef.current += 1
      const mine: RoomTabClaim = { tab_id: tabId, claimed_at: Date.now(), seq: seqRef.current }
      myClaimRef.current = mine
      setRoleBoth('holding')
      publish(mine)
    }

    const receive = (incoming: RoomTabClaim) => {
      const mine = myClaimRef.current
      if (!mine) return
      const outcome = outcomeForClaim(mine, roleRef.current, incoming)
      if (outcome.role !== roleRef.current) setRoleBoth(outcome.role)
      if (outcome.defend) {
        // Defend re-announces the SAME claim (claimed_at untouched — a
        // defender must never out-new a genuinely newer claim in flight);
        // only seq moves, so the storage write is a changed string and the
        // fallback bus actually fires.
        seqRef.current += 1
        const defended: RoomTabClaim = { ...mine, seq: seqRef.current }
        myClaimRef.current = defended
        publish(defended)
      }
    }

    const onMessage = (event: MessageEvent) => {
      if (isRoomTabClaim(event.data)) receive(event.data)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return
      const incoming = parseStoredClaim(event.newValue)
      if (incoming) receive(incoming)
    }

    bus?.addEventListener('message', onMessage)
    window.addEventListener('storage', onStorage)
    announceRef.current = claim
    // Mount IS the claim — the newest tab takes the room (the Q14 ruling);
    // every older tab receives this and releases.
    claim()

    return () => {
      announceRef.current = null
      bus?.removeEventListener('message', onMessage)
      window.removeEventListener('storage', onStorage)
      bus?.close()
      // Hygiene only: a leaving HOLDER clears its own stored claim so the
      // per-draft key does not outlive the tab. Never someone else's — a
      // released tab's stored state belongs to the current holder. No
      // handoff is broadcast: the ruling promotes nobody on close; an
      // older tab re-claims by its button.
      try {
        const stored = parseStoredClaim(window.localStorage.getItem(key))
        if (stored?.tab_id === tabId) window.localStorage.removeItem(key)
      } catch {
        // Same best-effort posture as publish.
      }
    }
  }, [draftId])

  const reclaim = useCallback(() => {
    announceRef.current?.()
  }, [])

  return { role, reclaim }
}
