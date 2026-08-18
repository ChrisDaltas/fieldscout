/**
 * The draft room's own frame — full-viewport, chrome-free (DR.1; spec §16.1
 * v2.12, ruled by Chris 2026-08-17: *"having a bunch unnecessary UI mid draft
 * doesn't make sense… you need all the space you have for the draft
 * surfaces"*).
 *
 * What this deliberately does NOT render, versus `(shell)/layout.tsx`: the
 * left sidebar, the mobile top nav, the app header, the draft bar, the
 * right-hand research rail (and its reserved `lg:pr-rail-strip` strip), the
 * global bottom tabs, and the shell's page gutters / `pb-[20vh]` tail. The
 * room is `h-screen`-shaped, not page-shaped.
 *
 * Auth is NOT re-checked here: `src/app/app/layout.tsx` sits above this group
 * and `(shell)` and gates both (D147). Nothing the room needs was left behind
 * in the shell — React Query, the Supabase browser client, the toaster and
 * the player-window layer all come from `src/app/layout.tsx`, and the queue's
 * drag-and-drop owns its own `DndContext` inside `my-queue.tsx` rather than
 * borrowing the shell's `AppDndContext`. `route-groups.test.ts` pins that
 * enumeration so a provider added to the shell later is not silently assumed
 * here.
 */
export default function DraftRoomLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-page">
      {/* ONE scroll region, and the frame owns it at DR.1 because the chrome
          bands do not exist yet. DR.4 makes the command bar + status strip
          fixed siblings above this and hands the scroll to the board zone —
          at which point this wrapper becomes the board's, not the page's. */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
