'use client'

import Link from 'next/link'

import { teamPageHref } from '@/components/leagues/league-cells'
import {
  AWAITING_BUILD_COPY,
  PROJECTED_TITLE,
  TBD_LABEL,
  bracketShape,
  formatBracketScore,
  formatTotal,
  gamePlayed,
  pointsRaceCopy,
  projectionBasisCopy,
  roundLabel,
  tbdSlots,
} from '@/components/leagues/playoff-bracket-ops'
import type { BracketGame, PlayoffBracket, ProjectedPair } from '@/lib/leagues/api/playoffs-service'
import { cn } from '@/lib/utils'

import { CenteredNote, SkeletonBlocks, TeamAvatar } from './league-bits'
import { teamAvatarClass } from './league-tab-ops'

/**
 * The playoff bracket in the mobile language (handoff m-league §2.8 — the
 * prototype computes it and its Playoffs page says it "shows at the top of
 * the League tab once the playoffs start"): one block per round, "Week N"
 * under the round's name, each game a b1 card of two slots (seed, avatar,
 * name, points), TBD slots on b4 / t5, Bye on b3 / t3, the championship
 * ringed in gold. The document is the server's (118): seeds, totals and the
 * winner are read, never decided here.
 */
export function MobileBracket({
  doc,
  pending,
  problem,
  onRetry,
  teamNames,
  teamIds,
  myTeamId,
}: {
  doc: PlayoffBracket | undefined
  pending: boolean
  problem: boolean
  onRetry: () => void
  teamNames: ReadonlyMap<string, string>
  teamIds: readonly string[]
  myTeamId: string | null
}) {
  if (pending && !doc) return <SkeletonBlocks count={2} className="h-[88px]" />
  if (!doc) {
    return problem ? <CenteredNote role="alert" message="Couldn’t load the bracket." action="Try again" onAction={onRetry} className="py-6" /> : null
  }
  if (doc.kind !== 'bracket') {
    return <p className="rounded-[14px] bg-m-b1 px-3 py-3 text-[12px] font-medium text-m-t3">{pointsRaceCopy(doc.kind)}</p>
  }
  const shape = bracketShape(doc)
  const av = (id: string | null) => teamAvatarClass(id, teamIds, myTeamId)
  const name = (id: string | null) => (id ? (teamNames.get(id) ?? 'Team') : TBD_LABEL)
  const weekOf = (round: number) => doc.playoff_start_week + (round - 1) * doc.weeks_per_round

  return (
    <div className="flex flex-col gap-3" data-mobile-bracket={shape}>
      {shape === 'projected' && (
        <p className="px-1 text-[12px] font-medium leading-[1.35] text-m-t3">
          <span className="font-semibold text-m-t1">{PROJECTED_TITLE}.</span> {projectionBasisCopy(doc.projection_basis, doc.playoff_teams)}
        </p>
      )}
      {shape === 'awaiting_build' && <p className="rounded-[14px] bg-m-b1 px-3 py-3 text-[12px] font-medium text-m-t3">{AWAITING_BUILD_COPY}</p>}
      {Array.from({ length: doc.rounds }, (_, i) => {
        const round = i + 1
        const champ = round === doc.rounds
        const stored = doc.round_list.find((r) => r.round === round)
        const storedWeeks = (stored?.weeks ?? []).map((w) => w.week).sort((a, b) => a - b)
        const first = storedWeeks[0] ?? weekOf(round)
        const last = storedWeeks[storedWeeks.length - 1] ?? first + doc.weeks_per_round - 1
        const weeks = last > first ? `Weeks ${first}–${last}` : `Week ${first}`
        let games: React.ReactNode[]
        if (shape === 'projected' && round === 1 && doc.projected_round_1) {
          games = doc.projected_round_1.map((pair, g) => (
            <ProjectedCard key={g} pair={pair} name={name} av={av} champ={champ} leagueId={doc.league_id} />
          ))
        } else if (shape === 'bracket' && stored?.built) {
          games = stored.games.map((game, g) => <GameCard key={g} game={game} name={name} av={av} champ={champ} leagueId={doc.league_id} />)
        } else {
          const slots = stored ? tbdSlots(stored) : doc.bracket_size / 2 ** round
          games = Array.from({ length: slots }, (_, g) => <TbdCard key={g} champ={champ} />)
        }
        return (
          <section key={round} className="flex flex-col gap-2" aria-label={roundLabel(round, doc.rounds)}>
            <div className="flex items-baseline gap-2 px-1">
              <span className="text-[13px] font-semibold text-m-t1">{roundLabel(round, doc.rounds)}</span>
              <span className="text-[11px] font-medium text-m-t3">{weeks}</span>
            </div>
            {games}
          </section>
        )
      })}
    </div>
  )
}

