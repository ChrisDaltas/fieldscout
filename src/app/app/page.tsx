'use client'

import { AiExpertShelf } from '@/components/home/ai-expert-shelf'
import { PlayerShelves } from '@/components/home/player-shelves'
import { RecentlyViewed } from '@/components/home/recently-viewed'

export default function AppHomePage() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold">Home</h1>
      </header>

      <RecentlyViewed />
      <AiExpertShelf />
      <PlayerShelves />
    </div>
  )
}
