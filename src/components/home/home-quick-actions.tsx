'use client'

import { Button } from '@/components/ui/button'
import { Icon, type IconName } from '@/components/ui/icon'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'

/**
 * Home header quick-create chips — Join / League / List (package screen 01).
 * The icon tile flips to a plus on hover, Figma-style. Join and League are
 * stub actions until the league backend exists; List opens the existing
 * global create-list dialog.
 */

interface ActionChipProps {
  icon: IconName
  label: string
  /** Tile fill + icon color classes (tiles keep the 1px ink border). */
  tileClassName: string
  onClick: () => void
}

function ActionChip({ icon, label, tileClassName, onClick }: ActionChipProps) {
  return (
    <Button
      variant="stroke"
      size="sm"
      onClick={onClick}
      className="group gap-1.5 pl-1.5"
    >
      <span
        className={cn(
          'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm border border-ink',
          tileClassName,
        )}
      >
        <Icon name={icon} size={11} className="group-hover:hidden" />
        <Icon name="plus" size={11} className="hidden group-hover:block" />
      </span>
      {label}
    </Button>
  )
}

export function HomeQuickActions() {
  const setCreateListOpen = useUIStore((s) => s.setCreateListOpen)

  return (
    <span className="flex items-center gap-2">
      <ActionChip
        icon="team"
        label="Join"
        tileClassName="bg-brand text-ink"
        onClick={() =>
          // TODO(live-draft): joining a league needs the league backend —
          // invite codes don't exist yet.
          toast({
            title: 'Join a league',
            description:
              'Ask your commissioner for an invite code to join a league.',
          })
        }
      />
      <ActionChip
        icon="cup"
        label="League"
        tileClassName="bg-accent text-accent-foreground"
        onClick={() =>
          // TODO(live-draft): league creation ships with the league backend.
          toast({
            title: 'New league',
            description: 'League setup is on the way — starting with scoring.',
          })
        }
      />
      <ActionChip
        icon="list"
        label="List"
        tileClassName="bg-ink text-white"
        onClick={() => setCreateListOpen(true)}
      />
    </span>
  )
}
