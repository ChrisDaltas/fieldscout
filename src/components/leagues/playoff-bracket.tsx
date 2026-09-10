'use client'

import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { StandingsRow } from '@/lib/leagues/api/standings-service'
import type { BracketGame, BracketRound, PlayoffBracket as PlayoffBracketDoc, ProjectedPair } from '@/lib/leagues/api/playoffs-service'
import { cn } from '@/lib/utils'

import { Crest, TeamNameLink } from './league-cells'
import { CHAMPION_UNRECORDED_COPY } from './league-home-season-ops'
import {
  AWAITING_BUILD_COPY,
  BUILT_TITLE,
  COMMISH_DOOR_PENDING_COPY,
  PROJECTED_TITLE,
  SEEDED_BEFORE_CORRECTION_COPY,
  SEEDED_BEFORE_CORRECTION_TITLE,
  TBD_LABEL,
  bracketShape,
  commishDoors,
  correctionsCloseDisplay,
  foreignRowsCopy,
  foreignRowsOf,
  formatBracketScore,
  formatTotal,
  gamePlayed,
  pointsRaceCopy,
  projectionBasisCopy,
  rolloverDisplay,
  roundBadge,
  roundLabel,
  seededBeforeCorrection,
  sourceLabel,
  tbdSlots,
  teamName,
  verdictCopy,
  type CommishDoor,
} from './playoff-bracket-ops'

/**
 * PlayoffBracket (§16.2 `playoff-bracket`: "seeds, byes, reseed; commish
 * edit affordances (seeds/results) routed through commish-action-modal;
 * all season the PROJECTED bracket ('if the playoffs started today') with
 * the ONE instant the real one materialises rendered in the viewer's
 * timezone — never 'midnight' as copy" — v2.16.25, Q39 (E); §11.5; M4 task
 * L.D5.5; PROGRESS D318, D326).
 *
 * ONE component over 118's document, in 118's words. Hosted as the
 * "Playoffs" tab of the standings page (`standings-page.tsx`) and embedded
 * in the league home's `playoffs` hero (`league-home-season.tsx`) — the
 * same mount, `compact` trims the chrome. The document decides the shape
 * (`bracketShape`): the season-long PROJECTION (round 1 from the projected
 * standings, the basis named, later rounds TBD — F256(c)); the STORED
 * rounds once built (seeds frozen on the rows, each week's row, the
 * two-week totals, `decided_by` — Q39 (A)/(B) — and `final`); the no-
 * bracket kinds (Q39 (C)/(D): the standings ARE the playoff) with the
 * stored champion; the rolled-but-unwritten season, said honestly.
 *
 * **The client computes nothing** (CLAUDE.md; §23.3 / F226): no seed, no
 * total, no tiebreak, no instant — `home_total` is 118's sum and
 * `winner_team_id` 118's verdict; the rollover is a stored `timestamptz`
 * formatted for the viewer with the league zone on hover (§16.4). The one
 * derivation is R846's label (a round whose frozen seeds differ from the
 * FINAL standings), which compares two stored documents.
 *
 * States (§16.5.4) are the HOST'S: this component renders a document.
 * Elevation: cards rest flat under the 1px ink border; the winner and the
 * viewer's own franchise are FILLS (`bg-accent-soft`), never shadows.
 */
