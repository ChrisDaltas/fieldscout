'use client'

import Link from 'next/link'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface GuestSignupPromptProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  redirectTo?: string
}

/** Signup gate for guests — accent-blue "do a thing" moment on the standard
 *  white ink-bordered dialog. */
export function GuestSignupPrompt({
  open,
  onOpenChange,
  title = 'Sign up to save your work',
  description = 'Track your accuracy over the season. Share your big board with your league. Sign up free, takes 30 seconds.',
  redirectTo,
}: GuestSignupPromptProps) {
  const signupHref = redirectTo
    ? `/signup?redirect=${encodeURIComponent(redirectTo)}`
    : '/signup'
  const loginHref = redirectTo
    ? `/login?redirect=${encodeURIComponent(redirectTo)}`
    : '/login'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button variant="blue" shadow asChild className="w-full">
            <Link href={signupHref}>Sign up free</Link>
          </Button>
          <Button variant="ghost" asChild className="w-full">
            <Link href={loginHref}>I already have an account</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
