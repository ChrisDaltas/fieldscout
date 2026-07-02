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
 * prompt when they submit — the server route is the real gate). A subtle
 * glint laps the button's stroke twice shortly after mount, fading out as
 * each lap completes (masked ring + rotating conic highlight, base
 * opacity-0); suppressed entirely for reduced-motion users via motion-safe.
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
        className={cn(
          'relative border border-ai-glint/25 transition-colors hover:border-ai-glint/45',
          className,
        )}
        onClick={() => setOpen(true)}
      >
        <Sparkles className="h-4 w-4" />
        {label}
        <span
          aria-hidden
          className="ai-shine-ring pointer-events-none absolute inset-0 overflow-hidden rounded-full"
        >
          <span className="ai-shine-gradient absolute left-1/2 top-1/2 aspect-square w-[250%] -translate-x-1/2 -translate-y-1/2 opacity-0 motion-safe:animate-border-shine" />
        </span>
      </Button>
      <GenerateAiModal open={open} onOpenChange={setOpen} />
    </>
  )
}
