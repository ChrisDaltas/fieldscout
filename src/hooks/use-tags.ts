'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { List, Profile, Tag } from '@/types/database'

interface TagsResponse {
  tags: Pick<Tag, 'id' | 'name' | 'slug' | 'is_system_tag' | 'use_count'>[]
}

export interface TagListItem extends List {
  owner: Pick<
    Profile,
    'id' | 'username' | 'avatar_url' | 'cred_score' | 'is_pro'
  >
}

interface TagFeedResponse {
  tag: Pick<Tag, 'id' | 'name' | 'slug' | 'is_system_tag' | 'use_count'>
  lists: TagListItem[]
  pagination: { page: number; pageSize: number; total: number; hasMore: boolean }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  return (await res.json()) as T
}

export const tagsKeys = {
  all: ['tags'] as const,
  list: (q: string | undefined, systemOnly: boolean | undefined, trending: boolean | undefined) =>
    ['tags', 'list', q ?? '', Boolean(systemOnly), Boolean(trending)] as const,
  feed: (slug: string, page: number, pageSize: number, sort: 'recent' | 'popular') =>
    ['tags', 'feed', slug, page, pageSize, sort] as const,
}

export function useTags(opts: { q?: string; systemOnly?: boolean; trending?: boolean } = {}) {
  const { q, systemOnly, trending } = opts
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (systemOnly) params.set('systemOnly', 'true')
  if (trending) params.set('trending', 'true')
  const qs = params.toString()

  return useQuery({
    queryKey: tagsKeys.list(q, systemOnly, trending),
    queryFn: () => fetch(`/api/tags${qs ? `?${qs}` : ''}`).then(jsonOrThrow<TagsResponse>),
    placeholderData: keepPreviousData,
  })
}

export function useTagFeed(
  slug: string | undefined,
  opts: { page?: number; pageSize?: number; sort?: 'recent' | 'popular' } = {},
) {
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  const sort = opts.sort ?? 'recent'

  return useQuery({
    queryKey: slug
      ? tagsKeys.feed(slug, page, pageSize, sort)
      : ['tags', 'feed', 'undefined'],
    queryFn: () =>
      fetch(
        `/api/tags/${slug}?page=${page}&pageSize=${pageSize}&sort=${sort}`,
      ).then(jsonOrThrow<TagFeedResponse>),
    enabled: Boolean(slug),
    placeholderData: keepPreviousData,
  })
}
