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
      {/* ONE scroll region for the page-shaped resolver states (skeleton,
          lobby, launcher, problem/empty cards…). The LIVE room does not use
          it (DR.4): `DraftRoomLive`'s root is `h-full` + `overflow-hidden`,
          so it fills this wrapper exactly — the wrapper can never overflow
          while the live room is mounted — and the room's only vertical
          scroll is the live room's own board zone, beneath its two fixed
          chrome bands (command bar + status strip; §16.4/D149). (DR.1's
          version of this comment forecast the bands as siblings ABOVE this
          wrapper; what landed is the equivalent inside-out form — the bands
          are flex bands inside the room's non-scrolling root.) */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
