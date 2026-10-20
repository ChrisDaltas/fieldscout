'use client'

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { systemTime } from '@/lib/leagues/time/time-provider'

import { pickClockView, type PickClockInput } from './pick-clock-ops'
import { RoomAnnouncerMachine, type AnnouncerInput } from './room-announcer-ops'

export type { AnnouncedPick } from './room-announcer-ops'

interface RoomAnnouncerProps extends AnnouncerInput {
  /** The drafts-row clock fields (server-authoritative — PickClock's). */
  clock: PickClockInput
  offsetMs: number
}

/**
 * The room's announcer (spec §16.3 "live-region announcements for
 * picks/clock"; M7 L.F1.1, PROGRESS F55, D620). Two polite, visually hidden
 * live regions: one says what just happened and whose turn it is now ("Pick
 * 1.02: CPU 7 takes Jahmyr Gibbs, RB. On the clock: CPU 6."), the other
 * carries only the viewer's own clock warnings (30s / 10s), so a warning
 * never overwrites a pick.
 *
 * Every decision — what is news, what waits, what is never repeated — lives
 * in `RoomAnnouncerMachine` (`room-announcer-ops.ts`), where fake timers can
 * drive it (R1635). This component only feeds it and renders what it says.
 * The interval only samples the clock for the pure `pickClockView` math (the
 * PickClock pattern — the server's deadline is the only authority), reading
 * time through `systemTime`.
 */
export function RoomAnnouncer({ clock, offsetMs, ...input }: RoomAnnouncerProps) {
  const [turnText, setTurnText] = useState('')
  const [clockText, setClockText] = useState('')
  const machineRef = useRef<RoomAnnouncerMachine | null>(null)
  if (machineRef.current === null) {
    machineRef.current = new RoomAnnouncerMachine(
      {
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
      (sentence) => say(setTurnText, sentence),
      (sentence) => say(setClockText, sentence),
    )
  }

  useEffect(() => () => machineRef.current?.dispose(), [])

  const {
    latestPick,
    latestPickReady,
    youAreOnClock,
    onClockKey,
    onClockTeamName,
    isAuction,
    nominationLive,
  } = input
  useEffect(() => {
    machineRef.current?.update({
      latestPick,
      latestPickReady,
      youAreOnClock,
      onClockKey,
      onClockTeamName,
      isAuction,
      nominationLive,
    })
  }, [latestPick, latestPickReady, youAreOnClock, onClockKey, onClockTeamName, isAuction, nominationLive])

  const { status, current_deadline, deadline_remaining_ms } = clock
  useEffect(() => {
    if (!youAreOnClock) {
      machineRef.current?.sampleClock(null)
      return
    }
    const view = { status, current_deadline, deadline_remaining_ms }
    const sample = () => {
      const v = pickClockView(view, systemTime.now().getTime(), offsetMs)
      machineRef.current?.sampleClock(v.mode === 'running' ? v.remainingMs : null)
    }
    sample()
    const id = setInterval(sample, 500)
    return () => clearInterval(id)
  }, [youAreOnClock, offsetMs, status, current_deadline, deadline_remaining_ms])

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
  setter((previous) => (previous === sentence ? `${sentence} ` : sentence))
}
