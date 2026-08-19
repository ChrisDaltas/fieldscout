import { expect, type Page } from '@playwright/test'

/**
 * Open the bottom dock's Players panel — DR.8 (tasks-DR §5), for every spec
 * that drafts through the pool UI.
 *
 * The M2 room kept the pool RESIDENT (the desktop 340px rail / the mobile
 * pane switcher), so the L.B5.1 specs could click `Draft` the moment the
 * room was live. The redesigned room (spec §16.4's dock paragraph, v2.12)
 * hosts all five working panels in a bottom dock that is CLOSED BY DEFAULT
 * — "a focused view on just the draft board" is the ruling — so the pool
 * must be SUMMONED before any pool interaction. This helper is the one
 * place the suite knows how: the dock strip is a toolbar of disclosure
 * toggles (`draft-dock.tsx`; deliberately not a tablist — D180(3)), and the
 * open panel is an `aria-label`'d region named for its tab.
 */
export async function openDockPlayers(page: Page): Promise<void> {
  // `next dev`'s <nextjs-portal> dev-overlay indicator sits over the dock
  // strip's left corner and INTERCEPTS pointer events on the Players tab —
  // the exact artifact PROGRESS D180(5) recorded when DR.5 first drove the
  // strip under Playwright ("remove the portal before driving the strip in
  // dev"). Dev-server-only chrome; a production build never mounts it.
  await page.evaluate(() => document.querySelector('nextjs-portal')?.remove())
  await page
    .getByRole('toolbar', { name: 'Draft panels' })
    .getByRole('button', { name: 'Players', exact: true })
    .click()
  await expect(page.getByRole('region', { name: 'Players', exact: true })).toBeVisible()
}
