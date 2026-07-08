'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { AIInsight } from '@/components/ui/ai-insight'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { toast } from '@/hooks/use-toast'

/**
 * Create a league — Pro-gated scaffold (business rule 5: leagues are Pro
 * only). Free users get the accent-blue Pro moment in Scout AI voice; Pro
 * users get the league basics form.
 *
 * TODO(live-draft): no league backend exists — submitting is a stub. Wire
 * the form to the real create-league mutation when leagues land.
 */

type DraftFormat = 'snake' | 'auction'

const TEAM_COUNTS = ['8', '10', '12', '14', '16'] as const

const SCORING_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'half-ppr', label: 'Half PPR' },
  { value: 'ppr', label: 'Full PPR' },
] as const

export function LeagueCreateScaffold() {
  const router = useRouter()
  const { profile, isLoading } = useAuth()
  const isPro = Boolean(profile?.is_pro)

  const [name, setName] = useState('')
  const [teamCount, setTeamCount] = useState<string>('12')
  const [scoring, setScoring] = useState<string>('ppr')
  const [draftFormat, setDraftFormat] = useState<DraftFormat>('snake')

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault()
    // TODO(live-draft): stub — league creation needs the league backend.
    toast({
      title: 'League creation is coming',
      description: 'Your settings look good — creating leagues ships with league sync.',
    })
  }

  return (
    <div className="max-w-[560px]">
      <PageHeader title="Create a league" />

      <div className="mb-4">
        <Button variant="stroke" size="sm" onClick={() => router.back()}>
          <Icon name="arrow-prev" size={13} />
          Back
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : !isPro ? (
        <AIInsight heading="Leagues are a Pro play.">
          <p>
            Creating a league unlocks live drafts, custom scoring, and weekly
            head-to-heads with your own crew — that&apos;s a Pro tool.
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
      ) : (
        <form onSubmit={handleCreate}>
          <Card>
            <CardHeader>
              <CardTitle>League basics</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="league-name">League name</Label>
                <Input
                  id="league-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Sunday Legends"
                  maxLength={60}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="league-teams">Teams</Label>
                <Select value={teamCount} onValueChange={setTeamCount}>
                  <SelectTrigger id="league-teams">
                    <SelectValue placeholder="Pick a league size" />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_COUNTS.map((count) => (
                      <SelectItem key={count} value={count}>
                        {count} teams
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="league-scoring">Scoring</Label>
                <Select value={scoring} onValueChange={setScoring}>
                  <SelectTrigger id="league-scoring">
                    <SelectValue placeholder="Pick a scoring system" />
                  </SelectTrigger>
                  <SelectContent>
                    {SCORING_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] font-medium text-n-3">
                  Fine-tune every value in the{' '}
                  <Link
                    href="/app/settings/scoring"
                    className="font-bold text-ink underline decoration-1 underline-offset-2 hover:decoration-2"
                  >
                    scoring builder
                  </Link>
                  .
                </p>
              </div>

              <div className="space-y-1.5 border-t border-n-4 pt-4">
                <Label>Draft format</Label>
                <RadioGroup
                  value={draftFormat}
                  onValueChange={(value) => setDraftFormat(value as DraftFormat)}
                  className="flex flex-col gap-2.5 pt-1"
                >
                  <label className="flex items-center gap-2.5">
                    <RadioGroupItem value="snake" id="draft-snake" />
                    <span className="text-[13px] font-bold">Snake</span>
                    <span className="text-[11px] font-medium text-n-3">
                      Pick order reverses every round
                    </span>
                  </label>
                  <label className="flex items-center gap-2.5">
                    <RadioGroupItem value="auction" id="draft-auction" />
                    <span className="text-[13px] font-bold">Auction</span>
                    <span className="text-[11px] font-medium text-n-3">
                      Nominate, bid, and win any player
                    </span>
                  </label>
                </RadioGroup>
              </div>

              <div className="flex items-center gap-2.5 border-t border-n-4 pt-4">
                <p className="mr-auto text-[11px] font-medium text-n-3">
                  Preview only — creation ships with league sync.
                </p>
                <Button type="submit" variant="blue" size="sm" shadow>
                  <Icon name="plus" size={13} />
                  Create league
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  )
}
