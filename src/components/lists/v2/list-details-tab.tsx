'use client'

import * as React from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { AddLinkInput, ListWithDetails } from '@/hooks/use-lists'
import { MAX_TAGS_PER_LIST } from '@/types/schemas/lists'

/**
 * Lists v2 — the **Details** tab (`screens/detail-tab-details.png`).
 *
 * Four sections: tags (fixed chips + the owner's own, each removable, plus
 * `+ Add tag`), description with an inline `Edit`, **Attached links**, and the
 * position mix.
 *
 * ## One honest gap left on this tab
 *
 * **Scope is not a chip here.** The reference's fixed chips read
 * `Ranking · Pre-draft · Public`. `lists` has no scope column (plan §2.2 lists
 * scope as dropped), so the second chip is the list's **visibility**, which is
 * real data. Two chips, not three.
 *
 * *(The tab's second gap — "attached links cannot be stored" — is **closed**.
 * Chris ruled on 2026-08-11: "lets create the table for storing the link, we
 * need a way to link back to resources used and a way for creators to attached
 * videos to their lists." Migration `080_list_links.sql` is the build's third
 * and final schema exception; the action below is live.)*
 *
 * Tags render **as stored**, not upper-cased. The prototype styles them
 * `text-transform: uppercase`; the design's own copy rule is "never all caps —
 * only genuine codes stay capitalized", and a user-typed tag is not a code.
 */

interface DetailsTabProps {
  list: ListWithDetails
  canEdit: boolean
  /**
   * The four write gestures — **all optional**, because the public share view
   * (LV.6) mounts this tab read-only: tags, description, links and the position
   * mix all render, and nothing on it can be changed. Each affordance is gated
   * on `canEdit` *and* on its handler being present, so omitting a handler is
   * itself the subtraction rather than a no-op that would let a later edit
   * re-expose the control.
   */
  onSaveDescription?: (description: string) => void
  onSaveTags?: (tags: string[]) => void
  onAddLink?: (input: AddLinkInput) => void
  onRemoveLink?: (linkId: string) => void
  linksBusy?: boolean
}

