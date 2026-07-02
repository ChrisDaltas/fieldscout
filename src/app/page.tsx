import { redirect } from 'next/navigation'
import Link from 'next/link'

import { GuestShell } from '@/components/layout/guest-shell'
import {
  GuestBigBoard,
  type GuestBigBoardPlayer,
} from '@/components/players/guest-big-board'
import { Button } from '@/components/ui/button'
import { createServerClient } from '@/lib/supabase/server'

// Curated top players for the guest preview big board. We look these up by
// full_name against the synced players table so the modal can fetch real stats.
const SEED_NAMES = [
  'CeeDee Lamb',
  "Ja'Marr Chase",
  'Tyreek Hill',
  'Christian McCaffrey',
  'Bijan Robinson',
  'Jahmyr Gibbs',
  'Justin Jefferson',
  'Amon-Ra St. Brown',
  'Saquon Barkley',
  'Breece Hall',
  'Jonathan Taylor',
  'Garrett Wilson',
  'Patrick Mahomes',
  'Josh Allen',
  'Lamar Jackson',
  'Derrick Henry',
  'A.J. Brown',
  'Davante Adams',
  'Travis Kelce',
  'Sam LaPorta',
  'Puka Nacua',
  'Drake London',
  'De’Von Achane',
  'Malik Nabers',
] as const

async function loadSeedPlayers(): Promise<GuestBigBoardPlayer[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('players')
    .select('id, full_name, position, team, headshot_url')
    .in('full_name', SEED_NAMES as unknown as string[])

  const byName = new Map<string, GuestBigBoardPlayer>(
    (data ?? []).map((p) => [p.full_name as string, p as GuestBigBoardPlayer]),
  )

  // Preserve our curated order; drop any names that didn't match the DB.
  return SEED_NAMES.map((name) => byName.get(name)).filter(
    (p): p is GuestBigBoardPlayer => Boolean(p),
  )
}

export default async function GuestHomePage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/app')
  }

  const players = await loadSeedPlayers()

  return (
    <GuestShell wide>
      <div className="space-y-10">
        <header className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            Welcome to FieldScout
          </h1>
          <p className="mt-3 text-base text-text-secondary md:text-lg">
            Get ready for draft season. FieldScout is the ultimate tool 100% focused
            on fantasy football.
          </p>
          <p className="mt-6 text-sm font-medium text-foreground">
            Start building your fantasy rankings now and get ready for draft season.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/signup">
              <Button size="lg" className="font-semibold">
                Sign up free
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="invisible" className="text-text-secondary">
                Sign in
              </Button>
            </Link>
          </div>
        </header>

        <GuestBigBoard players={players} />

        <section className="border-t border-bg-elevated-2 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Explore the community</h3>
            <Link
              href="/consensus"
              className="text-sm font-medium text-foreground hover:text-text-secondary"
            >
              View consensus →
            </Link>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-text-secondary">
            Public rankings, expert profiles, and weekly Start or Sit are open to
            everyone. Sign up free when you want to save your work, follow rankers,
            or start tracking accuracy.
          </p>
        </section>
      </div>
    </GuestShell>
  )
}
