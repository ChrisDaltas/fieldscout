'use client'

import { useState } from 'react'

import { GenerateAiModal } from '@/components/lists/generate-ai-modal'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

interface GenerateAiButtonProps {
  className?: string
  size?: ButtonProps['size']
  label?: string
}

/**
 * "Create with AI" trigger — the Scout AI moment is accent-blue, never lime:
 * accent border on an accent-soft tint that fills solid accent on hover.
 * Visible to everyone (free users get the upgrade prompt when they submit —
 * the server route is the real gate).
 */
export function GenerateAiButton({
  className,
  size,
  label = 'Create with AI',
}: GenerateAiButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size={size}
        variant="stroke"
        className={cn(
          'border-accent bg-accent-soft text-ink hover:bg-accent hover:text-accent-foreground',
          className,
        )}
        onClick={() => setOpen(true)}
      >
        <Icon name="star" size={13} />
        {label}
      </Button>
      <GenerateAiModal open={open} onOpenChange={setOpen} />
    </>
  )
}