export function ListDetailsTab({
  list,
  canEdit,
  onSaveDescription,
  onSaveTags,
  onAddLink,
  onRemoveLink,
  linksBusy = false,
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
      <LinksSection
        list={list}
        canEdit={canEdit}
        onAdd={onAddLink}
        onRemove={onRemoveLink}
        busy={linksBusy}
      />

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
  onSaveTags?: (tags: string[]) => void
}) {
  const [adding, setAdding] = React.useState(false)
  const [value, setValue] = React.useState('')

  const editable = canEdit && Boolean(onSaveTags)
  const names = list.tags.map((tag) => tag.name)
  const kind = list.ranking_mode === 'unranked' ? 'List' : 'Ranking'
  const visibility = list.is_private ? 'Private' : 'Public'

  const commit = () => {
    const next = value.trim().replace(/^#/, '')
    if (next && !names.includes(next) && names.length < MAX_TAGS_PER_LIST) {
      onSaveTags?.([...names, next])
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
            {editable && (
              <button
                type="button"
                title={`Remove ${tag.name}`}
                onClick={() => onSaveTags?.(names.filter((name) => name !== tag.name))}
                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm transition-colors hover:bg-white"
              >
                <Icon name="close" size={9} />
              </button>
            )}
          </span>
        ))}
        {editable &&
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
  onSave?: (description: string) => void
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
        {canEdit && onSave && !editing && (
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
                onSave?.(draft.trim())
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

/**
 * **Attached links** (migration 080). Ruled by Chris 2026-08-11: attribution
 * back to the resources a list drew on, plus a creator's own video.
 *
 * ## What the reference fixes, and what it leaves to us
 *
 * `screens/detail-tab-details.png` shows the card exactly: a solid colour block
 * on the left, the title in bold, a muted `source · duration` line beneath it,
 * and a bare `×` on the right, inside a 1px ink-bordered box. All of that is
 * implemented as drawn.
 *
 * It shows **one** card, a video, and no form — so three things are extended
 * per CLAUDE.md's "where the prototype is silent, extend the new design
 * language", and named here rather than passed off as the design:
 *
 * 1. **The block is a placeholder, not a poster.** There is no scraping in this
 *    codebase (CLAUDE.md), so we have no thumbnail image to show and nothing
 *    auto-fills the title or duration. The block therefore carries a glyph, the
 *    way `ListCoverTile` does: `arrow-next` for a video (the reference's own
 *    `›`), `document` for an article.
 * 2. **Colour comes from tokens, never the handoff's hex** (plan §1). The
 *    reference's rose reads closest to `negative`, which the token file
 *    reserves for football semantics ("never identity") — so video takes the
 *    warm ramp's `tier-2` at 50% and an article takes `tier-4`, both with ink
 *    glyphs. Same warmth, no borrowed meaning.
 * 3. **The attach form is inline, not a modal.** This tab already edits in
 *    place — Description's `Edit`, Tags' `+ Add tag` — and the design shows no
 *    dialog anywhere on it.
 *
 * There is **no reorder affordance**, deliberately: the reference shows none,
 * and `PATCH /api/lists/[id]/links` waits for LV.4 to give it a gesture.
 *
 * ## The href is the security-shaped part
 *
 * A link renders on the PUBLIC, server-rendered share view (plan D7), so the
 * URL is validated in `links-service.ts` and again by 080's CHECK — `http`/
 * `https` only. `rel` carries `ugc nofollow noopener noreferrer`: `ugc
 * nofollow` because these are reader-supplied outbound links on an
 * SEO-critical page, `noopener noreferrer` because `target="_blank"` otherwise
 * hands the opened page a handle on ours.
 */
function LinksSection({
  list,
  canEdit,
  onAdd,
  onRemove,
  busy,
}: {
  list: ListWithDetails
  canEdit: boolean
  onAdd?: (input: AddLinkInput) => void
  onRemove?: (linkId: string) => void
  busy: boolean
}) {
  const [attaching, setAttaching] = React.useState(false)

  React.useEffect(() => {
    setAttaching(false)
  }, [list.id])

  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="mr-auto text-[11px] font-bold text-ink">Attached links</span>
        {canEdit && onAdd && !attaching && (
          <button
            type="button"
            onClick={() => setAttaching(true)}
            className="text-[10px] font-medium text-accent transition-colors hover:text-accent-strong"
          >
            Attach a video or article
          </button>
        )}
      </div>

      {list.links.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {list.links.map((link) => (
            <li key={link.id} className="flex items-center gap-2.5 border border-ink bg-white p-2">
              <span
                aria-hidden="true"
                className={cn(
                  'inline-flex h-[37px] w-[50px] shrink-0 items-center justify-center rounded-sm border border-ink',
                  link.kind === 'video' ? 'bg-tier-2/50' : 'bg-tier-4/50',
                )}
              >
                <Icon name={link.kind === 'video' ? 'arrow-next' : 'document'} size={13} />
              </span>

              <span className="flex min-w-0 flex-col gap-0.5">
                <a
                  href={link.url}
                  target="_blank"
                  rel="ugc nofollow noopener noreferrer"
                  className="truncate text-[12px] font-bold text-ink underline-offset-2 hover:underline"
                >
                  {link.title}
                </a>
                <span className="truncate text-[10px] font-medium text-n-3">
                  {[link.source_label, link.duration_label].filter(Boolean).join(' · ') || link.url}
                </span>
              </span>

              {canEdit && onRemove && (
                <button
                  type="button"
                  disabled={busy}
                  title={`Remove “${link.title}”`}
                  aria-label={`Remove ${link.title}`}
                  onClick={() => onRemove(link.id)}
                  className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-n-4 disabled:opacity-45"
                >
                  <Icon name="close" size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {list.links.length === 0 && !attaching && (
        <p className="text-[12px] font-medium leading-relaxed text-n-3">
          {canEdit
            ? 'Nothing attached yet. A film breakdown or an article gives readers the reasoning behind the order.'
            : 'Nothing attached to this list.'}
        </p>
      )}

      {attaching && (
        <AttachLinkForm
          busy={busy}
          onCancel={() => setAttaching(false)}
          onSubmit={(input) => {
            onAdd?.(input)
            setAttaching(false)
          }}
        />
      )}
    </section>
  )
}

/**
 * The inline attach form. Kind is a two-way segmented choice because 080's
 * `kind` is a closed set of exactly those two values; URL and title are
 * required (both are NOT NULL); source and duration are optional, because with
 * nothing scraping them a card with a bare title is a legitimate card.
 *
 * The duration placeholder shows the shape the CHECK accepts (`18:42`) rather
 * than describing it — a wrong format is refused by the server with a specific
 * message, never silently dropped.
 */
function AttachLinkForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  onCancel: () => void
  onSubmit: (input: AddLinkInput) => void
}) {
  const [kind, setKind] = React.useState<'video' | 'article'>('video')
  const [url, setUrl] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [source, setSource] = React.useState('')
  const [duration, setDuration] = React.useState('')

  const ready = url.trim().length > 0 && title.trim().length > 0

  return (
    <form
      className="mt-1.5 flex flex-col gap-2 border border-ink bg-white p-2.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        onSubmit({
          kind,
          url: url.trim(),
          title: title.trim(),
          source_label: source.trim() || null,
          duration_label: duration.trim() || null,
        })
      }}
    >
      {/* The **label-only** variation of the shared control (`ui/tabs.tsx`).
          Two mutually-exclusive kinds, so a `Segment` rather than the pair of
          hand-rolled chips this replaced — those carried their own copy of the
          accent-active treatment. Sentence case, per the design LAW's copy
          rule; the previous `capitalize` was doing the same job by CSS. */}
      <Segment aria-label="Link kind">
        <SegmentItem active={kind === 'video'} onClick={() => setKind('video')}>
          Video
        </SegmentItem>
        <SegmentItem active={kind === 'article'} onClick={() => setKind('article')}>
          Article
        </SegmentItem>
      </Segment>

      <Input
        autoFocus
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://youtube.com/watch?v=…"
        aria-label="Link address"
        className="h-[24px] text-[11px]"
      />
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title — what is this?"
        aria-label="Link title"
        className="h-[24px] text-[11px]"
      />
      <div className="flex gap-2">
        <Input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="Source (optional) — Field Scout on YouTube"
          aria-label="Link source"
          className="h-[24px] flex-1 text-[11px]"
        />
        <Input
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          placeholder="18:42"
          aria-label="Link duration"
          className="h-[24px] w-[74px] text-[11px]"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="stroke" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="blue" size="sm" disabled={!ready || busy}>
          Attach
        </Button>
      </div>
    </form>
  )
}
