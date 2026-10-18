import { cn } from '@/lib/utils'

/**
 * Who's online (gap list §3 #25): the handoff's green dot on an avatar's
 * bottom-right edge — #07B85A (`confirm`) with a ring in the surface colour
 * (b0, #121212 in dark), m-messages §2.1 C/E and §2.2 A. The design draws it
 * at two sizes (13px on a 52px avatar, 10px on a 36px one); the other sizes
 * keep the same proportion so the dot sits on the circle's edge.
 */
export type OnlineDotSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const DOT: Record<OnlineDotSize, string> = {
  /** 26px — a thread's bubble avatars. */
  xs: 'size-2 ring-[1.5px]',
  /** 28–32px — standings, matchups, the Managers card. */
  sm: 'size-[9px] ring-2',
  /** 34–36px — the thread header (§2.2 A), the Match card. */
  md: 'size-2.5 ring-2',
  /** 52px — the people row and conversation rows (§2.1 C/E). */
  lg: 'size-[13px] ring-[2.5px] bottom-px right-px',
  /** 64px — the team page. */
  xl: 'size-4 ring-[3px] bottom-0.5 right-0.5',
}

/**
 * An avatar with the dot when its person is online. Pass `online` (true or
 * false) wherever presence applies — the wrapper is there either way, so a
 * dot coming and going never re-mounts the avatar (no photo flash). Screen
 * readers hear "Online". The wrapper is positioned (the dot hangs off it),
 * so it lets taps through: a row whose whole-row link sits underneath
 * (Standings) still opens when you tap the avatar.
 */
export function WithOnlineDot({
  online,
  size,
  ringClass = 'ring-m-b0',
  className,
  children,
}: {
  online: boolean
  size: OnlineDotSize
  /** The surface the avatar sits on — the ring matches it (default b0). */
  ringClass?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <span className={cn('pointer-events-none relative inline-flex flex-none', className)} data-online={online ? 'true' : 'false'}>
      {children}
      {online && (
        <>
          <span
            aria-hidden
            className={cn('absolute bottom-0 right-0 rounded-full bg-confirm', ringClass, DOT[size])}
            data-online-dot
          />
          <span className="sr-only">Online</span>
        </>
      )}
    </span>
  )
}

/** The thread header's sub-line for a person (§2.2 A): "Active now · {team}"
 *  while they're online, else just the team. */
export const ACTIVE_NOW = 'Active now'

export function activeNowLine(online: boolean, rest: string | null | undefined): string {
  if (!online) return rest ?? ''
  return rest ? `${ACTIVE_NOW} · ${rest}` : ACTIVE_NOW
}
