'use client'

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { systemTime } from '@/lib/leagues/time/time-provider'

import { pickClockView, type PickClockInput } from './pick-clock-ops'
import {
  clockWarningAnnouncement,
  crossedClockWarning,
  composeTurnAnnouncement,
  onClockAnnouncement,
  pickAnnouncement,
  type PickAnnouncementInput,
} from './room-announcer-ops'

export interface AnnouncedPick extends PickAnnouncementInput {
  /** Identity of the made pick — `${pick_number}:${player_id}` — so an undo
   *  followed by a different player at the same number is still news. */
  key: string
}

interface RoomAnnouncerProps {
  /** The newest live pick, or null before the first. `playerName` must be
   *  the resolved name: the announcer WAITS for identity rather than saying
   *  a player id out loud and then saying the pick a second time. */
  latestPick: AnnouncedPick | null
  /** False while the newest pick's player identity is still loading. */
  latestPickReady: boolean
  youAreOnClock: boolean
  /** Identity of the TURN — `${current_pick_number}:${on_clock_team_id}` —
   *  so the snake wrap (the same team twice running) is still a new turn. */
  onClockKey: string | null
  onClockTeamName: string | null
  isAuction: boolean
  /** The drafts-row clock fields (server-authoritative — PickClock's). */
  clock: PickClockInput
  offsetMs: number
}

/**
 * How long the announcer waits to gather a pick and the turn it hands over.
 * The picks broadcast and the drafts-row update arrive as separate renders
 * (measured live in L.F1.1: the turn landed BEFORE the pick that caused it,
 * so two regions read "On the clock: CPU 6" and then "CPU 7 takes Gibbs").
 * Gathering them for a beat lets ONE sentence say them in the order they
 * happened. Presentation only — it decides nothing.
 */
export const ANNOUNCE_GATHER_MS = 600

/**
 * The room's announcer (spec §16.3 "live-region announcements for
 * picks/clock"; M7 L.F1.1, PROGRESS F55, D620). Two polite, visually hidden
 * live regions: one says what just happened and whose turn it is now ("Pick
 * 1.02: CPU 7 takes Jahmyr Gibbs, RB. On the clock: CPU 6."), the other
 * carries only the viewer's own clock warnings (30s / 10s), so a warning
 * never overwrites a pick.
 *
 * Nothing is announced at mount: the room on load is a state, not news. The
 * interval here only samples the clock for the pure `pickClockView` math
 * (the PickClock pattern — the server's deadline is the only authority), and
 * reads time through `systemTime`.
 */
export function RoomAnnouncer({
  latestPick,
  latestPickReady,
  youAreOnClock,
  onClockKey,
  onClockTeamName,
  isAuction,
  clock,
  offsetMs,
}: RoomAnnouncerProps) {
  const [turnText, setTurnText] = useState('')
  const [clockText, setClockText] = useState('')
  const { status, current_deadline, deadline_remaining_ms } = clock

  // The gather buffer: what happened, and whose turn it is now.
  const pendingRef = useRef<{ pick: string | null; turn: string | null }>({ pick: null, turn: null })
  const gatherTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gather = (part: 'pick' | 'turn', sentence: string) => {
    pendingRef.current[part] = sentence
    if (gatherTimerRef.current !== null) return
    gatherTimerRef.current = setTimeout(() => {
      gatherTimerRef.current = null
      const { pick, turn } = pendingRef.current
      pendingRef.current = { pick: null, turn: null }
      const sentence = composeTurnAnnouncement(pick, turn)
      if (sentence) say(setTurnText, sentence)
    }, ANNOUNCE_GATHER_MS)
  }
  useEffect(
    () => () => {
      if (gatherTimerRef.current !== null) clearTimeout(gatherTimerRef.current)
    },
    [],
  )

  // ---- picks -------------------------------------------------------------
  // `undefined` = not yet initialised (the mount render records the current
  // newest pick without announcing it).
  const lastPickKeyRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const key = latestPick?.key ?? null
    if (lastPickKeyRef.current === undefined) {
      lastPickKeyRef.current = key
      return
    }
    if (key === lastPickKeyRef.current) return
    if (latestPick === null) {
      // An undo of the only pick — the commissioner's system post in chat
      // tells the room; there is no newest pick to name.
      lastPickKeyRef.current = null
      return
    }
    if (!latestPickReady) return // wait for the name; the effect re-runs
    lastPickKeyRef.current = key
    gather('pick', pickAnnouncement(latestPick))
    // `gather` only writes refs and a timer — it is stable in effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestPick, latestPickReady])

  // ---- whose turn ----------------------------------------------------------
  const lastOnClockRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (lastOnClockRef.current === undefined) {
      lastOnClockRef.current = onClockKey
      return
    }
    if (onClockKey === lastOnClockRef.current) return
    lastOnClockRef.current = onClockKey
    const sentence = onClockAnnouncement({ youAreOnClock, onClockTeamName, isAuction })
    if (sentence) gather('turn', sentence)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClockKey, onClockTeamName, youAreOnClock, isAuction])

  // ---- the viewer's own clock ------------------------------------------------
  const previousRemainingRef = useRef<number | null>(null)
  useEffect(() => {
    previousRemainingRef.current = null
    if (!youAreOnClock) return
    const input = { status, current_deadline, deadline_remaining_ms }
    const sample = () => {
      const view = pickClockView(input, systemTime.now().getTime(), offsetMs)
      const remaining = view.mode === 'running' ? view.remainingMs : null
      const crossed = crossedClockWarning(previousRemainingRef.current, remaining)
      previousRemainingRef.current = remaining
      if (crossed !== null) say(setClockText, clockWarningAnnouncement(crossed, isAuction))
    }
    sample()
    const id = setInterval(sample, 500)
    return () => clearInterval(id)
    // `onClockKey`: a new turn is a new clock even if the deadline repeats.
  }, [youAreOnClock, isAuction, offsetMs, status, current_deadline, deadline_remaining_ms, onClockKey])

  return (
    <>
      <p className="sr-only" role="status" data-testid="room-announcer-turn">
        {turnText}
      </p>
      <p className="sr-only" role="status" data-testid="room-announcer-clock">
        {clockText}
      </p>
    </>
  )
}

/**
 * A live region only speaks when its text CHANGES, so the same sentence
 * twice running (two turns in a row at the snake wrap) would be silent the
 * second time. A trailing no-break space makes it a change without changing
 * what is read.
 */
function say(setter: Dispatch<SetStateAction<string>>, sentence: string) {
  setter((previous) => freshen(previous, sentence))
}

function freshen(previous: string, next: string): string {
  return previous === next ? `${next}\u00A0` : next
}
