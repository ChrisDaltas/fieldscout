import Link from 'next/link'

import { Wordmark } from '@/components/shared/wordmark'
import { Button } from '@/components/ui/button'

/**
 * Global 404 for public routes — signed-in routes have their own boundary at
 * src/app/app/(shell)/not-found.tsx that keeps the nav shell.
 *
 * Also the landing spot for launch-scope-gated public surfaces (/consensus,
 * /personas, /u/[username]/big-board), which call notFound() rather than
 * redirect so a gated route is indistinguishable from one that never existed.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <Wordmark className="text-[13px] text-n-3" />
      <h1 className="text-h3">Not here</h1>
      <p className="max-w-sm text-[13px] font-medium text-n-3">
        This page doesn&apos;t exist, or it&apos;s a feature we&apos;ve tucked
        away while it gets rebuilt.
      </p>
      <Button asChild variant="stroke" size="md" className="mt-2">
        <Link href="/">Back to FieldScout</Link>
      </Button>
    </main>
  )
}
