import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ROOM_ENTRY_COARSE_QUERY,
  ROOM_ENTRY_DESKTOP_QUERY,
  roomEntryTargetProps,
} from './use-room-entry-target-ops'

/**
 * The entry-split pins (spec §16.1 v2.12; tasks-DR DR.6 item 1): desktop
 * opens the room in a new tab, mobile in place, SSR defaults to same-tab
 * and upgrades on mount, and the decision is media-query state — never the
 * user agent.
 */
describe('roomEntryTargetProps — the platform split as a total function', () => {
  it('SSR / pre-mount (null) is the SAME-TAB default — the upgrade-on-mount rule', () => {
    expect(roomEntryTargetProps(null)).toEqual({})
  })

  it('mobile / coarse pointer (false) enters in place', () => {
    expect(roomEntryTargetProps(false)).toEqual({})
  })

  it('a measured desktop opens a new tab, and the new-tab arm carries noopener', () => {
    expect(roomEntryTargetProps(true)).toEqual({ target: '_blank', rel: 'noopener' })
  })

  it('pins the two media queries: lg width AND a non-coarse pointer', () => {
    // 1024 is `lg` — the room's own single breakpoint (tasks-DR §1); a
    // touch tablet at desktop width still enters in place.
    expect(ROOM_ENTRY_DESKTOP_QUERY).toBe('(min-width: 1024px)')
    expect(ROOM_ENTRY_COARSE_QUERY).toBe('(pointer: coarse)')
  })
})

describe('never user-agent sniffing (the banner rule, pinned at the source)', () => {
  it('neither half of the hook reads the user agent or platform strings', () => {
    for (const rel of [
      'src/hooks/use-room-entry-target.ts',
      'src/hooks/use-room-entry-target-ops.ts',
    ]) {
      const source = readFileSync(path.resolve(process.cwd(), rel), 'utf8')
      expect(source, rel).not.toMatch(/userAgent|navigator\.platform|vendor/)
    }
  })
})
