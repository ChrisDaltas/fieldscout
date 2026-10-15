'use client'

import * as React from 'react'

import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { UsernameLink } from '@/components/shared/username-link'
import { useFolders } from '@/hooks/use-folders'
import { useLists, type ListWithTags } from '@/hooks/use-lists'
import { useMobileListsVideoFlags } from '@/hooks/use-mobile-lists-video-flags'
import { cn } from '@/lib/utils'

import { AiCreateSheet } from './ai-create-sheet'
import { FolderNameSheet } from './folder-sheets'
import { playersLabel, updatedLabel } from './lists-model'
import { useListsNav } from './lists-nav'
import { CenterNote, CoverCollage, CoverImage, LIcon, PillButton, coverClass } from './lists-parts'

/**
 * FieldScout Mobile — the Lists grid (lr-lists §2.1, states L1/L2): root
 * header, "Lists" title, My lists / Saved tabs, a two-column grid of square
 * covers with the "New list" tile first.
 *
 * Kept from the app, which the design lacks: "Create with AI" (a second tile
 * in the New list style, CLAUDE.md → never drop AI list generation), folders
 * (a chip row over My lists once you have folders), and the loading / error /
 * offline / empty states.
 */
export function ListsGrid({ tab }: { tab: 'mine' | 'saved' }) {
  const nav = useListsNav()
  const lists = useLists(1, 50)
  const folders = useFolders()
  // The cover's "Video" badge. It is a decoration: while the read is out (or
  // if it fails) cards simply carry no badge.
  const videoFlags = useMobileListsVideoFlags((lists.data?.lists ?? []).map((list) => list.id))
  const [folderId, setFolderId] = React.useState<string | null>(null)
  const [aiOpen, setAiOpen] = React.useState(false)
  const [editFolder, setEditFolder] = React.useState(false)

  const { mine, saved } = React.useMemo(() => {
    const all = lists.data?.lists ?? []
    const own = all.filter((list) => !list.owner)
    // Favorites is permanent and always leads (desktop rule, lists-page-v2).
    own.sort((a, b) => Number(Boolean(b.is_favorites)) - Number(Boolean(a.is_favorites)))
    return { mine: own, saved: all.filter((list) => Boolean(list.owner)) }
  }, [lists.data?.lists])

  const folderList = folders.data ?? []
  const openFolder = folderId ? (folderList.find((f) => f.id === folderId) ?? null) : null
  const visible = tab === 'mine' ? (openFolder ? mine.filter((l) => l.folder_id === openFolder.id) : mine) : saved

  const paused = lists.fetchStatus === 'paused' && !lists.isSuccess

  return (
    <MobileScreen
      className="leading-[normal] tabular-nums"
      header={
        <div className="flex items-center gap-2.5 px-4 pt-0.5">
          <button
            type="button"
            onClick={nav.leaveLists}
            aria-label="Back"
            className="flex size-[34px] flex-none items-center justify-center rounded-full bg-m-b2 text-m-t1 active:bg-m-b2h"
          >
            <MIcon name="back" size={16} stroke={2} />
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={nav.openNew}
            title="Create"
            aria-label="New list"
            className="flex size-[34px] flex-none items-center justify-center rounded-full bg-accent text-white active:bg-accent-strong"
          >
            <LIcon name="plus" size={15} stroke={2.4} />
          </button>
        </div>
      }
    >
      <div className="px-4 pt-3">
        <h1 className="text-[26px] font-bold leading-[normal] tracking-[-0.03em] text-m-t1">Lists</h1>
      </div>
      <div className="mt-1.5 flex gap-[18px] border-b border-m-b3 px-4">
        {(
          [
            { id: 'mine', label: 'My lists' },
            { id: 'saved', label: 'Saved' },
          ] as const
        ).map((item) => {
          const on = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              onClick={() => nav.setTab(item.id)}
              className={cn(
                'relative flex h-[38px] flex-none items-center text-[14px] font-semibold',
                on ? 'text-m-t1' : 'text-m-t3',
              )}
            >
              {item.label}
              {on && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-m-ink" />}
            </button>
          )
        })}
      </div>

      {tab === 'mine' && folderList.length > 0 && !lists.isError && !paused && (
        <div className="flex gap-1.5 overflow-x-auto px-4 pt-3.5 scrollbar-none" aria-label="Folders">
          <Chip on={!openFolder} onClick={() => setFolderId(null)}>
            All lists
          </Chip>
          {folderList.map((folder) => (
            <Chip key={folder.id} on={openFolder?.id === folder.id} onClick={() => setFolderId(folder.id)}>
              <LIcon name="folder" size={12} stroke={1.6} />
              {folder.name}
            </Chip>
          ))}
          {openFolder && (
            <button
              type="button"
              onClick={() => setEditFolder(true)}
              className="flex h-[30px] flex-none items-center gap-1 whitespace-nowrap rounded-pill border-[1.5px] border-m-b4 px-3 text-[12px] font-semibold text-m-t1 active:bg-m-b2"
            >
              <LIcon name="edit" size={11} stroke={1.8} />
              Edit folder
            </button>
          )}
        </div>
      )}

      {lists.isError || paused ? (
        <CenterNote
          title="Your lists could not be loaded."
          body={
            paused
              ? 'Your lists have not loaded because the browser reports no network connection.'
              : lists.error?.message
          }
          action={<PillButton onClick={() => void lists.refetch()}>Try again</PillButton>}
        />
      ) : !lists.isSuccess ? (
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3.5 px-4 pb-6 pt-3.5" aria-busy="true" aria-label="Loading lists">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="aspect-square animate-pulse rounded-[14px] bg-m-b1" />
              <div className="h-3 w-3/4 animate-pulse rounded-md bg-m-b1" />
              <div className="h-2.5 w-1/2 animate-pulse rounded-md bg-m-b1" />
            </div>
          ))}
        </div>
      ) : tab === 'saved' && visible.length === 0 ? (
        <CenterNote title="Nothing saved yet" body="Lists you save from other people show up here." />
      ) : (
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3.5 px-4 pb-6 pt-3.5">
          {tab === 'mine' && (
            <>
              <NewTile label="New list" onClick={nav.openNew} icon={<LIcon name="plus" size={16} stroke={2.4} />} />
              <NewTile
                label="Create with AI"
                onClick={() => setAiOpen(true)}
                icon={<LIcon name="sparkle" size={17} stroke={1.6} />}
              />
            </>
          )}
          {visible.map((list) => (
            <ListCard
              key={list.id}
              list={list}
              hasVideo={videoFlags.data?.has(list.id) ?? false}
              onOpen={() => nav.openList(list.id)}
            />
          ))}
        </div>
      )}

      <AiCreateSheet open={aiOpen} onOpenChange={setAiOpen} />
      {openFolder && (
        <FolderNameSheet
          open={editFolder}
          onOpenChange={setEditFolder}
          folder={openFolder}
          onDeleted={() => setFolderId(null)}
        />
      )}
    </MobileScreen>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex h-[30px] flex-none items-center gap-1 whitespace-nowrap rounded-pill px-3 text-[12px] font-semibold',
        on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1 active:bg-m-b2h',
      )}
    >
      {children}
    </button>
  )
}

