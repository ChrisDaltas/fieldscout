import { SettingsPanel } from '@/components/leagues/settings-panel'
import { parseSettingsSection } from '@/components/leagues/settings-index-ops'

export const metadata = { title: 'League settings · FieldScout' }

interface LeagueSettingsPageProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<{ section?: string | string[] }>
}

/**
 * League settings — the exhaustive grouped §7.3 forms (M1 task L.A2.4; spec
 * §16.2 settings-panel), laid out as the prototype's index → detail (League
 * Settings build, 2026-10-04): `?section=` names the open section, so Back,
 * Forward and a shared link all land where they should. Commissioner-
 * editable; read-only for other members. Drives the real L.A1.13 PATCH path.
 */
export default async function LeagueSettingsPage({ params, searchParams }: LeagueSettingsPageProps) {
  const { leagueId } = await params
  const { section } = await searchParams
  return <SettingsPanel leagueId={leagueId} section={parseSettingsSection(section)} />
}
