'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { draftOptionsEntries, type DraftOptionsSectionId } from './draft-options-ops'

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
 * catalog itself is `draft-options-ops.ts`'s `draftOptionsEntries(isAuction)`
 * — an enumerated list, per DRAFT TYPE since L.C3.2: an auction room lists
 * Manual Edit Mode, Edit current nomination, Team budgets and End draft, and
 * a snake room never does (their RPCs refuse a snake draft outright — the UI
 * must not offer what the engine forbids).
 *
 * Pause/Resume are deliberately NOT menu items — they stay first-class
 * buttons on the bar (§8.7's v2.12 note: they are what a commissioner
 * reaches for while something is going wrong, and must not be two clicks
 * deep).
 *
 * Reachability: this component renders only behind the bar's
 * `showDraftOptions` gate, which is `commandBarModel(...).draftOptions` —
 * the commissioner on a real draft, or (MS.5 — §8.8 v2.15/D259: the
 * launcher is the commissioner of their own mock) the LAUNCHER on a
 * league-attached mock. On a mock the catalog filters to
 * `MOCK_ENABLED_SECTIONS` (clock + order — the controls with working
 * doors, D221(4): the still-shut groups are ABSENT, never disabled), and
 * *Delete practice & exit* joins the destructive group — the same door
 * with the same name, one catalog and one panel (D221(2); the LV.7
 * anti-pattern is a second menu re-solving a solved one). A STANDALONE
 * practice room never mounts this menu (no wire door exists for any of
 * its controls yet — F128/F129); its launcher keeps the bar's reduced
 * *Practice options* menu.
 */

interface DraftOptionsMenuProps {
  /** Opens the commissioner panel at the chosen section (the room owns the
   *  panel's `open`/`openAtSection` state — one door, one owner). */
  onOpenSection: (section: DraftOptionsSectionId) => void
  /** `draft.draft_type === 'auction'` — picks the group catalog (L.C3.2). */
  isAuction?: boolean
  /** League-attached mock (MS.5): filters the catalog to the enabled mock
   *  groups and appends *Delete practice & exit* to the destructive group. */
  isMock?: boolean
  /** The mock arm's delete-and-exit (the shipped `delete_mock_draft` verb —
   *  launcher-only in-RPC). Only rendered with `isMock`. */
  onDeletePractice?: () => void
  deletePending?: boolean
}

export function DraftOptionsMenu({
  onOpenSection,
  isAuction = false,
  isMock = false,
  onDeletePractice,
  deletePending = false,
}: DraftOptionsMenuProps) {
  const entries = draftOptionsEntries(isAuction, isMock)
  // The destructive group sits below ONE separator, however many entries it
  // holds (an auction has two — Reset and End; a snake has one; a mock has
  // none in the catalog — its destructive group is the delete item below).
  const firstDestructiveId = entries.find((entry) => entry.destructive)?.id ?? null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* §16.3 (v2.12): commissioner power behind ONE labeled control in
            the room's own chrome — the accent fill is the commissioner
            signature ("unmistakable"). Below `sm` the label compresses to
            "Options" (the D176(5) responsive-label treatment, extended to
            the commissioner arm by DR.7 when the bar gained its
            reconnecting chip — the densest 375 bar is commissioner ·
            paused · reconnecting, and the full label left the chip ~3
            characters); the accent fill keeps the control unmistakable at
            every width. */}
        <Button variant="blue" size="sm" className="shrink-0">
          <span className="sm:hidden">Options</span>
          <span className="hidden sm:inline">Draft Options</span>
        </Button>
      </DropdownMenuTrigger>
      {/* D152: the menu is a true overlay, and its RESTING shadow is carried
          by the DropdownMenuContent primitive (`shadow-hard-4`), which
          elevation-rule.test.ts allowlists as "overlay menu". This file adds
          no shadow of its own. */}
      <DropdownMenuContent align="start">
        {entries.map((entry) =>
          entry.destructive ? (
            // Destructive treatment: separated from the working groups and
            // rendered in the negative color — the same treatment as the
            // bar's "Delete practice & exit". The hard type-RESET confirm
            // itself lives in the panel's section (D153).
            <div key={entry.id}>
              {entry.id === firstDestructiveId && <DropdownMenuSeparator />}
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
        {isMock && onDeletePractice && (
          // MS.5 / D221(2): on a league-attached mock the single-item
          // Practice-options menu dissolves into this door — its one item
          // takes the same destructive treatment and position the real
          // catalog gives Reset/End. No catalog entry: delete-and-exit is a
          // bar-level action (the room's handler), not a panel section.
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-negative-strong focus:text-negative-strong"
              disabled={deletePending}
              onSelect={() => onDeletePractice()}
            >
              {deletePending ? 'Deleting…' : 'Delete practice & exit'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
