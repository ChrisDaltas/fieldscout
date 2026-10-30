'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

import { GuestShell } from '@/components/layout/guest-shell'
import { Button } from '@/components/ui/button'

/**
 * A public page that couldn't be read — a person's profile, their Followers
 * or Following, one of their shared lists (`/u/[username]/…`), and a tag's
 * page (`/tag/[tag]`, which re-exports this). Those pages throw on any failed
 * read (plan C4, readiness S13) rather than show a false "not found", no
 * lists or no followers; this says what happened, inside the same guest
 * chrome, with Try again — which reads the page again on the server
 * (`router.refresh`) before re-rendering it. Next answers the request with a
 * 500, so a search engine never indexes the failure as the page.
 *
 * The public pages' empty-card look (hairline card, 15px bold heading, 11px
 * grey line); a rounded rectangle, as every system message is.
 */
export default function PublicPageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()
  const [retrying, startRetry] = useTransition()

  return (
    <GuestShell>
      <div
        role="alert"
        className="mx-auto max-w-[833px] rounded-2xl border border-n-4 bg-white px-6 py-14 text-center"
      >
        <h1 className="text-h6 text-ink">Couldn&apos;t load this page</h1>
        <p className="mx-auto mt-1.5 max-w-md text-[11px] font-medium text-n-6">
          Something went wrong on our side. Try again in a moment.
        </p>
        <Button
          variant="stroke"
          size="sm"
          className="mt-3.5"
          disabled={retrying}
          onClick={() =>
            startRetry(() => {
              router.refresh()
              reset()
            })
          }
        >
          {retrying ? 'Loading…' : 'Try again'}
        </Button>
      </div>
    </GuestShell>
  )
}
