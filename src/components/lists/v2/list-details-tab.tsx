'use client'

import * as React from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ListWithDetails } from '@/hooks/use-lists'
import { MAX_TAGS_PER_LIST } from '@/types/schemas/lists'

/**
 * Lists v2 — the **Details** tab (`screens/detail-tab-details.png`).
 *
 * Four sections: tags (fixed chips + the owner's own, each removable, plus
 * `+ Add tag`), description with an inline `Edit`, **Attached links**, and the
 * position mix.
 *
 * ## Two honest gaps, both visible on this tab
 *
 * 1. **Scope is not a chip here.** The reference's fixed chips read
 *    `Ranking · Pre-draft · Public`. `lists` has no scope column and the
 *    build's schema budget is closed (plan §1/D6 — plan §2.2 already lists
 *    scope as dropped), so the second chip is the list's **visibility**, which
 *    is real data. Two chips, not three.
 * 2. **Attached links cannot be stored.** The section renders, because
 *    `screens/README.md` corrected the plan to put it back in scope — but
 *    `lists` has no `links` column and there is no table for one, so nothing
 *    can be attached. The action is disabled and says why rather than opening
 *    a dialog that would throw the link away on submit. Storing links needs a
 *    ruling and a schema exception this build does not hold.
 *
 * Tags render **as stored**, not upper-cased. The prototype styles them
 * `text-transform: uppercase`; the design's own copy rule is "never all caps —
 * only genuine codes stay capitalized", and a user-typed tag is not a code.
 */

interface DetailsTabProps {
  list: ListWithDetails
  canEdit: boolean
  onSaveDescription: (description: string) => void
  onSaveTags: (tags: string[]) => void
}

export function ListDetailsTab({
  list,
  canEdit,
  onSaveDescription,
  onSaveTags,
}: DetailsTabProps) {
  const positionMix = React.useMemo(() => {
    const mix = new Map<string, number>()
    for (const entry of list.players) {
      const position = entry.player.position ?? '—'
      mix.set(position, (mix.get(position) ?? 0) + 1)
    }
    return [...mix.entries()].sort((a, b) => b[1] - a[1])
  }, [list.players])

  return (
    <div className="flex max-w-[608px] flex-col gap-5">
      <TagsSection list={list} canEdit={canEdit} onSaveTags={onSaveTags} />
      <DescriptionSection list={list} canEdit={canEdit} onSave={onSaveDescription} />
      <LinksSection canEdit={canEdit} />

      <section>
        <SectionLabel>Position mix</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {positionMix.length === 0 && (
            <p className="text-[11px] font-medium text-n-3">No players on this list yet.</p>
          )}
          {positionMix.map(([position, count]) => (
            <span
              key={position}
              className="inline-flex items-center gap-1.5 rounded-sm border border-ink px-2 py-1"
            >
              <PositionBadge position={position} />
              <span className="fs-num text-[11px] font-bold">{count}</span>
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-bold text-ink">{children}</div>
}

function TagsSection({
  list,
  canEdit,
  onSaveTags,
}: {
  list: ListWithDetails
  canEdit: boolean
  onSaveTags: (tags: string[]) => void
}) {
  const [adding, setAdding] = React.useState(false)
  const [value, setValue] = React.useState('')

  const names = list.tags.map((tag) => tag.name)
  const kind = list.ranking_mode === 'unranked' ? 'List' : 'Ranking'
  const visibility = list.is_private ? 'Private' : 'Public'

  const commit = () => {
    const next = value.trim().replace(/^#/, '')
    if (next && !names.includes(next) && names.length < MAX_TAGS_PER_LIST) {
      onSaveTags([...names, next])
    }
    setValue('')
    setAdding(false)
  }

  return (
    <section>
      <SectionLabel>Tags</SectionLabel>
      <div className="flex flex-wrap items-center gap-1.5">
        {[kind, visibility].map((fixed) => (
          <span
            key={fixed}
            title="Set in list options"
            className="inline-flex h-[19px] items-center rounded-sm border border-n-4 bg-n-4 px-2 text-[9.5px] font-medium text-n-3"
          >
            {fixed}
          </span>
        ))}
        {list.tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex h-[19px] items-center gap-1 rounded-sm border border-ink bg-accent-soft pl-2 pr-1 text-[9.5px] font-medium"
          >
            {tag.name}
            {canEdit && (
              <button
                type="button"
                title={`Remove ${tag.name}`}
                onClick={() => onSaveTags(names.filter((name) => name !== tag.name))}
                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm transition-colors hover:bg-white"
              >
                <Icon name="close" size={9} />
              </button>
            )}
          </span>
        ))}
        {canEdit &&
          (adding ? (
            <Input
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit()
                if (event.key === 'Escape') {
                  setValue('')
                  setAdding(false)
                }
              }}
              placeholder="tag name"
              aria-label="New tag"
              className="h-[19px] w-[104px] px-2 text-[10px]"
            />
          ) : (
            <button
              type="button"
              disabled={names.length >= MAX_TAGS_PER_LIST}
              onClick={() => setAdding(true)}
              title={
                names.length >= MAX_TAGS_PER_LIST
                  ? `A list carries at most ${MAX_TAGS_PER_LIST} tags`
                  : undefined
              }
              className="inline-flex h-[19px] items-center gap-1 rounded-sm border border-dashed border-n-3 px-2 text-[9.5px] font-medium text-n-3 transition-colors hover:border-ink hover:text-ink disabled:opacity-45 disabled:hover:border-n-3 disabled:hover:text-n-3"
            >
              <Icon name="plus" size={9} />
              Add tag
            </button>
          ))}
      </div>
    </section>
  )
}

function DescriptionSection({
  list,
  canEdit,
  onSave,
}: {
  list: ListWithDetails
  canEdit: boolean
  onSave: (description: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(list.description ?? '')

  React.useEffect(() => {
    setDraft(list.description ?? '')
    setEditing(false)
  }, [list.id, list.description])

  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="mr-auto text-[11px] font-bold text-ink">Description</span>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] font-medium text-accent transition-colors hover:text-accent-strong"
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            autoFocus
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What is this list for? What rule decides who makes it?"
            aria-label="List description"
            className="w-full rounded-sm border border-ink bg-white p-2 text-[12px] font-medium leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-accent"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              variant="stroke"
              size="sm"
              onClick={() => {
                setDraft(list.description ?? '')
                setEditing(false)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="blue"
              size="sm"
              onClick={() => {
                onSave(draft.trim())
                setEditing(false)
              }}
            >
              Save
            </Button>
          </div>
        </>
      ) : (
        <p
          className={cn(
            'text-[12px] font-medium leading-relaxed',
            list.description ? 'text-ink' : 'text-n-3',
          )}
        >
          {list.description ||
            (canEdit ? 'No description yet. Edit to say what this list is for.' : 'No description.')}
        </p>
      )}
    </section>
  )
}

function LinksSection({ canEdit }: { canEdit: boolean }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="mr-auto text-[11px] font-bold text-ink">Attached links</span>
        {canEdit && (
          <button
            type="button"
            disabled
            title="Attachments have nowhere to be stored yet — see the Details tab notes."
            className="text-[10px] font-medium text-accent opacity-45"
          >
            Attach a video or article
          </button>
        )}
      </div>
      <p className="text-[12px] font-medium leading-relaxed text-n-3">
        Nothing attached. A film breakdown or an article gives readers the reasoning behind the
        order — attachments are not stored yet.
      </p>
    </section>
  )
}