export function PlayoffBracket({
  doc,
  teamNames,
  leagueTimeZone,
  myRole,
  myTeamId,
  finalStandings,
  compact = false,
}: {
  doc: PlayoffBracketDoc
  /** `teams.id → name` from the league detail (F256(g): the payload carries ids). */
  teamNames: ReadonlyMap<string, string>
  /** `settings.draft.time_zone` — the league's reference zone for hover (§16.4). */
  leagueTimeZone: string | null
  myRole: string | null
  myTeamId: string | null
  /** The FINAL standings (117's document), for R846's label; null = not loaded. */
  finalStandings: readonly Pick<StandingsRow, 'rank' | 'team_id'>[] | null
  /** The hero's trim: no commissioner doors, no correction-close line. */
  compact?: boolean
}) {
  const shape = bracketShape(doc)
  const rollover = rolloverDisplay(doc, leagueTimeZone)
  const close = correctionsCloseDisplay(doc, leagueTimeZone)
  const doors = compact ? [] : commishDoors(myRole)
  const foreign = foreignRowsCopy(foreignRowsOf(doc))

  if (doc.kind !== 'bracket') {
    return (
      <section className="flex flex-col gap-3" data-playoff-bracket={shape} data-compact={compact ? '' : undefined}>
        <p role="status" className="rounded-sm border border-ink bg-white px-3 py-2 text-[12px] font-semibold text-n-3">
          {pointsRaceCopy(doc.kind)}
        </p>
        <ChampionLine doc={doc} teamNames={teamNames} />
        {doc.status === 'in_season' && (
          <RolloverLine label="Regular season ends" display={rollover} />
        )}
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3" data-playoff-bracket={shape} data-compact={compact ? '' : undefined}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-extrabold text-ink">{shape === 'projected' ? PROJECTED_TITLE : BUILT_TITLE}</h3>
        {shape === 'projected' && (
          <Badge variant="stroke-purple" data-bracket-badge="projected">
            Projected
          </Badge>
        )}
        <span className="text-[11px] font-medium text-n-3">
          <span className="fs-num">{doc.playoff_teams}</span> teams · <span className="fs-num">{doc.bracket_size}</span>-team bracket ·{' '}
          <span className="fs-num">{doc.rounds}</span> round{doc.rounds === 1 ? '' : 's'}
          {doc.weeks_per_round === 2 ? ' · two weeks per round' : ''} · {doc.reseed ? 'reseeded each round' : 'fixed bracket'}
        </span>
      </header>

      {shape === 'projected' && (
        <p className="text-[11px] font-medium text-n-3" data-projection-basis>
          {projectionBasisCopy(doc.projection_basis, doc.playoff_teams)}
        </p>
      )}
      {shape === 'awaiting_build' && (
        <p role="status" className="rounded-sm border border-ink bg-white px-3 py-2 text-[12px] font-semibold text-n-3" data-awaiting-build>
          {AWAITING_BUILD_COPY}
        </p>
      )}
      {foreign && (
        <p role="status" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink" data-foreign-rows>
          {foreign}
        </p>
      )}

      {(shape === 'projected' || shape === 'awaiting_build') && (
        <RolloverLine label={shape === 'projected' ? 'The real bracket is built' : 'The regular season rolled over'} display={rollover} />
      )}
      {/* R911 (#272): `corrections_close_at` is the LAST REGULAR-SEASON week's close — the
          instant the SEEDS become final. Once `regular_season_final` it is a past instant, and
          each round carries its own week's close in its badge; showing it here presented a
          stale "pending" close under a final bracket. */}
      {!compact && shape === 'bracket' && close && !doc.regular_season_final && doc.status !== 'complete' && (
        <RolloverLine label="Seeds final when corrections close" display={close} marker="corrections-close" />
      )}

      <ChampionLine doc={doc} teamNames={teamNames} />

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:overflow-x-auto md:pb-1" data-rounds>
        {shape === 'projected'
          ? projectedRounds(doc).map((round) => (
              <RoundColumn key={round.round} label={roundLabel(round.round, doc.rounds)} badge={null} note={null} correction={false}>
                {round.pairs
                  ? round.pairs.map((pair, i) => (
                      <ProjectedGame key={i} leagueId={doc.league_id} pair={pair} teamNames={teamNames} myTeamId={myTeamId} />
                    ))
                  : Array.from({ length: round.slots }, (_, i) => <TbdGame key={i} />)}
              </RoundColumn>
            ))
          : doc.round_list.map((round) => {
              const badge = roundBadge(round)
              return (
                <RoundColumn
                  key={round.round}
                  label={roundLabel(round.round, doc.rounds)}
                  badge={badge}
                  note={sourceLabel(round)}
                  correction={seededBeforeCorrection(doc, round, finalStandings)}
                  round={round.round}
                >
                  {round.built
                    ? round.games.map((game, i) => (
                        <BuiltGame key={i} leagueId={doc.league_id} game={game} teamNames={teamNames} myTeamId={myTeamId} />
                      ))
                    : Array.from({ length: tbdSlots(round) }, (_, i) => <TbdGame key={i} />)}
                </RoundColumn>
              )
            })}
      </div>

      {doors.length > 0 && <CommishDoors doors={doors} />}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** The projected surface: round 1 from `projected_round_1` (or a TBD row
 *  of `bracket_size / 2` when the basis cannot seed it), every later round
 *  `bracket_size / 2^r` TBD slots — F256(c). */
function projectedRounds(doc: Extract<PlayoffBracketDoc, { kind: 'bracket' }>): Array<{ round: number; pairs: ProjectedPair[] | null; slots: number }> {
  return Array.from({ length: doc.rounds }, (_, i) => {
    const round = i + 1
    const slots = doc.bracket_size / 2 ** round
    return { round, pairs: round === 1 ? doc.projected_round_1 : null, slots }
  })
}

function RoundColumn({
  label,
  badge,
  note,
  correction,
  round,
  children,
}: {
  label: string
  badge: ReturnType<typeof roundBadge>
  note: string | null
  correction: boolean
  round?: number
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 md:min-w-[220px]" data-round={round ?? label}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink">{label}</span>
        {badge && (
          <Badge variant={badge.variant} title={badge.title} data-round-badge={badge.state} className="text-[10px]">
            {badge.label}
          </Badge>
        )}
      </div>
      {note && <p className="text-[10px] font-medium text-n-3">{note}</p>}
      {correction && (
        <p className="text-[10px] font-semibold text-ink" title={SEEDED_BEFORE_CORRECTION_TITLE} data-seeded-before-correction>
          {SEEDED_BEFORE_CORRECTION_COPY}
        </p>
      )}
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function TeamLine({
  seed,
  name,
  leagueId,
  teamId,
  mine,
  winner,
  cells,
  total,
}: {
  seed: number | null
  name: string
  leagueId: string
  /** The slot's franchise, or null for a TBD slot the projection cannot
   *  name yet — a slot with no team gets no door. */
  teamId: string | null
  mine: boolean
  winner: boolean
  cells?: string[]
  total?: string
}) {
  return (
    <div className={cn('flex items-center gap-2 px-2.5 py-1.5', winner && 'bg-accent-soft')} data-team-line data-winner={winner ? '' : undefined}>
      <span className="fs-num w-4 shrink-0 text-right text-[11px] font-bold text-n-3">{seed ?? '—'}</span>
      <Crest name={name} src={null} className="h-5 w-5" />
      <TeamNameLink
        name={name}
        leagueId={leagueId}
        teamId={teamId}
        className={cn('min-w-0 flex-1 truncate text-[12px]', winner ? 'font-extrabold text-ink' : 'font-semibold text-ink')}
      />
      {mine && (
        <Badge variant="stroke" className="text-[9px]">
          You
        </Badge>
      )}
      {total !== undefined && (
        <span className="flex shrink-0 flex-col items-end">
          <span className="fs-num text-[12px] font-bold text-ink">{total}</span>
          {cells && cells.length > 1 && (
            <span className="fs-num text-[9px] text-n-3" data-week-cells>
              {cells.join(' + ')}
            </span>
          )}
        </span>
      )}
    </div>
  )
}

function ProjectedGame({ leagueId, pair, teamNames, myTeamId }: { leagueId: string; pair: ProjectedPair; teamNames: ReadonlyMap<string, string>; myTeamId: string | null }) {
  return (
    <div className="divide-y divide-n-4 rounded-sm border border-ink bg-white" data-game="projected">
      <TeamLine seed={pair.home.seed} name={teamName(teamNames, pair.home.team_id)} leagueId={leagueId} teamId={pair.home.team_id} mine={pair.home.team_id === myTeamId} winner={false} />
      {pair.away ? (
        <TeamLine seed={pair.away.seed} name={teamName(teamNames, pair.away.team_id)} leagueId={leagueId} teamId={pair.away.team_id} mine={pair.away.team_id === myTeamId} winner={false} />
      ) : (
        <p className="px-2.5 py-1.5 text-[11px] font-medium text-n-3" data-bye>
          Bye
        </p>
      )}
    </div>
  )
}

function BuiltGame({ leagueId, game, teamNames, myTeamId }: { leagueId: string; game: BracketGame; teamNames: ReadonlyMap<string, string>; myTeamId: string | null }) {
  const verdict = verdictCopy(game)
  const played = gamePlayed(game)
  const homeCells = game.weeks.map((w) => formatBracketScore(w.home_score, w.status))
  const awayCells = game.weeks.map((w) => formatBracketScore(w.away_score, w.status))
  const bye = game.away_team_id === null
  const total = (t: number, cells: string[]) => (played ? (game.weeks.length > 1 ? formatTotal(t) : cells[0]) : '—')
  return (
    <div className="rounded-sm border border-ink bg-white" data-game={game.decided_by} data-final={game.final ? '' : undefined} data-played={played ? '' : undefined}>
      <div className="divide-y divide-n-4">
        <TeamLine
          seed={game.home_seed}
          name={teamName(teamNames, game.home_team_id)}
          leagueId={leagueId}
          teamId={game.home_team_id}
          mine={game.home_team_id === myTeamId}
          winner={!bye && played && game.winner_team_id === game.home_team_id}
          cells={bye ? undefined : homeCells}
          total={bye ? undefined : total(game.home_total, homeCells)}
        />
        {bye ? (
          <p className="px-2.5 py-1.5 text-[11px] font-medium text-n-3" data-bye>
            Bye
          </p>
        ) : (
          <TeamLine
            seed={game.away_seed}
            name={teamName(teamNames, game.away_team_id)}
            leagueId={leagueId}
            teamId={game.away_team_id}
            mine={game.away_team_id === myTeamId}
            winner={played && game.winner_team_id === game.away_team_id}
            cells={awayCells}
            total={total(game.away_total, awayCells)}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-n-4 px-2.5 py-1">
        {played || bye ? (
          <Badge variant={game.final ? 'stroke-green' : 'stroke'} title={verdict.title} className="text-[9px]" data-verdict={game.decided_by}>
            {verdict.label}
          </Badge>
        ) : (
          <span className="text-[10px] font-medium text-n-3" data-not-played>
            Not played yet
          </span>
        )}
        {game.weeks.some((w) => w.is_overridden) && (
          <Badge variant="stroke" className="text-[9px]">
            ✸ commissioner-adjusted
          </Badge>
        )}
        {game.weeks.length > 1 && (
          <span className="text-[10px] font-medium text-n-3">
            Weeks <span className="fs-num">{game.weeks.map((w) => w.week).join(' + ')}</span>
          </span>
        )}
      </div>
    </div>
  )
}

function TbdGame() {
  return (
    <div className="divide-y divide-n-4 rounded-sm border border-dashed border-n-3 bg-white" data-game="tbd">
      <p className="px-2.5 py-1.5 text-[12px] font-semibold text-n-3">{TBD_LABEL}</p>
      <p className="px-2.5 py-1.5 text-[12px] font-semibold text-n-3">{TBD_LABEL}</p>
    </div>
  )
}

function RolloverLine({ label, display, marker }: { label: string; display: ReturnType<typeof rolloverDisplay>; marker?: string }) {
  return (
    <p className="text-[11px] font-medium text-n-3" data-rollover={display.kind} data-rollover-line={marker ?? 'rollover'}>
      {label} ·{' '}
      <span className="fs-num text-ink" title={display.title ?? undefined}>
        {display.text}
      </span>
      {display.kind === 'instant' && <span> (your time{display.title ? '; league time on hover' : ''})</span>}
    </p>
  )
}

function ChampionLine({ doc, teamNames }: { doc: PlayoffBracketDoc; teamNames: ReadonlyMap<string, string> }) {
  if (doc.status !== 'complete') return null
  const id = doc.champion_team_id ?? (doc.kind === 'bracket' ? doc.bracket_champion_team_id : null)
  return (
    <p className="flex items-center gap-2 rounded-sm border border-ink bg-brand px-3 py-2 text-[13px] font-extrabold text-ink" data-champion={id ?? 'none'}>
      {id ? (
        <>
          <Crest name={teamName(teamNames, id)} src={null} />
          {/* ONE flex item so the crest gap stays the only gap — the anchor
              wraps the NAME, never the "Champion · " prefix. */}
          <span>
            Champion · <TeamNameLink name={teamName(teamNames, id)} leagueId={doc.league_id} teamId={id} />
          </span>
        </>
      ) : (
        CHAMPION_UNRECORDED_COPY
      )}
    </p>
  )
}

/** §10.1's doors, pending by name: pressing one opens the copy that says
 *  what the modal will be (a reason, an audit entry) — no fake form, no
 *  ledger code on screen. */
function CommishDoors({ doors }: { doors: CommishDoor[] }) {
  const [open, setOpen] = useState<CommishDoor['key'] | null>(null)
  return (
    <div className="flex flex-col gap-2" data-commish-doors>
      <div className="flex flex-wrap items-center gap-2">
        {doors.map((door) => (
          <Button
            key={door.key}
            variant="stroke"
            size="sm"
            aria-pressed={open === door.key}
            onClick={() => setOpen((current) => (current === door.key ? null : door.key))}
            data-commish-door={door.key}
          >
            {door.label}
          </Button>
        ))}
      </div>
      {open && (
        <p role="status" className="rounded-sm border border-ink bg-white px-3 py-2 text-[12px] font-semibold text-n-3" data-commish-door-pending={open}>
          {COMMISH_DOOR_PENDING_COPY}
        </p>
      )}
    </div>
  )
}

export type { BracketRound }
