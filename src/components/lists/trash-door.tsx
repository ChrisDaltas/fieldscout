'use client'

import Link from 'next/link'

import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/hooks/use-toast'

/**
 * Trash's address — your deleted lists, each with Restore (`/app/trash`;
 * desktop's page and the phone's `MobileTrash`). Deletes stay soft (CLAUDE.md
 * rule 8), so this is where every deleted list can be got back from.
 *
 * Trash had no way in (audit frame-1, item #34): the page existed, and the
 * delete toasts said "moved to trash", but no link anywhere led to it. Its
 * doors are this toast's action and the Lists page on both layouts (desktop's
 * header, the foot of the phone's My lists).
 */
export const TRASH_HREF = '/app/trash'

/** The toast's action label — the one way it is spelt. */
export const VIEW_TRASH = 'View trash'

/**
 * The confirmation after a list is deleted: "“Title” moved to trash", with a
 * View trash action that opens Trash, where Restore puts the list back. Every
 * list delete (desktop's card menu and open list, the phone's list options)
 * says it through here, so the words and the way back can't drift apart.
 *
 * The action is a real link (the toast's own pill, `ToastAction`), so it
 * closes the toast and navigates like any other link — and on the phone,
 * Trash's Back returns to the screen the delete was made from. With an action
 * the phone keeps the toast up for 4.5s instead of 2s (toaster.tsx).
 */
export function toastMovedToTrash(title: string) {
  return toast({
    title: `“${title}” moved to trash`,
    action: (
      <ToastAction asChild altText="Open Trash, where you can restore the list">
        <Link href={TRASH_HREF} data-view-trash>
          {VIEW_TRASH}
        </Link>
      </ToastAction>
    ),
  })
}
