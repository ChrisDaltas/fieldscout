'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'

import { GenerateAiModal } from '@/components/lists/generate-ai-modal'
import { Button } from '@/components/ui/button'

/**
 * "Generate with AI" trigger. Visible to everyone (free users get the upgrade
 * prompt when they submit — the server route is the real gate).
 */
export function GenerateAiButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button className={className} onClick={() => setOpen(true)}>
        <Sparkles className="mr-1 h-4 w-4" /> Generate with AI
      </Button>
      <GenerateAiModal open={open} onOpenChange={setOpen} />
    </>
  )
}
