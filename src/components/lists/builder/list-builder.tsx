'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { Loader2, MoreHorizontal, Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useToast } from '@/hooks/use-toast'
import {
  DEFAULT_SCORING_PRESET,
  SCORING_PRESETS,
  type ScoringPresetId,
} from '@/lib/scoring/default'
import { cn } from '@/lib/utils'

import { BuilderListPanel } from './builder-list-panel'
import { PlayerSidebar } from './player-sidebar'
import {
  LIST_POSITION_OPTIONS,
  type BuilderPlayer,
} from './types'

const SCORING_TO_KEY: Record<string, 'ppr' | 'standard' | 'half_ppr'> = {
  espn_ppr: 'ppr',
  yahoo_ppr: 'ppr',
  sleeper_ppr: 'ppr',
  espn_standard: 'standard',
  yahoo_standard: 'standard',
  sleeper_standard: 'standard',
  half_ppr: 'half_ppr',
  te_premium: 'ppr',
}

export function ListBuilder() {
  const router = useRouter()
  const { toast } = useToast()

  const [title, setTitle] = useState('Untitled')
  const [editingTitle, setEditingTitle] = useState(false)
  const [positionFilter, setPositionFilter] = useState<string>('')
  const [scoringPreset, setScoringPreset] = useState<ScoringPresetId>(
    DEFAULT_SCORING_PRESET,
  )
  const [isPrivate, setIsPrivate] = useState(false)
  const [commentsEnabled, setCommentsEnabled] = useState(true)
  const [added, setAdded] = useState<string[]>([])
  const [playerCache, setPlayerCache] = useState<Map<string, BuilderPlayer>>(
    new Map(),
  )
  const [saving, setSaving] = useState(false)

  // Maintain a cache of full player records for anything we add — the sidebar
  // hands them off as we go, so we don't need a second fetch on save.
  const cachePlayer = (player: BuilderPlayer) => {
    setPlayerCache((cur) => {
      if (cur.has(player.id)) return cur
      const next = new Map(cur)
      next.set(player.id, player)
      return next
    })
  }

  const addedPlayers = useMemo(
    () =>
      added
        .map((id) => playerCache.get(id))
        .filter((p): p is BuilderPlayer => Boolean(p)),
    [added, playerCache],
  )

  const addedSet = useMemo(() => new Set(added), [added])

  const handleAddPlayer = (player: BuilderPlayer) => {
    if (added.includes(player.id)) return
    cachePlayer(player)
    setAdded((cur) => [...cur, player.id])
  }

  const handleRemovePlayer = (playerId: string) => {
    setAdded((cur) => cur.filter((id) => id !== playerId))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return

    const fromSidebar =
      typeof active.id === 'string' && active.id.startsWith('sidebar:')

    if (fromSidebar) {
      // Only count drops onto the right panel or one of its sortable items.
      const overData = over.data.current as { kind?: string } | undefined
      const isOverDrop =
        over.id === 'builder-drop' ||
        overData?.kind === 'builder-drop' ||
        addedSet.has(String(over.id))
      if (!isOverDrop) return

      const player = (active.data.current as { player?: BuilderPlayer } | undefined)
        ?.player
      if (!player) return
      handleAddPlayer(player)
      return
    }

    // Reorder within the right panel
    if (active.id !== over.id && addedSet.has(String(active.id))) {
      const oldIdx = added.indexOf(String(active.id))
      const newIdx = added.indexOf(String(over.id))
      if (oldIdx >= 0 && newIdx >= 0) {
        setAdded(arrayMove(added, oldIdx, newIdx))
      }
    }
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      const finalTitle = title.trim() || 'Untitled'
      const createRes = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: finalTitle,
          position_filter: positionFilter || undefined,
          is_private: isPrivate || undefined,
          comments_enabled: commentsEnabled ? undefined : false,
        }),
      })
      const createBody = await createRes.json().catch(() => ({}))
      if (!createRes.ok) {
        throw new Error(createBody.error ?? `Create failed (${createRes.status})`)
      }
      const newList = createBody as { id: string; title: string }

      if (added.length > 0) {
        const bulkRes = await fetch(`/api/lists/${newList.id}/players/bulk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ player_ids: added }),
        })
        const bulkBody = await bulkRes.json().catch(() => ({}))
        if (!bulkRes.ok) {
          throw new Error(bulkBody.error ?? `Add players failed (${bulkRes.status})`)
        }
      }

      toast({ title: 'List created', description: newList.title })
      router.push(`/app/lists/${newList.id}`)
    } catch (err) {
      toast({
        title: 'Could not save list',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
      setSaving(false)
    }
  }

  const scoringKey = SCORING_TO_KEY[scoringPreset] ?? 'ppr'

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-[calc(100vh-3.5rem-2rem)] flex-col gap-3 lg:h-[calc(100vh-3.5rem-3rem)]">
        <BuilderHeader
          title={title}
          onTitleChange={setTitle}
          editing={editingTitle}
          onEditingChange={setEditingTitle}
          saving={saving}
          onSave={handleSave}
          positionFilter={positionFilter}
          onPositionFilterChange={setPositionFilter}
          scoringPreset={scoringPreset}
          onScoringPresetChange={setScoringPreset}
          isPrivate={isPrivate}
          onPrivateChange={setIsPrivate}
          commentsEnabled={commentsEnabled}
          onCommentsEnabledChange={setCommentsEnabled}
          playerCount={added.length}
        />

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-hidden rounded-lg">
            <PlayerSidebar
              scoring={scoringKey}
              added={addedSet}
              onAddPlayer={handleAddPlayer}
            />
          </div>

          <div className="min-h-0">
            <BuilderListPanel
              players={addedPlayers}
              onRemove={handleRemovePlayer}
            />
          </div>
        </div>
      </div>
    </DndContext>
  )
}

interface BuilderHeaderProps {
  title: string
  onTitleChange: (next: string) => void
  editing: boolean
  onEditingChange: (next: boolean) => void
  saving: boolean
  onSave: () => void
  positionFilter: string
  onPositionFilterChange: (next: string) => void
  scoringPreset: ScoringPresetId
  onScoringPresetChange: (next: ScoringPresetId) => void
  isPrivate: boolean
  onPrivateChange: (next: boolean) => void
  commentsEnabled: boolean
  onCommentsEnabledChange: (next: boolean) => void
  playerCount: number
}

function BuilderHeader({
  title,
  onTitleChange,
  editing,
  onEditingChange,
  saving,
  onSave,
  positionFilter,
  onPositionFilterChange,
  scoringPreset,
  onScoringPresetChange,
  isPrivate,
  onPrivateChange,
  commentsEnabled,
  onCommentsEnabledChange,
  playerCount,
}: BuilderHeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  return (
    <header className="flex items-center justify-between gap-3 border-b border-bg-elevated-2 pb-3">
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={() => onEditingChange(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onEditingChange(false)
              } else if (e.key === 'Escape') {
                onEditingChange(false)
              }
            }}
            maxLength={100}
            className="w-full max-w-2xl rounded-md border border-bg-elevated-3 bg-bg-elevated-3 px-2 py-1 text-2xl font-bold text-foreground outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => onEditingChange(true)}
            className={cn(
              'rounded-md px-1 py-0.5 text-left text-2xl font-bold transition-colors hover:bg-bg-elevated-2',
              title === 'Untitled' && 'text-text-secondary',
            )}
          >
            {title || 'Untitled'}
          </button>
        )}
        <p className="mt-0.5 px-1 text-xs text-text-tertiary">
          {playerCount} player{playerCount === 1 ? '' : 's'} added
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="List options"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-bg-elevated-2 bg-bg-elevated text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 border-bg-elevated-2 bg-bg-elevated p-3"
          >
            <div className="space-y-4">
              <Field label="Position group">
                <select
                  value={positionFilter}
                  onChange={(e) => onPositionFilterChange(e.target.value)}
                  className="h-8 w-full rounded-md border border-bg-elevated-2 bg-bg-elevated-3 px-2 text-xs text-foreground focus:border-foreground focus:outline-none"
                >
                  {LIST_POSITION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Scoring system">
                <select
                  value={scoringPreset}
                  onChange={(e) =>
                    onScoringPresetChange(e.target.value as ScoringPresetId)
                  }
                  className="h-8 w-full rounded-md border border-bg-elevated-2 bg-bg-elevated-3 px-2 text-xs text-foreground focus:border-foreground focus:outline-none"
                >
                  {SCORING_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-text-tertiary">
                  Affects projected/season fantasy points in the player list.
                </p>
              </Field>

              <div className="space-y-2 border-t border-bg-elevated-2 pt-3">
                <ToggleRow
                  label="Private"
                  description="Only you can see this list."
                  checked={isPrivate}
                  onChange={onPrivateChange}
                />
                <ToggleRow
                  label="Comments"
                  description="Let viewers comment."
                  checked={commentsEnabled}
                  onChange={onCommentsEnabledChange}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          variant="brand"
          onClick={onSave}
          disabled={saving}
          className="rounded-full font-semibold"
        >
          {saving ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save className="mr-1 h-4 w-4" /> Save
            </>
          )}
        </Button>
      </div>
    </header>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
        {label}
      </label>
      {children}
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded text-left text-xs"
    >
      <div className="min-w-0">
        <p className="text-foreground">{label}</p>
        {description && (
          <p className="text-[10px] text-text-secondary">{description}</p>
        )}
      </div>
      <span
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-foreground' : 'bg-bg-elevated-3',
        )}
      >
        <span
          className={cn(
            'absolute h-4 w-4 rounded-full transition-all',
            checked
              ? 'translate-x-4 bg-background'
              : 'translate-x-0.5 bg-foreground',
          )}
        />
      </span>
    </button>
  )
}
