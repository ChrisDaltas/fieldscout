'use client'

import Link from 'next/link'
import { type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

interface NavItemProps {
  href?: string
  label: string
  icon: LucideIcon
  active?: boolean
  collapsed?: boolean
  badge?: React.ReactNode
  onClick?: () => void
  trailing?: React.ReactNode
}

export function NavItem({
  href,
  label,
  icon: Icon,
  active = false,
  collapsed = false,
  badge,
  onClick,
  trailing,
}: NavItemProps) {
  const content = (
    <span
      className={cn(
        'group relative flex h-10 items-center rounded-md text-sm font-medium transition-colors',
        collapsed ? 'w-10 justify-center px-0' : 'w-full gap-3 px-3',
        active
          ? 'bg-bg-elevated-2 text-foreground'
          : 'text-text-secondary hover:bg-bg-elevated-2 hover:text-foreground',
      )}
      title={collapsed ? label : undefined}
    >
      {active && !collapsed && (
        <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r bg-foreground" />
      )}
      <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.25 : 2} />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{label}</span>
          {badge}
          {trailing}
        </>
      )}
    </span>
  )

  if (href) {
    return (
      <Link href={href} onClick={onClick} className="block">
        {content}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      {content}
    </button>
  )
}
