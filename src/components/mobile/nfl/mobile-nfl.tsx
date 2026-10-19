'use client'

import Link from 'next/link'

import { useGoBack } from '@/components/mobile/ui/back-nav'
import { CenterNote } from '@/components/mobile/lists/lists-parts'
import { headerColors } from '@/components/mobile/player/profile-ops'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { posLabel, posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { MobileScreen, MPageBar } from '@/components/mobile/ui/mobile-header'
import type { RosterPlayer } from '@/components/teams/team-roster'
import { NFL_DIVISIONS, teamsInDivision, type NflTeamInfo } from '@/lib/nfl-teams'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import {
  NFL_COPY,
  NFL_TEAM_PARENT,
  NFL_TEAMS_PARENT,
  adpText,
  fantasyPlayersLabel,
  rosterRowMeta,
  teamMetaLine,
  type RosterStatusTone,
} from './nfl-ops'

/**
 * NFL team pages on the phone (gap list §4 item 103) — `/app/nfl` and
 * `/app/nfl/[team]` draw FieldScout Mobile screens on the same data as
 * desktop (the static team table; the route's ADP-sorted `players` read),
 * in `m-*` tokens so the phone's dark mode follows. Desktop is unchanged.
 *
 * The handoff draws neither page, so they extend its language:
 *  - NFL teams: the G-page bar (blue back, "NFL teams"), then one section per
 *    division (13/600 t3 titles, Settings' rhythm) of team rows — a 32px
 *    team-colour crest (radius 9, the profile's Leagues rows), the name and
 *    a chevron — ruled off by b2 hairlines.
 *  - A team: the player profile's team-colour header, in one row — the
 *    see-through back button, the crest, the name as the h1 and
 *    "AFC East · Bye week 7" — then the fantasy players in ADP order, each a
 *    Players-tab row: headshot, name, position in its colour, the jersey
 *    number and the injury designation under it, and ADP on the right. A
 *    row opens the player's profile. The bye is one value for the whole team,
 *    so it sits in the header instead of on every row.
 * Back goes to where you came from, else the teams list (a team) or Home.
 */

/** Light team colours (PIT, NO) take dark text; the rest white. */
function onColor(light: boolean): string {
  return light ? 'text-ink' : 'text-white'
}

// ---------------------------------------------------------------------------
// NFL teams (/app/nfl)
// ---------------------------------------------------------------------------

export function MobileNflTeams() {
  const goBack = useGoBack()
  return (
    <MobileScreen
      header={<MPageBar title="NFL teams" onBack={() => goBack(NFL_TEAMS_PARENT)} />}
      className="leading-[normal]"
    >
      <div className="px-4 pb-8" data-nfl-teams>
        {NFL_DIVISIONS.map(({ conference, division }) => {
          const title = `${conference} ${division}`
          return (
            <section key={title} className="flex flex-col" data-nfl-division={title}>
              <h2 className="pb-1 pt-4 text-[13px] font-semibold text-m-t3">{title}</h2>
              <ul className="flex flex-col">
                {teamsInDivision(conference, division).map((team) => (
                  <li key={team.abbr} className="border-b border-m-b2 last:border-b-0">
                    <Link
                      href={`/app/nfl/${team.abbr}`}
                      className="flex min-h-[52px] items-center gap-3 py-2 active:opacity-60"
                      data-nfl-team-link={team.abbr}
                    >
                      <TeamCrest abbr={team.abbr} />
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-m-t1">
                        {team.city} {team.name}
                      </span>
                      <MIcon name="chevronRight" size={14} stroke={2} className="flex-none text-m-t3" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </MobileScreen>
  )
}

/** The team's crest: its abbreviation on its colour (data, an inline
 *  style), 32px with radius 9. */
function TeamCrest({ abbr }: { abbr: string }) {
  const colors = headerColors(abbr)
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 flex-none items-center justify-center rounded-[9px] text-[11px] font-bold',
        colors ? onColor(colors.light) : 'bg-m-ink text-white',
      )}
      style={colors ? { backgroundColor: colors.bg } : undefined}
      data-nfl-crest
    >
      {abbr}
    </span>
  )
}

// ---------------------------------------------------------------------------
// One team (/app/nfl/[team])
// ---------------------------------------------------------------------------

export function MobileNflTeam({
  team,
  roster,
  byeWeek,
}: {
  team: NflTeamInfo
  /** The route's read: this team's `players` rows, ADP order, nulls last. */
  roster: readonly RosterPlayer[]
  byeWeek: number | null
}) {
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  return (
    <MobileScreen header={<TeamBand team={team} byeWeek={byeWeek} />} className="leading-[normal] tabular-nums">
      <div className="px-4 pb-8" data-nfl-roster>
        {roster.length === 0 ? (
          <CenterNote title={NFL_COPY.emptyTitle} body={NFL_COPY.emptyBody} />
        ) : (
          <>
            <div className="flex items-end gap-3 pb-1 pt-4">
              <h2 className="min-w-0 flex-1 text-[13px] font-semibold text-m-t3">{fantasyPlayersLabel(roster.length)}</h2>
              <span aria-hidden className="w-12 flex-none text-right text-[10px] font-semibold text-m-t3">
                ADP
              </span>
            </div>
            <ul className="flex flex-col" aria-label={`${team.city} ${team.name} fantasy players`}>
              {roster.map((p) => (
                <RosterRow key={p.id} player={p} onOpen={() => openPlayer(p.id)} />
              ))}
            </ul>
          </>
        )}
      </div>
    </MobileScreen>
  )
}

/**
 * The header: the player profile's team-colour band, in one row (it stays
 * pinned while the roster scrolls under it).
 */
function TeamBand({ team, byeWeek }: { team: NflTeamInfo; byeWeek: number | null }) {
  const goBack = useGoBack()
  const colors = headerColors(team.abbr)
  const light = colors?.light ?? false
  // On the team colour: the profile's see-through fill, stronger when pressed.
  const glass = light ? 'bg-black/[.08]' : 'bg-white/[.16]'
  return (
    <div
      className={cn('flex min-h-[64px] items-center gap-2.5 px-3 py-2.5', colors ? onColor(light) : 'bg-m-ink text-white')}
      // The team colour is data (the app's NFL colour table).
      style={colors ? { background: colors.bg } : undefined}
      data-nfl-team-band={team.abbr}
    >
      <button
        type="button"
        onClick={() => goBack(NFL_TEAM_PARENT)}
        aria-label="Back"
        className={cn(
          'flex size-[30px] flex-none items-center justify-center rounded-full',
          glass,
          light ? 'active:bg-black/[.16]' : 'active:bg-white/[.28]',
        )}
        data-page-back
      >
        <MIcon name="back" size={14} stroke={2.4} />
      </button>
      <span
        aria-hidden
        className={cn('flex size-10 flex-none items-center justify-center rounded-[11px] text-[12px] font-bold', glass)}
        data-nfl-crest
      >
        {team.abbr}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 className="truncate text-[19px] font-bold leading-[1.15] tracking-[-0.02em]">
          {team.city} {team.name}
        </h1>
        <span className={cn('truncate text-[12px] font-semibold', light ? 'text-ink/[.72]' : 'text-white/80')}>
          {teamMetaLine(`${team.conference} ${team.division}`, byeWeek)}
        </span>
      </div>
    </div>
  )
}

const STATUS_TEXT: Record<RosterStatusTone, string> = {
  warn: 'font-semibold text-m-to',
  negative: 'font-semibold text-m-red',
  quiet: 'text-m-t3',
}

function RosterRow({ player, onOpen }: { player: RosterPlayer; onOpen: () => void }) {
  const meta = rosterRowMeta(player)
  return (
    <li className="border-b border-m-b2 last:border-b-0" data-nfl-player={player.id}>
      <button type="button" onClick={onOpen} className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left active:opacity-60">
        <MHeadshot player={player} size={36} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-[5px] whitespace-nowrap">
            <span className="min-w-0 truncate text-[14px] font-semibold text-m-t1">{player.full_name}</span>
            <span className={cn('flex-none text-[10px] font-semibold', posTextClass(player.position))}>
              {posLabel(player.position)}
            </span>
          </span>
          {(meta.number || meta.status) && (
            <span className="truncate text-[12px] font-medium text-m-t3" data-nfl-player-meta>
              {meta.number}
              {meta.number && meta.status && ' · '}
              {meta.status && <span className={STATUS_TEXT[meta.status.tone]}>{meta.status.label}</span>}
            </span>
          )}
        </span>
        <span className={cn('w-12 flex-none text-right text-[14px] font-semibold', player.adp != null ? 'text-m-t1' : 'text-m-t5')}>
          <span className="sr-only">ADP </span>
          {adpText(player.adp)}
        </span>
      </button>
    </li>
  )
}
