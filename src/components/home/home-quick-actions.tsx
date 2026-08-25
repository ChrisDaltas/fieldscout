'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { MockLaunchDialog } from '@/components/draft/mock-launch-dialog'
import { mockRoomHref } from '@/components/draft/mock-launcher-entry'
import { Button } from '@/components/ui/button'
import { Icon, type IconName } from '@/components/ui/icon'
import { toast } from '@/hooks/use-toast'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'

/**
 * Home header quick-create chips — Join / League / List / Mock (package
 * screen 01). The icon tile flips to a plus on hover, Figma-style. Join and
 * League are stub actions until the league backend exists; List opens the
 * existing global create-list dialog; Mock opens the practice-draft launch
 * dialog and walks the launcher into the room.
 *
 * **Mock is MP.7 — entry point one of ruling §3.4, and it sits INSIDE this
 * chip row rather than in a new hub card of its own** (tasks-MP §5 MP.7
 * item 1 / §4 rule 15): a card on Home is a layout decision and belongs to
 * DR2 / the Figma, whereas "one more chip beside the others" is the
 * structure that already exists here.
 *
 * **Gated on `featureFlags.mockDrafts` and NOTHING else (D231(1); E79).**
 * The three `leagues`-flag surfaces above it are a different release
 * question, and with `leagues` OFF this chip still renders, still opens the
 * dialog, still launches, and the room it lands in still loads — MP.7 item 4,
 * the assertion that makes ruling 3.8 true rather than intended. With
 * `mockDrafts` off, the block renders nothing and this header is what it was
 * before this task; both halves are pinned in `home-quick-actions.test.ts`.
 *
 * **ONE launch dialog (MP.7 item 3).** `MockLaunchDialog` is composed at its
 * shipped definition — this is its second mount beside `/app/mocks`, with no
 * fork and no second settings surface (a second settings editor is the LV.7
 * failure pattern; MP.4's own docblock states the rule). Nothing about the
 * form is decided here: this mount's only decision is *where the launcher
 * lands*, which is what MP.4 left to its mounts, and it is the one place the
 * two mounts deliberately differ — `/app/mocks` closes back onto its list
 * (the list IS that page), Home has no list to close onto and so walks the
 * launcher into the room through the shared `mockRoomHref` seam.
 *
 * **The §22.5 3-active cap is not pre-flighted here, deliberately.**
 * `/app/mocks` can disable its control because that page already holds the
 * list the cap counts; Home holds no such list, and fetching one on every
 * Home render to grey out a chip would buy a query per page load. The RPC's
 * refusal is product copy and surfaces VERBATIM inside the dialog (§16.5.2 —
 * MP.4's inline refusal), which is where the launcher is already looking.
 *
 * **Join and League are not this task's business (MP.7 item 5).** They toast,
 * they are `leagues`-gated stubs, and they are noted rather than fixed.
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
  const router = useRouter()
  const [mockLaunchOpen, setMockLaunchOpen] = useState(false)

  return (
    <span className="flex items-center gap-2">
      {featureFlags.leagues && (
      <>
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
      </>
      )}
      <ActionChip
        icon="list"
        label="List"
        tileClassName="bg-ink text-white"
        onClick={() => setCreateListOpen(true)}
      />
      {featureFlags.mockDrafts && (
      <>
      <ActionChip
        icon="rocket"
        label="Mock"
        // A SATURATED resting fill, like all three of its row-mates (R538).
        // `bg-accent-soft` was the first cut and is withdrawn: globals.css
        // annotates it "hover surfaces" (`:37`), and a tile that reads
        // lighter than every neighbour looks like an unfinished state rather
        // than a fourth identity. `brand-strong` is the shipped `lime`
        // button variant's own resting fill (button.tsx:37), with that
        // variant's ink pairing — the three saturated tiles beside it are
        // taken (brand / accent / ink), and lime is "look here", which is
        // what a practice draft you are about to start is.
        tileClassName="bg-brand-strong text-ink"
        onClick={() => setMockLaunchOpen(true)}
      />
      <MockLaunchDialog
        open={mockLaunchOpen}
        onOpenChange={setMockLaunchOpen}
        onLaunched={(created) => {
          // Home has no list to fall back onto, so the launch LANDS the user
          // in the room (MP.7 item 2) — through the shared href builder, never
          // a hand-rolled `/app/mocks/${…}` (the seam R470 exists for: the
          // `/app/leagues` URL space is redirected away wholesale when the
          // leagues flag is off, and this route is the escape from it).
          setMockLaunchOpen(false)
          router.push(mockRoomHref(created.id))
        }}
      />
      </>
      )}
    </span>
  )
}
