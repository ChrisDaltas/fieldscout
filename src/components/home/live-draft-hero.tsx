'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/**
 * Live-draft hero (package screen 01, top-left) — accent icon tile, live dot
 * + "Live draft · league" line, bold detail, blue shadow CTA. Renders only
 * when a draft is live or scheduled.
 */

interface LiveDraftAlert {
  live: boolean
  league: string
  detail: string
  cta: string
}

// TODO(live-draft): the league/draft backend doesn't exist yet, so there is
// never a live draft to announce. Return PREVIEW_ALERT instead of null to
// preview the hero card while building the draft room.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PREVIEW_ALERT: LiveDraftAlert = {
  live: true,
  league: 'The Work League',
  detail: "Round 4 · Pick 7 · you're on the clock",
  cta: 'Open draft room',
}

function useLiveDraftAlert(): LiveDraftAlert | null {
  return null
}

export function LiveDraftHero() {
  const draft = useLiveDraftAlert()
  if (!draft) return null
  return <LiveDraftHeroCard draft={draft} />
}

export function LiveDraftHeroCard({ draft }: { draft: LiveDraftAlert }) {
  return (
    <Card className="flex items-center gap-[13px] px-4 py-[13px] shadow-hard-4">
      <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-sm bg-accent text-accent-foreground">
        <Icon name="layers" size={18} />
      </span>

      <div className="mr-auto min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-pill',
              draft.live ? 'animate-pulse bg-positive-strong' : 'bg-caution-strong',
            )}
          />
          <span className="whitespace-nowrap text-[10px] font-extrabold">
            {draft.live ? 'Live draft' : 'Draft scheduled'}
          </span>
          <span className="truncate text-[10px] font-bold text-n-3">
            · {draft.league}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[13px] font-extrabold">
          {draft.detail}
        </div>
      </div>

      <Button
        variant="blue"
        shadow
        onClick={() =>
          // TODO(live-draft): route into the draft room once it exists.
          toast({
            title: 'Draft room',
            description: 'The live draft room is still under construction.',
          })
        }
      >
        {draft.cta}
        <Icon name="arrow-next" />
      </Button>
    </Card>
  )
}
