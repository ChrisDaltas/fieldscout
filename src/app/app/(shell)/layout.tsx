import { AppShell } from '@/components/layout/app-shell'

/**
 * Every `/app` route that wears the app chrome — sidebar, header, draft bar,
 * research rail, bottom tabs (DR.1 / D147).
 *
 * This layout holds NO auth guard on purpose: `src/app/app/layout.tsx` sits
 * above both this group and `(room)` and gates them with one code path.
 * Adding a second copy here would make the room's guard look optional.
 *
 * The draft recap (`…/draft/recap`) stays in this group deliberately — Chris
 * ruled the chrome-free treatment covers the LIVE draft surface because it
 * needs the space; a recap is a reading page revisited days later, and the
 * app's own navigation is the way out of it (spec §16.1 v2.12, Q12).
 */
export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AppShell>{children}</AppShell>
}
