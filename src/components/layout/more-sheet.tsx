'use client'

import Link from 'next/link'
import {
  BarChart3,
  Calendar,
  History as HistoryIcon,
  LogOut,
  Settings,
  Swords,
  Trophy,
  User as UserIcon,
  Vote,
} from 'lucide-react'

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useAuth } from '@/hooks/use-auth'
import { useHistoryStore } from '@/stores/history-store'

interface MoreSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MoreSheet({ open, onOpenChange }: MoreSheetProps) {
  const { profile, signOut } = useAuth()
  const entries = useHistoryStore((s) => s.entries)

  const close = () => onOpenChange(false)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-xl border-bg-elevated-2 bg-bg-elevated px-4 pb-8 pt-6 max-h-[85vh] overflow-y-auto"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-base">More</SheetTitle>
        </SheetHeader>

        <ul className="mt-4 space-y-1">
          <Row href="/app/stats" icon={BarChart3} label="Stats" onClick={close} />
          <Row
            href="/app/weekly-ranks"
            icon={Calendar}
            label="Weekly Ranks"
            onClick={close}
          />
          <Row
            href="/app/start-or-sit"
            icon={Vote}
            label="Start or Sit"
            onClick={close}
          />
          <Row href="/app/teams" icon={Swords} label="Teams" onClick={close} />
          <Row href="/app/leagues" icon={Trophy} label="Leagues" onClick={close} />
        </ul>

        <div className="mt-6">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
            <span className="inline-flex items-center gap-1">
              <HistoryIcon className="h-3 w-3" /> History
            </span>
          </p>
          {entries.length === 0 ? (
            <p className="px-3 text-xs text-text-tertiary">No history yet</p>
          ) : (
            <ul className="space-y-0.5">
              {entries.slice(0, 8).map((entry) => (
                <li key={entry.href + entry.visitedAt}>
                  <Link
                    href={entry.href}
                    onClick={close}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
                  >
                    <span className="truncate">{entry.name}</span>
                    {entry.subtitle && (
                      <span className="ml-auto truncate text-xs text-text-tertiary">
                        {entry.subtitle}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 border-t border-bg-elevated-2 pt-4">
          <ul className="space-y-1">
            {profile && (
              <Row
                href={`/u/${profile.username}`}
                icon={UserIcon}
                label="My Profile"
                onClick={close}
              />
            )}
            <Row
              href="/app/settings"
              icon={Settings}
              label="Settings"
              onClick={close}
            />
            {profile && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    close()
                    void signOut()
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-destructive transition-colors hover:bg-bg-elevated-2"
                >
                  <LogOut className="h-4 w-4" />
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
  icon: Icon,
  label,
  onClick,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onClick}
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
      >
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </Link>
    </li>
  )
}