type Name = (id: string | null) => string
type Av = (id: string | null) => string

function Card({ champ, children }: { champ: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('overflow-hidden rounded-[14px] bg-m-b1', champ && 'ring-[1.5px] ring-inset ring-pos-te')}>{children}</div>
  )
}

function Slot({
  seed,
  label,
  avClass,
  pts,
  kind,
  first,
  dim = false,
  href,
}: {
  seed: number | null
  label: string
  avClass: string
  pts: string | null
  kind: 'team' | 'tbd' | 'bye'
  first: boolean
  dim?: boolean
  href?: string
}) {
  const body = (
    <>
      <span className="w-4 flex-none text-right text-[11px] font-semibold tabular-nums text-m-t3">{seed ?? ''}</span>
      {kind === 'team' ? (
        <TeamAvatar name={label} className={avClass} />
      ) : (
        <span aria-hidden="true" className={cn('size-7 flex-none rounded-full', kind === 'tbd' ? 'bg-m-b4' : 'bg-m-b3')} />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px]',
          kind === 'team' ? 'font-semibold' : 'font-medium',
          kind === 'tbd' ? 'text-m-t5' : kind === 'bye' ? 'text-m-t3' : dim ? 'text-m-t3' : 'text-m-t1',
        )}
      >
        {label}
      </span>
      {pts !== null && <span className={cn('text-[13px] font-semibold tabular-nums', dim ? 'text-m-t3' : 'text-m-t1')}>{pts}</span>}
    </>
  )
  const cls = cn('flex h-11 items-center gap-2.5 px-3', first && 'border-b border-m-b3')
  return href ? (
    <Link href={href} className={cn(cls, 'active:bg-m-b2')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function GameCard({ game, name, av, champ, leagueId }: { game: BracketGame; name: Name; av: Av; champ: boolean; leagueId: string }) {
  const played = gamePlayed(game)
  const status = game.weeks[0]?.status ?? 'scheduled'
  const pts = (total: number, score: number | null | undefined) =>
    !played ? null : game.weeks.length > 1 ? formatTotal(total) : formatBracketScore(score ?? null, status)
  const decided = game.final && game.decided_by !== 'bye'
  return (
    <Card champ={champ}>
      <Slot
        seed={game.home_seed}
        label={name(game.home_team_id)}
        avClass={av(game.home_team_id)}
        pts={pts(game.home_total, game.weeks[0]?.home_score)}
        kind="team"
        first
        dim={decided && game.winner_team_id !== game.home_team_id}
        href={teamPageHref(leagueId, game.home_team_id)}
      />
      {game.away_team_id ? (
        <Slot
          seed={game.away_seed}
          label={name(game.away_team_id)}
          avClass={av(game.away_team_id)}
          pts={pts(game.away_total, game.weeks[0]?.away_score)}
          kind="team"
          first={false}
          dim={decided && game.winner_team_id !== game.away_team_id}
          href={teamPageHref(leagueId, game.away_team_id)}
        />
      ) : (
        <Slot seed={null} label="Bye" avClass="" pts={null} kind="bye" first={false} />
      )}
    </Card>
  )
}

function ProjectedCard({ pair, name, av, champ, leagueId }: { pair: ProjectedPair; name: Name; av: Av; champ: boolean; leagueId: string }) {
  return (
    <Card champ={champ}>
      <Slot
        seed={pair.home.seed}
        label={name(pair.home.team_id)}
        avClass={av(pair.home.team_id)}
        pts={null}
        kind="team"
        first
        href={teamPageHref(leagueId, pair.home.team_id)}
      />
      {pair.away ? (
        <Slot
          seed={pair.away.seed}
          label={name(pair.away.team_id)}
          avClass={av(pair.away.team_id)}
          pts={null}
          kind="team"
          first={false}
          href={teamPageHref(leagueId, pair.away.team_id)}
        />
      ) : (
        <Slot seed={null} label="Bye" avClass="" pts={null} kind="bye" first={false} />
      )}
    </Card>
  )
}

function TbdCard({ champ }: { champ: boolean }) {
  return (
    <Card champ={champ}>
      <Slot seed={null} label={TBD_LABEL} avClass="" pts={null} kind="tbd" first />
      <Slot seed={null} label={TBD_LABEL} avClass="" pts={null} kind="tbd" first={false} />
    </Card>
  )
}
