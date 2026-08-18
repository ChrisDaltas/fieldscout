'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { DRAFT_OPTIONS_ENTRIES, type DraftOptionsSectionId } from './draft-options-ops'

/**
 * The `Draft Options` menu — spec §16.2 `draft-options-menu` (v2.12), §8.7's
 * v2.12 note ("Draft Options absorbs the entire commissioner panel"); tasks-DR
 * DR.3, D153.
 *
 * The SINGLE home for commissioner power in the room: a menu from the command
 * bar listing the §8.7 control groups, mapping 1:1 onto the shipped
 * `commish-draft-panel.tsx` sections. Choosing a group opens that existing
 * panel AT that section (D153: this is a menu over the SHIPPED panel body,
 * never a reimplementation — the section bodies, gates, confirm dialogs and
 * system-post semantics live in the panel and are untouched here). The group
 * catalog itself is `draft-options-ops.ts`'s `DRAFT_OPTIONS_ENTRIES` — an
 * enumerated list, extensible at L.C3.2 (see its docblock).
 *
 * Pause/Resume are deliberately NOT menu items — they stay first-class
 * buttons on the bar (§8.7's v2.12 note: they are what a commissioner
 * reaches for while something is going wrong, and must not be two clicks
 * deep).
 *
 * Reachability (D110(1)): this component renders only behind the bar's
 * `showDraftOptions` gate, which is `commandBarModel(...).draftOptions` —
 * commissioner on a NON-mock draft, with the `!isMock` mask re-applied at
 * the ops layer. No commissioner group is reachable on a mock; the mock
 * launcher's reduced *Practice options* menu is a separate control in the
 * bar and shares nothing with this one.
 */

interface DraftOptionsMenuProps {
  /** Opens the commissioner panel at the chosen section (the room owns the
   *  panel's `open`/`openAtSection` state — one door, one owner). */
  onOpenSection: (section: DraftOptionsSectionId) => void
}

export function DraftOptionsMenu({ onOpenSection }: DraftOptionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* §16.3 (v2.12): commissioner power behind ONE labeled control in
            the room's own chrome — the accent fill is the commissioner
            signature ("unmistakable"). */}
        <Button variant="blue" size="sm" className="shrink-0">
          Draft Options
        </Button>
      </DropdownMenuTrigger>
      {/* D152: the menu is a true overlay, and its RESTING shadow is carried
          by the DropdownMenuContent primitive (`shadow-hard-4`), which
          elevation-rule.test.ts allowlists as "overlay menu". This file adds
          no shadow of its own. */}
      <DropdownMenuContent align="start">
        {DRAFT_OPTIONS_ENTRIES.map((entry) =>
          entry.destructive ? (
            // Destructive treatment: separated from the working groups and
            // rendered in the negative color — the same treatment as the
            // bar's "Delete practice & exit". The hard type-RESET confirm
            // itself lives in the panel's section (D153).
            <div key={entry.id}>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-negative-strong focus:text-negative-strong"
                onSelect={() => onOpenSection(entry.id)}
              >
                {entry.label}
              </DropdownMenuItem>
            </div>
          ) : (
            <DropdownMenuItem key={entry.id} onSelect={() => onOpenSection(entry.id)}>
              {entry.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
