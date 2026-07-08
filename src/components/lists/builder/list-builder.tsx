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

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
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
      <div className="flex h-[calc(100dvh-4rem-2.5rem)] flex-col gap-3 lg:h-[calc(100dvh-58px-2.5rem)]">
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
          <div className="min-h-0 overflow-hidden">
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

/** Radix Select forbids empty-string item values — sentinel for "all". */
const ALL_POSITIONS = 'all'

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
    <header className="flex items-center justify-between gap-3 border-b border-ink pb-3">
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
            className="w-full max-w-2xl rounded-sm border border-ink bg-white px-2 py-1 text-h4 text-ink outline-none transition-colors focus:border-accent"
          />
        ) : (
          <button
            type="button"
            onClick={() => onEditingChange(true)}
            className={cn(
              'rounded-sm px-1 py-0.5 text-left text-h4 transition-colors hover:bg-n-4',
              title === 'Untitled' ? 'text-n-3' : 'text-ink',
            )}
          >
            {title || 'Untitled'}
          </button>
        )}
        <p className="fs-num mt-0.5 px-1 text-[11px] font-semibold text-n-3">
          {playerCount} player{playerCount === 1 ? '' : 's'} added
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="stroke" size="icon-md" aria-label="List options">
              <Icon name="dots" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3">
            <div className="space-y-4">
              <Field label="Position group">
                <Select
                  value={positionFilter || ALL_POSITIONS}
                  onValueChange={(v) =>
                    onPositionFilterChange(v === ALL_POSITIONS ? '' : v)
                  }
                >
                  <SelectTrigger
                    aria-label="Position group"
                    className="h-btn-md px-2.5 text-[12px] font-bold"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIST_POSITION_OPTIONS.map((opt) => (
                      <SelectItem
                        key={opt.value || ALL_POSITIONS}
                        value={opt.value || ALL_POSITIONS}
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Scoring system">
                <Select
                  value={scoringPreset}
                  onValueChange={(v) =>
                    onScoringPresetChange(v as ScoringPresetId)
                  }
                >
                  <SelectTrigger
                    aria-label="Scoring system"
                    className="h-btn-md px-2.5 text-[12px] font-bold"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCORING_PRESETS.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] font-medium text-n-3">
                  Affects projected and season fantasy points in the player
                  list.
                </p>
              </Field>

              <div className="space-y-1 border-t border-n-4 pt-3">
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

        <Button variant="blue" size="md" shadow onClick={onSave} disabled={saving}>
          {saving ? (
            <>
              <Icon name="save" className="animate-pulse" /> Saving…
            </>
          ) : (
            <>
              <Icon name="save" /> Save
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
      <label className="block text-[12px] font-bold text-ink">{label}</label>
      {children}
    </div>
  )
}

/** Switch row for the list-options popover — lime-on switch per the control
 *  recipes (these are on/off settings, not selections). */
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
    <label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-1 py-1 transition-colors hover:bg-n-4/60">
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-ink">{label}</span>
        {description && (
          <span className="block text-[10px] font-medium text-n-3">
            {description}
          </span>
        )}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}
