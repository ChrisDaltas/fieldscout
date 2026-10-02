'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { LogoTile } from '@/components/landing/fieldscout-logo'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Sign-in modal over the landing page (v13 look). Two entry points:
 *  - `intercepted`: "Sign in" clicked on `/` — the homepage stays mounted
 *    underneath (app/@modal/(.)login); closing goes back.
 *  - direct `/login` (bookmark, protected-route redirect): the page renders
 *    the landing page with this open; closing goes to `/`.
 */
export function SignInModal({ intercepted = false }: { intercepted?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(true)

  const close = () => {
    setOpen(false)
    if (intercepted) router.back()
    else router.replace('/', { scroll: false })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent look="fs" className="w-[calc(100%-32px)] max-w-[400px] gap-0 sm:p-9">
        <Suspense fallback={null}>
          <SignInForm />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}

const inputClass =
  'h-12 w-full rounded-fs-md bg-fs-page px-4 text-[15px] font-medium text-fs-ink outline-none transition-shadow placeholder:text-fs-text-4 focus:bg-white focus:ring-2 focus:ring-fs-blue'

function SignInForm() {
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') ?? '/app'
  const supabase = createBrowserClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError(signInError.message)
      setIsLoading(false)
      return
    }

    // Hard navigation so the new auth cookie reaches the server-rendered
    // /app layout in the same request — router.push happens before the cookie
    // round-trips to the middleware and gets bounced back to /login.
    window.location.href = redirect
  }

  return (
    <form onSubmit={handleLogin} className="flex flex-col">
      <LogoTile size={36} />
      <DialogTitle className="mt-5 text-[28px] font-bold leading-tight tracking-[-0.03em]">
        Welcome back
      </DialogTitle>
      <DialogDescription className="mt-1 text-[15px] font-medium text-fs-text-3">
        Sign in to your FieldScout account.
      </DialogDescription>

      {error && (
        <div
          role="alert"
          className="mt-5 flex items-center gap-2 rounded-fs-md bg-negative-soft px-3.5 py-2.5 text-[13px] font-semibold text-fs-ink"
        >
          <Icon name="info-circle" size={14} className="shrink-0 text-negative-strong" />
          {error}
        </div>
      )}

      <label htmlFor="email" className="mt-6 text-[13px] font-semibold">
        Email
      </label>
      <input
        id="email"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
        className={`mt-1.5 ${inputClass}`}
      />

      <div className="mt-4 flex items-center justify-between">
        <label htmlFor="password" className="text-[13px] font-semibold">
          Password
        </label>
        <Link href="/forgot-password" className="text-[13px] font-semibold text-fs-blue hover:text-fs-blue-hover">
          Forgot password?
        </Link>
      </div>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="current-password"
        className={`mt-1.5 ${inputClass}`}
      />

      <button
        type="submit"
        disabled={isLoading}
        className="mt-7 flex h-12 w-full items-center justify-center rounded-pill bg-fs-blue text-[16px] font-semibold text-white transition-colors hover:bg-fs-blue-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fs-blue disabled:opacity-60"
      >
        {isLoading ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="mt-5 text-center text-[14px] font-medium text-fs-text-3">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-semibold text-fs-blue hover:text-fs-blue-hover">
          Create account
        </Link>
      </p>
    </form>
  )
}
