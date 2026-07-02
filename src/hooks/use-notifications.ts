import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string | null
  data: { list_id?: string; actor_id?: string } | null
  read: boolean
  created_at: string
}

interface NotificationsResponse {
  notifications: NotificationItem[]
  unreadCount: number
}

const NOTIFICATIONS_KEY = ['notifications'] as const

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () =>
      fetch('/api/notifications').then(jsonOrThrow<NotificationsResponse>),
    enabled,
    // Poll so the bell badge stays roughly live without realtime wiring.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids?: string[]) =>
      fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : {}),
      }).then(jsonOrThrow<{ ok: boolean }>),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  })
}