/** The "New list" tile (lr-lists §2.1): square, 1.5px b4 outline, blue. */
function NewTile({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex aspect-square flex-col items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-m-b4 text-accent active:bg-m-b1"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-m-gb">{icon}</span>
      <span className="text-[13px] font-semibold">{label}</span>
    </button>
  )
}

function ListCard({ list, hasVideo, onOpen }: { list: ListWithTags; hasVideo: boolean; onOpen: () => void }) {
  const count = list.player_count ?? 0
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-col gap-1.5 text-left">
        <span className={cn('relative block aspect-square w-full overflow-hidden rounded-[14px]', coverClass(list))}>
          {list.thumbnail_url ? (
            <CoverImage src={list.thumbnail_url} />
          ) : (
            <CoverCollage players={list.first_players ?? []} size={46} />
          )}
          {hasVideo && <VideoBadge />}
        </span>
        <span className="text-[13px] font-semibold leading-[1.25] text-m-t1 [text-wrap:pretty]">{list.title}</span>
      </button>
      <p className="text-[11px] font-medium text-m-t3">
        {playersLabel(count)} ·{' '}
        {list.owner ? (
          <UsernameLink username={list.owner.username} className="text-m-t3" />
        ) : (
          `Updated ${updatedLabel(list.updated_at)}`
        )}
      </p>
    </div>
  )
}

/** "Video" on a cover (lr-lists §2.1): top-left 8/8, 20px pill, 10/600 white
 *  on rgba(0,0,0,.6), a filled 8px play then the word. */
function VideoBadge() {
  return (
    <span className="absolute left-2 top-2 flex h-5 items-center gap-1 rounded-pill bg-black/60 px-[7px] text-[10px] font-semibold text-white">
      <LIcon name="play" size={8} filled />
      Video
    </span>
  )
}
