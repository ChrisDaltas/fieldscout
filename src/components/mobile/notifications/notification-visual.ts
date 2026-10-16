/**
 * The mobile Notifications row's look per notification type (m-home §2B /
 * m-dock §2.10): a 40px tinted circle holding an 18px stroke icon. The
 * design's six samples set the palette — trade offer blue, followed user's
 * update purple, good news (a TD, a won waiver) green, a lineup problem red,
 * a lock reminder orange — and every REAL type maps onto it by meaning.
 * Pure: no time, DOM or fetch (callers pass `now`).
 */
import { M_ICON } from '@/components/mobile/ui/m-icon'
import type { NotificationItem } from '@/hooks/use-notifications'

/** Icon paths the design draws inline (16×16 viewBox). */
export const NOTIF_PATH = {
  trade: M_ICON.trade,
  bars: 'M3 13.5V9M8 13.5V3M13 13.5V6.5',
  lists: M_ICON.lists,
  check: 'M3 8.5l3.2 3L13 4.5',
  plus: 'M8 3.5v9M3.5 8h9',
  alert: 'M8 4.5v4M8 11h.01',
  clock: 'M8 4.5V8l2.5 1.5',
  person: M_ICON.players,
  corrections: M_ICON.corrections,
  bell: M_ICON.bell,
  note: M_ICON.news,
} as const

export type NotifTone = 'blue' | 'purple' | 'green' | 'red' | 'orange' | 'neutral'

/** Circle fill + stroke colour (fill themed, stroke fixed — m-home §6). */
export const NOTIF_TONE_CLASS: Record<NotifTone, string> = {
  blue: 'bg-m-gb text-accent',
  purple: 'bg-m-gp text-pos-wr',
  green: 'bg-m-gg text-positive-strong',
  red: 'bg-m-gr text-negative-strong',
  orange: 'bg-m-go text-warn',
  neutral: 'bg-m-b2 text-m-t3',
}

export interface NotifVisual {
  path: string
  tone: NotifTone
}

function dataStatus(n: Pick<NotificationItem, 'data'>): string | null {
  const status = (n.data as Record<string, unknown> | null)?.status
  return typeof status === 'string' ? status : null
}

export function notificationVisual(n: Pick<NotificationItem, 'type' | 'data'>): NotifVisual {
  const type = n.type
  if (type.includes('trade')) {
    if (/(vetoed|rejected|invalid|expired|cancelled)$/.test(type)) return { path: NOTIF_PATH.trade, tone: 'red' }
    if (/(executed|accepted)$/.test(type)) return { path: NOTIF_PATH.trade, tone: 'green' }
    return { path: NOTIF_PATH.trade, tone: 'blue' }
  }
  if (type === 'league_waiver_claim') {
    // 150's `data.status`: won / lost / failed.
    return dataStatus(n) === 'won' ? { path: NOTIF_PATH.plus, tone: 'green' } : { path: NOTIF_PATH.alert, tone: 'red' }
  }
  if (type.includes('waiver') || type.includes('faab')) return { path: NOTIF_PATH.plus, tone: 'green' }
  if (type.includes('injur')) return { path: NOTIF_PATH.alert, tone: 'red' }
  if (type.includes('lock') || type.includes('lineup')) return { path: NOTIF_PATH.clock, tone: 'orange' }
  if (type.includes('rescored') || type.includes('correction')) return { path: NOTIF_PATH.corrections, tone: 'orange' }
  if (type.includes('ranking')) return { path: NOTIF_PATH.bars, tone: 'purple' }
  if (type.startsWith('list')) return { path: NOTIF_PATH.lists, tone: 'purple' }
  if (type.includes('invite')) return { path: NOTIF_PATH.person, tone: 'blue' }
  if (type.includes('vote')) return { path: NOTIF_PATH.check, tone: 'blue' }
  if (type === 'league_member') return { path: NOTIF_PATH.person, tone: 'neutral' }
  if (type === 'operator_notice') return { path: NOTIF_PATH.bell, tone: 'blue' }
  // Gap list #13 (192): the commissioner changed the league's note.
  if (type === 'league_commissioner_note') return { path: NOTIF_PATH.note, tone: 'blue' }
  return { path: NOTIF_PATH.bell, tone: 'neutral' }
}

/** The design's short relative time: "now", "8m", "12h", "1d", "3w", then a date. */
export function shortTime(iso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'now'
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  if (d < 56) return `${Math.floor(d / 7)}w`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** The row's grey line: "{sub} · {time}", or the time alone. */
export function subLine(body: string | null, time: string): string {
  const sub = body?.trim()
  return sub ? `${sub} · ${time}` : time
}
