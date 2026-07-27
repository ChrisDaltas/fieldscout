'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { AIInsight } from '@/components/ui/ai-insight'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/use-auth'

import { Crest } from './league-cells'
import { MOCK_LEAGUES, type MockLeague } from './league-mock-data'

/**
 * Leagues index — one card per membership (the home "Your leagues" anatomy:
 * head row, 4-stat strip, matchup footer) opening into the league workspace.
 * Leagues are Pro-only (business rule 5): creating routes through the
 * Pro-gated `/app/leagues/new`, and free users get the accent-blue Pro
 * moment in Scout AI voice — never lime.
 *
 * TODO(live-draft): the league backend does not exist. Cards render mock
 * memberships; swap MOCK_LEAGUES for the live memberships query when
 * leagues land.
 */

function ordinal(n: number): string {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

/**
 * Join-by-code entry point (L.A2.6) — replaces the former stub. A commissioner
 * shares an invite code or a custom `fieldscout.gg/join/<slug>` link; entering
 * either here routes through the SAME pre-auth preview page (`/join/[token]`)
 * that resolves seat tokens, share codes, and custom slugs (§16.1). Joining is
 * free (business rule 5 / Q6) — no Pro gate on this path.
 */
function JoinLeagueDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')

  const trimmed = code.trim()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!trimmed) return
    router.push(`/join/${encodeURIComponent(trimmed)}`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="stroke" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={13} />
        Join league
      </Button>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Join a league</DialogTitle>
          <DialogDescription>
            Enter the invite code your commissioner shared, or paste a{' '}
            <span className="font-bold text-ink">fieldscout.gg/join/…</span> link.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="join-code">Invite code or link</Label>
            <Input
              id="join-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. a1b2c3d4e5"
              autoComplete="off"
              autoFocus
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="blue" size="sm" disabled={!trimmed}>
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LeagueIndexCard({ league }: { league: MockLeague }) {
  const winning = league.winProb >= 50
  const stats: Array<[label: string, value: string]> = [
    ['Record', league.record],
    ['Points for', league.pf.toLocaleString()],
    ['Points against', league.pa.toLocaleString()],
    ['Playoff odds', `${league.playoff}%`],
  ]

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-hard-4">
      {/* Head row */}
      <div className="flex items-center gap-2.5 border-b border-ink px-[13px] py-2.5">
        <Crest name={league.team} className="h-8 w-8" fallbackClassName="text-[10px]" />
        <div className="mr-auto flex min-w-0 flex-col">
          <Link
            href={`/app/leagues/${league.id}`}
            className="truncate text-[12px] font-extrabold leading-tight hover:underline hover:decoration-2 hover:underline-offset-2"
          >
            {league.team}
          </Link>
          <span className="truncate text-[10px] font-semibold leading-tight text-n-3">
            {league.name} · {league.format}
          </span>
        </div>
        {league.liveDraft ? (
          <Badge variant="lime">
            <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-current" />
            Draft live
          </Badge>
        ) : (
          <Badge variant={league.rank === 1 ? 'green' : 'stroke'}>
            {ordinal(league.rank)} place
          </Badge>
        )}
      </div>

      {/* 4-stat strip */}
      <div className="grid grid-cols-4 border-b border-ink">
        {stats.map(([label, value], i) => (
          <div
            key={label}
            className={`min-w-0 px-2.5 py-2 ${i > 0 ? 'border-l border-n-4' : ''}`}
          >
            <div className="truncate text-[10px] font-medium tracking-[0.01em] text-n-3">
              {label}
            </div>
            <div className="fs-num mt-0.5 truncate text-[14px] font-extrabold">
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Matchup footer */}
      <div className="flex flex-wrap items-center gap-2.5 px-[13px] py-2.5">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[10px] font-medium tracking-[0.01em] text-n-3">
              This week vs
            </span>
            <Crest name={league.opp} className="h-4 w-4" fallbackClassName="text-[7px]" />
            <span className="truncate text-[10px] font-extrabold">{league.opp}</span>
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="fs-num text-[18px] font-extrabold">
              {league.proj.toFixed(1)}
            </span>
            <span className="text-[10px] font-bold text-n-3">vs</span>
            <span className="fs-num text-[13px] font-extrabold text-n-3">
              {league.oppProj.toFixed(1)}
            </span>
          </div>
        </div>
        <Badge variant={winning ? 'green' : 'yellow'}>
          {winning ? 'Win' : 'Toss-up'} prob{' '}
          <span className="fs-num">{league.winProb}%</span>
        </Badge>
        {league.liveDraft && (
          <Button variant="lime" size="sm" asChild>
            <Link href={`/app/leagues/${league.id}/draft`}>
              <Icon name="fire" size={13} />
              Join draft
            </Link>
          </Button>
        )}
        <Button variant="stroke" size="sm" asChild>
          <Link href={`/app/leagues/${league.id}`}>
            Open
            <Icon name="arrow-next" size={13} />
          </Link>
        </Button>
      </div>
    </Card>
  )
}

export function LeaguesIndex() {
  const router = useRouter()
  const { profile } = useAuth()

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Leagues"
        actions={
          <div className="flex items-center gap-2.5">
            <JoinLeagueDialog />
            <Button
              variant="blue"
              size="sm"
              shadow
              onClick={() => router.push('/app/leagues/new')}
            >
              <Icon name="plus" size={13} />
              Create league
            </Button>
          </div>
        }
      />

      {/* The card grid is mock data — it never waits on auth. Only the Pro
          moment needs the resolved profile. */}
      {profile && !profile.is_pro && (
        <AIInsight heading="Leagues are a Pro play.">
          <p>
            Run drafts, set lineups, and work the wire with your own
            league — creating and joining leagues comes with Pro.
          </p>
          <div className="mt-3">
            <Button
              variant="blue"
              size="sm"
              onClick={() => router.push('/app/settings/billing')}
            >
              <Icon name="star" size={13} />
              Upgrade to Pro
            </Button>
          </div>
        </AIInsight>
      )}

      <div className="grid grid-cols-1 gap-[19px] lg:grid-cols-2 2xl:grid-cols-3">
        {MOCK_LEAGUES.map((league) => (
          <LeagueIndexCard key={league.id} league={league} />
        ))}
      </div>

      <p className="text-[11px] font-medium text-n-3">
        Preview data — real leagues land with league sync.
      </p>
    </div>
  )
}
