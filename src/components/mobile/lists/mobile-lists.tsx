'use client'

import { useSearchParams } from 'next/navigation'

import { ListDetailsScreen } from './list-details-screen'
import { ListEditor } from './list-editor'
import { ListView } from './list-view'
import { ListsGrid } from './lists-grid'

/**
 * FieldScout Mobile — Lists (`/app/lists`). One route, four screens chosen by
 * the query string (see `lists-nav.ts` for the URL map). `?list=` is also the
 * desktop deep link (`/app/lists/<id>` redirects to it), so a shared or
 * recently-viewed list link opens the List view on a phone.
 */
export function MobileLists() {
  const params = useSearchParams()
  const listId = params.get('list')
  if (listId && params.get('edit') === '1') {
    return <ListEditor key={listId} listId={listId} autoAdd={params.get('add') === '1'} />
  }
  if (listId && params.get('details') === '1') return <ListDetailsScreen key={listId} listId={listId} />
  if (listId) return <ListView key={listId} listId={listId} />
  return <ListsGrid tab={params.get('tab') === 'saved' ? 'saved' : 'mine'} />
}
