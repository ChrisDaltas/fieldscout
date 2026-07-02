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

export function GuestSignupPrompt({
  open,
  onOpenChange,
  title = 'Sign up to save your work',
  description = 'Track your accuracy over the season. Share your Big Board with your league. Sign up free, takes 30 seconds.',
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
      <DialogContent className="border-bg-elevated-2 bg-bg-elevated-2 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-text-secondary">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Link href={signupHref} className="w-full">
            <Button className="w-full rounded-full font-semibold">
              Sign up free
            </Button>
          </Link>
          <Link href={loginHref} className="w-full">
            <Button variant="invisible" className="w-full text-text-secondary">
              I already have an account
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
