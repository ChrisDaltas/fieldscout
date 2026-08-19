'use client'

import { useEffect, useState } from 'react'

import {
  ROOM_ENTRY_COARSE_QUERY,
  ROOM_ENTRY_DESKTOP_QUERY,
  roomEntryTargetProps,
  type RoomEntryTargetProps,
} from './use-room-entry-target-ops'

/**
 * Anchor props for a link INTO the draft room (spec §16.1 v2.12's platform
 * split; tasks-DR DR.6 item 1): `{target: '_blank', rel: 'noopener'}` on a
 * measured desktop (wide viewport + fine pointer), `{}` — plain same-tab —
 * everywhere else, including SSR and first paint (upgrade on mount; never
 * user-agent sniffing). Spread onto the entry `<Link>` so the decision
 * lives on a REAL anchor: middle-click, keyboard activation and no-JS all
 * keep working, and the room's URL stays the plain §16.1 route.
 *
 * Consumers are the in-app entry points into the room — the league home's
 * draft CTAs and the `DraftBar`'s Join — enumerated and pinned in
 * `src/components/draft/room-entry.test.ts`. Navigation WITHIN the room
 * world (the practice launcher's own pushes) stays in place and does not
 * use this hook.
 */
export function useRoomEntryTarget(): RoomEntryTargetProps {
  // null = not yet measured (SSR/hydration) — the same-tab default.
  const [desktopFinePointer, setDesktopFinePointer] = useState<boolean | null>(null)

  useEffect(() => {
    const wide = window.matchMedia(ROOM_ENTRY_DESKTOP_QUERY)
    const coarse = window.matchMedia(ROOM_ENTRY_COARSE_QUERY)
    const update = () => setDesktopFinePointer(wide.matches && !coarse.matches)
    update()
    wide.addEventListener('change', update)
    coarse.addEventListener('change', update)
    return () => {
      wide.removeEventListener('change', update)
      coarse.removeEventListener('change', update)
    }
  }, [])

  return roomEntryTargetProps(desktopFinePointer)
}
