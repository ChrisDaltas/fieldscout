import { AuctionDraftRoom } from '@/components/draft/auction-draft-room'
import {
  MOCK_AUCTION_DRAFT,
  MOCK_LEAGUE,
  MOCK_SNAKE_DRAFT,
  type DraftFormat,
} from '@/components/draft/mock-draft'
import { SnakeDraftRoom } from '@/components/draft/snake-draft-room'

export const metadata = { title: 'Draft room · FieldScout' }

interface DraftRoomPageProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<{ format?: string | string[] }>
}

/** `?format=snake|auction` picks the room; anything else falls back to the
 *  league's configured format. */
function parseFormat(param: string | string[] | undefined): DraftFormat {
  const value = Array.isArray(param) ? param[0] : param
  if (value === 'auction' || value === 'snake') return value
  return MOCK_LEAGUE.draftFormat
}

/**
 * Draft room — snake or auction, chosen by `?format=`.
 *
 * TODO(live-draft): no league/draft backend exists. The league record and
 * draft state are fixtures from `components/draft/mock-draft.ts`; when the
 * draft service lands, resolve the league by `leagueId`, read its real
 * format, and hydrate the room from the live channel.
 */
export default async function DraftRoomPage({
  params,
  searchParams,
}: DraftRoomPageProps) {
  const { leagueId } = await params
  const { format } = await searchParams
  const draftFormat = parseFormat(format)

  return draftFormat === 'auction' ? (
    <AuctionDraftRoom
      leagueId={leagueId}
      league={MOCK_LEAGUE}
      initial={MOCK_AUCTION_DRAFT}
    />
  ) : (
    <SnakeDraftRoom
      leagueId={leagueId}
      league={MOCK_LEAGUE}
      initial={MOCK_SNAKE_DRAFT}
    />
  )
}
