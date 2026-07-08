'use client'

import Link from 'next/link'

import { Icon, type IconName } from '@/components/ui/icon'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useAuth } from '@/hooks/use-auth'
import { useHistoryStore } from '@/stores/history-store'

interface MoreSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Mobile "More" sheet — white bottom panel, flush 13px rows on the filled
 *  16px icon set, recent-history section, account rows at the foot. */
export function MoreSheet({ open, onOpenChange }: MoreSheetProps) {
  const { profile, signOut } = useAuth()
  const entries = useHistoryStore((s) => s.entries)

  const close = () => onOpenChange(false)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto px-4 pb-8 pt-5"
      >
        <SheetHeader className="text-left">
          <SheetTitle>More</SheetTitle>
        </SheetHeader>

        <ul className="mt-3">
          <Row href="/app/stats" icon="chart" label="My stats" onClick={close} />
          <Row
            href="/app/weekly-ranks"
            icon="calendar"
            label="Weekly ranks"
            onClick={close}
          />
          <Row
            href="/app/start-or-sit"
            icon="sort"
            label="Start or sit"
            onClick={close}
          />
          <Row href="/app/teams" icon="layers" label="Teams" onClick={close} />
          <Row href="/app/leagues" icon="cup" label="Leagues" onClick={close} />
        </ul>

        <div className="mt-5">
          <p className="flex items-center gap-1.5 px-2.5 pb-1.5 text-[11px] font-bold text-n-3">
            <Icon name="clock" size={13} />
            History
          </p>
          {entries.length === 0 ? (
            <p className="px-2.5 text-[12px] font-medium text-n-3">
              No history yet
            </p>
          ) : (
            <ul>
              {entries.slice(0, 8).map((entry) => (
                <li key={entry.href + entry.visitedAt}>
                  <Link
                    href={entry.href}
                    onClick={close}
                    className="flex h-[34px] items-center gap-2 rounded-sm px-2.5 text-[13px] font-medium text-n-3 transition-colors duration-200 ease-linear hover:bg-n-4 hover:text-ink"
                  >
                    <span className="truncate">{entry.name}</span>
                    {entry.subtitle && (
                      <span className="ml-auto truncate text-[11px] font-medium text-n-3">
                        {entry.subtitle}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5 border-t border-n-4 pt-3">
          <ul>
            {profile && (
              <Row
                href={`/u/${profile.username}`}
                icon="profile"
                label="My profile"
                onClick={close}
              />
            )}
            <Row href="/app/settings" icon="setup" label="Settings" onClick={close} />
            {profile && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    close()
                    void signOut()
                  }}
                  className="flex h-[38px] w-full items-center gap-2.5 rounded-sm px-2.5 text-[13px] font-bold text-negative-strong transition-colors duration-200 ease-linear hover:bg-negative-soft"
                >
                  <Icon name="transfer" size={16} />
                  Sign out
                </button>
              </li>
            )}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Row({
  href,
  icon,
  label,
  onClick,
}: {
  href: string
  icon: IconName
  label: string
  onClick: () => void
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onClick}
        className="flex h-[38px] items-center gap-2.5 rounded-sm px-2.5 text-[13px] font-bold text-ink transition-colors duration-200 ease-linear hover:bg-n-4"
      >
        <Icon name={icon} size={16} className="text-ink" />
        <span>{label}</span>
      </Link>
    </li>
  )
}
