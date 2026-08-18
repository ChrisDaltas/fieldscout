import { SettingsPanel } from '@/components/leagues/settings-panel'

export const metadata = { title: 'League settings · FieldScout' }

interface LeagueSettingsPageProps {
  params: Promise<{ leagueId: string }>
}

/**
 * League settings — the exhaustive grouped §7.3 forms (M1 task L.A2.4; spec
 * §16.2 settings-panel). Commissioner-editable; read-only for other members
 * and locked once past `scheduled` (§7.1). Drives the real L.A1.13 PATCH path.
 */
export default async function LeagueSettingsPage({ params }: LeagueSettingsPageProps) {
  const { leagueId } = await params
  return <SettingsPanel leagueId={leagueId} />
}
