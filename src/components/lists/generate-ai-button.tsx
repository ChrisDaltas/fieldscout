'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'

import { GenerateAiModal } from '@/components/lists/generate-ai-modal'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface GenerateAiButtonProps {
  className?: string
  size?: ButtonProps['size']
  label?: string
}

/**
 * "Create with AI" trigger. Visible to everyone (free users get the upgrade
 * prompt when they submit — the server route is the real gate). Carries a
 * periodic glimmer sweep so it stands out; suppressed for reduced-motion
 * users via motion-safe.
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
        className={cn('relative overflow-hidden', className)}
        onClick={() => setOpen(true)}
      >
        <Sparkles className="h-4 w-4" />
        {label}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-y-1 left-0 w-1/3 bg-gradient-to-r from-transparent via-foreground/25 to-transparent motion-safe:animate-shine"
        />
      </Button>
      <GenerateAiModal open={open} onOpenChange={setOpen} />
    </>
  )
}
