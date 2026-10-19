import { parseSettingsSection } from '@/components/leagues/settings-index-ops'
import { SettingsPanel } from '@/components/leagues/settings-panel'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileLeagueSettings } from '@/components/mobile/league/settings/league-settings-screen'

export const metadata = { title: 'League settings · FieldScout' }

interface LeagueSettingsPageProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<{ section?: string | string[]; edit?: string | string[] }>
}

/**
 * League settings — the exhaustive grouped §7.3 forms (M1 task L.A2.4; spec
 * §16.2 settings-panel), laid out as the prototype's index → detail (League
 * Settings build, 2026-10-04): `?section=` names the open section, so Back,
 * Forward and a shared link all land where they should. Commissioner-
 * editable; read-only for other members. Drives the real L.A1.13 PATCH path.
 *
 * On the phone it is League Menu › League settings / Scoring / Playoffs
 * (gap list §4 item 105): the same reads and writes as the handoff's three
 * rows pages, `?section=` picking the page (`MobileLeagueSettings`);
 * `&edit=1` (the phone's setup checklist) opens a commissioner straight in
 * the editor.
 */
export default async function LeagueSettingsPage({ params, searchParams }: LeagueSettingsPageProps) {
  const { leagueId } = await params
  const { section, edit } = await searchParams
  const parsed = parseSettingsSection(section)
  const startEditing = (Array.isArray(edit) ? edit[0] : edit) === '1'
  return (
    <ByLayout
      desktop={<SettingsPanel leagueId={leagueId} section={parsed} />}
      mobile={<MobileLeagueSettings leagueId={leagueId} section={parsed} startEditing={startEditing} />}
    />
  )
}
