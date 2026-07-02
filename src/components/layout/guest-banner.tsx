import Link from 'next/link'

export function GuestBanner() {
  return (
    <div className="sticky top-14 z-30 border-b border-bg-elevated-2 bg-bg-elevated-2 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2 lg:px-6">
        <p className="truncate text-sm text-foreground">
          <span className="font-semibold">Save your rankings</span>
          <span className="ml-2 text-text-secondary">
            Track your accuracy. Share your Big Board.
          </span>
        </p>
        <Link
          href="/signup"
          className="shrink-0 rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background transition-colors hover:bg-foreground/90"
        >
          Sign up free
        </Link>
      </div>
    </div>
  )
}
