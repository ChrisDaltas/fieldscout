'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { Plus } from 'lucide-react'

import { GenerateAiButton } from '@/components/lists/generate-ai-button'
import { MyListsTab } from '@/components/lists/my-lists-tab'
import { SideBySideTab } from '@/components/lists/side-by-side-tab'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'

type ListTab = 'all' | 'pinned'

export default function ListsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sideBySide = searchParams.get('view') === 'side-by-side'
  const tabParam = searchParams.get('tab')
  // 'favorite' is the legacy param value from before the pin rename.
  const tab: ListTab =
    tabParam === 'pinned' || tabParam === 'favorite' ? 'pinned' : 'all'
  const openCreateList = useUIStore((s) => s.setCreateListOpen)

  const setSideBySide = useCallback(
    (next: boolean) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next) params.set('view', 'side-by-side')
      else params.delete('view')
      const qs = params.toString()
      router.replace(qs ? `/app/lists?${qs}` : '/app/lists', { scroll: false })
    },
    [router, searchParams],
  )

  const setTab = useCallback(
    (next: ListTab) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === 'all') params.delete('tab')
      else params.set('tab', next)
      const qs = params.toString()
      router.replace(qs ? `/app/lists?${qs}` : '/app/lists', { scroll: false })
    },
    [router, searchParams],
  )

  return (
    <div className="space-y-6">
      <header className="grid grid-cols-3 items-center gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Lists</h1>
          <SideBySideToggle on={sideBySide} onChange={setSideBySide} />
        </div>
        <div className="justify-self-center">
          <PillTabs
            value={tab}
            onChange={setTab}
            options={[
              { value: 'all', label: 'All' },
              { value: 'pinned', label: 'Pinned' },
            ]}
          />
        </div>
        <div className="flex items-center gap-2 justify-self-end">
          <GenerateAiButton className="font-semibold" />
          <Button
            className="font-semibold"
            onClick={() => openCreateList(true)}
          >
            <Plus className="mr-1 h-4 w-4" /> New List
          </Button>
        </div>
      </header>

      {sideBySide ? (
        <SideBySideTab />
      ) : (
        <MyListsTab onlyFavorites={tab === 'pinned'} />
      )}
    </div>
  )
}

interface PillTabsProps<T extends string> {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: string }[]
}

function PillTabs<T extends string>({
  value,
  onChange,
  options,
}: PillTabsProps<T>) {
  return (
    <div
      role="tablist"
      className="inline-flex h-9 items-center gap-1 rounded-full border border-bg-elevated-2 bg-bg-elevated p-1"
    >
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-full px-4 py-1 text-sm font-semibold transition-colors',
              active
                ? 'bg-foreground text-background'
                : 'text-text-secondary hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function SideBySideToggle({
  on,
  onChange,
}: {
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className="flex items-center gap-2 text-sm text-text-secondary"
    >
      <span
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          on ? 'bg-foreground' : 'bg-bg-elevated-3',
        )}
      >
        <span
          className={cn(
            'absolute h-4 w-4 rounded-full transition-transform',
            on ? 'translate-x-4 bg-background' : 'translate-x-0.5 bg-foreground',
          )}
        />
      </span>
      <span className={cn('font-medium', on && 'text-foreground')}>
        Side by Side
      </span>
    </button>
  )
}
