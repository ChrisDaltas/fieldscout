'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { M_TEXT_FIELD, MField, MWizardFooter } from '@/components/mobile/ui/m-form'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
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
import { Skeleton } from '@/components/ui/skeleton'
import type { LayoutMode } from '@/hooks/use-layout-mode'
import { useLeagues, type MyLeagueRow } from '@/hooks/use-leagues'

import { Crest } from './league-cells'
import { extractJoinCode } from './invite-panel-ops'
import { LeagueCreateModal } from './league-create-modal'

/**
 * Leagues index — one card per real membership (my leagues via `useLeagues`,
 * M1 task L.A2.7). Creating and joining a league are FREE (business rule 5 /
 * Q6 / spec v2.8) — no Pro gate on either path. Cards open into the league
 * home state machine (`/app/leagues/[id]`).
 *
 * Skeleton / empty / error per §16.5.4. The card carries only what the list
 * endpoint returns (name, status, season, size, my role) — in-season stats
 * (record, points, playoff odds) arrive with the in-season milestone.
 */

const STATUS_BADGE: Record<string, { label: string; variant: 'yellow' | 'lime' | 'stroke' | 'green' }> = {
  setup: { label: 'Setup', variant: 'yellow' },
  scheduled: { label: 'Draft scheduled', variant: 'lime' },
  drafting: { label: 'Draft live', variant: 'lime' },
  in_season: { label: 'In season', variant: 'green' },
  playoffs: { label: 'Playoffs', variant: 'green' },
  complete: { label: 'Complete', variant: 'stroke' },
}

const ROLE_LABEL: Record<string, string> = {
  commissioner: 'Commissioner',
  co_commissioner: 'Co-commissioner',
  manager: 'Manager',
}

/**
 * Join-by-code entry point (L.A2.6) — a commissioner shares an invite code or a
 * custom `fieldscout.gg/join/<slug>` link; entering either here routes through
 * the SAME pre-auth preview page (`/join/[token]`). Joining is free (Q6). A
 * pasted link is normalised to its bare code via `extractJoinCode` (R114).
 *
 * `layout="mobile"` (the phone's Home, gap list §4 item 2) draws the same
 * form as a FieldScout Mobile bottom sheet — the 48px field, the wizard's
 * Continue button — in the phone's light or dark theme. Same code handling,
 * same destination.
 */
export function JoinLeagueDialog({
  open: openProp,
  onOpenChange,
  layout = 'desktop',
}: {
  /** Drive the dialog from elsewhere (Home's Join chip). When provided, the
   *  built-in trigger button is not rendered — the caller owns the affordance. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  layout?: LayoutMode
} = {}) {
  const router = useRouter()
  const formId = useId()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : uncontrolledOpen
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setUncontrolledOpen
  const [code, setCode] = useState('')

  const joinCode = extractJoinCode(code)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!joinCode) return
    router.push(`/join/${encodeURIComponent(joinCode)}`)
  }

  if (layout === 'mobile') {
    return (
      <MobileSheet
        open={open}
        onOpenChange={setOpen}
        title="Join a league"
        subtitle="Enter the invite code your commissioner shared, or paste a fieldscout.gg/join/… link."
        showClose
        footer={<MWizardFooter type="submit" form={formId} label="Continue" disabled={!joinCode} />}
      >
        <form id={formId} onSubmit={handleSubmit} className="px-5 pb-4">
          <MField label="Invite code or link" htmlFor={`${formId}-code`}>
            <input
              id={`${formId}-code`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. a1b2c3d4e5"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              autoFocus
              className={M_TEXT_FIELD}
              data-join-code
            />
          </MField>
        </form>
      </MobileSheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <Button variant="stroke" size="sm" onClick={() => setOpen(true)}>
          <Icon name="plus" size={13} />
          Join league
        </Button>
      )}
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
            <Button type="submit" variant="blue" size="sm" disabled={!joinCode}>
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function LeagueIndexCard({ league }: { league: MyLeagueRow }) {
  const badge = STATUS_BADGE[league.status] ?? { label: league.status, variant: 'stroke' as const }
  const roleLabel = ROLE_LABEL[league.my_role] ?? league.my_role

  return (
    // v7 "Leagues this week" card: hairline, 14px corners, 15px pad, a
    // rounded-square league tile; the lift is the hover affordance only.
    <Card className="flex flex-col gap-[14px] p-[15px] transition-shadow hover:shadow-hard-6">
      {/* Head row */}
      <div className="flex min-w-0 items-center gap-[9px]">
        <Crest name={league.name} className="h-[27px] w-[27px]" />
        <div className="mr-auto flex min-w-0 flex-col gap-px">
          <Link
            href={`/app/leagues/${league.id}`}
            className="truncate text-[13px] font-semibold leading-tight tracking-[-0.01em] text-ink hover:underline hover:underline-offset-2"
          >
            {league.name}
          </Link>
          <span className="truncate text-[10px] font-medium leading-tight text-n-6">
            <span className="fs-num">{league.season}</span> season ·{' '}
            <span className="fs-num">{league.team_count}</span>-team · {roleLabel}
          </span>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2.5">
        <span className="mr-auto text-[10px] font-medium text-n-3">
          {league.status === 'setup'
            ? 'Finish setting up your league'
            : league.status === 'scheduled'
              ? 'Draft is scheduled'
              : 'Open your league'}
        </span>
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
  const { data: leagues, isPending, isError, refetch } = useLeagues()
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <LeagueCreateModal open={createOpen} onOpenChange={setCreateOpen} />
      <PageHeader
        title="Leagues"
        actions={
          <div className="flex items-center gap-2">
            <JoinLeagueDialog />
            <Button variant="blue" size="sm" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={13} />
              Create league
            </Button>
          </div>
        }
      />

      {isPending ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <Card className="border-transparent bg-negative-soft">
          <div className="flex flex-col items-start gap-2 px-[17px] py-[15px]">
            <p className="text-[13px] font-bold text-ink" role="alert">
              Couldn&apos;t load your leagues.
            </p>
            <Button variant="stroke" size="sm" onClick={() => refetch()}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </div>
        </Card>
      ) : leagues && leagues.length > 0 ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {leagues.map((league) => (
            <LeagueIndexCard key={league.id} league={league} />
          ))}
        </div>
      ) : (
        <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <Icon name="cup" size={18} className="text-n-6" />
          <p className="text-h6 text-ink">No leagues yet</p>
          <p className="max-w-md text-[11px] font-medium text-n-6">
            Create your own league and invite your friends, or join one with an invite
            code. Both are free.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <JoinLeagueDialog />
            <Button variant="blue" size="sm" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={13} />
              Create league
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
