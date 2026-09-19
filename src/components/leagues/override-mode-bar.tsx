'use client'

import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * THE OVERRIDE-MODE SWITCH — PROGRESS §3 STANDING RULE (h): *"the commissioner
 * going into 'override mode' … and then when they're done they exit override
 * mode. when override mode is active there is some visual indications that
 * it's on."*
 *
 * ONE control, lifted out of `lineup-editor.tsx` by M6A L.E1.12 so the matchup
 * page mounts the SAME switch rather than a look-alike (CLAUDE.md: no
 * near-duplicate components; tasks-M6A §2.6: every commissioner control is a
 * property of the one mode). The markup, the data attributes and the button
 * words are the editor's — `team-page.render.test.ts` pins them through the
 * editor and `matchup-view.render.test.ts` through the matchup page. Only the
 * sentence differs per surface, so it is the `children`. The one addition is
 * `aria-pressed` (the on-state exposed, not only painted).
 *
 * It holds no state and no authority: the caller owns the store read/write
 * (`commish-override-store.ts`) and gates the mount on the viewer's
 * commissioner role; the server decides who may call any `commish_*` verb.
 *
 * A11y: a `role="status"` region, so turning the mode on is ANNOUNCED; the
 * toggle is a real `<button>` with `aria-pressed`; the visible on-state is
 * the ink badge + the brand fill (a resting condition ⇒ fill and border,
 * never a shadow — CLAUDE.md). There is NO text field here or anywhere in the
 * mode (F343 / Q66).
 */
export function OverrideModeBar({
  on,
  busy = false,
  busyTitle = 'Wait for the save to finish.',
  onToggle,
  children,
}: {
  on: boolean
  /** R985: the toggle is LOCKED while a write is in flight — leaving mid-save
   *  would orphan the pending write's outcome line. */
  busy?: boolean
  busyTitle?: string
  onToggle: (next: boolean) => void
  /** The surface's own sentence: what the mode does HERE. */
  children: ReactNode
}) {
  return (
    <div
      role="status"
      data-commish-tools
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-sm border px-3 py-2 text-[12px] font-semibold text-ink',
        on ? 'border-ink bg-brand' : 'border-ink bg-white',
      )}
    >
      {on && (
        <Badge variant="black" className="shrink-0">
          ✸ Override mode ON
        </Badge>
      )}
      <span className="min-w-[180px] flex-1">{children}</span>
      <Button
        variant="stroke"
        size="sm"
        disabled={busy}
        title={busy ? busyTitle : undefined}
        aria-pressed={on}
        onClick={() => {
          if (busy) return
          onToggle(!on)
        }}
        data-override-toggle={on ? 'on' : 'off'}
        data-override-toggle-blocked={busy ? 'saving' : undefined}
      >
        {on ? 'Exit override mode' : 'Turn on override mode'}
      </Button>
    </div>
  )
}
