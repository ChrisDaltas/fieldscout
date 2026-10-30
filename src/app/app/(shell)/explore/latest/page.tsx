import { ByLayout } from '@/components/mobile/by-layout'
import { COMMUNITY_HREF } from '@/components/mobile/community/community-ops'
import { MobileCommunityLatest } from '@/components/mobile/community/latest-screen'
import { DesktopRedirect } from '@/components/mobile/desktop-redirect'

export const metadata = { title: 'Latest · FieldScout' }

/**
 * Community's Latest page (FieldScout Mobile; For you's "Latest" shelf → See
 * all, Chris 2026-10-16): every public list and ranking, newest first. Gated
 * with the rest of Community by the explore layout's launch flag. The
 * desktop layout has no such page: a desktop visit goes to Community — with
 * its `?list=<id>`, so a list opened here on a phone opens on desktop too
 * (plan C5).
 */
export default function CommunityLatestPage() {
  return <ByLayout desktop={<DesktopRedirect href={COMMUNITY_HREF} keepQuery />} mobile={<MobileCommunityLatest />} />
}
