'use client'

import { PlayerShelves } from '@/components/home/player-shelves'
import { RecentlyViewed } from '@/components/home/recently-viewed'

export default function AppHomePage() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold">Home</h1>
      </header>

      <RecentlyViewed />
      <PlayerShelves />
    </div>
  )
}
