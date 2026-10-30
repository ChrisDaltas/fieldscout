'use client'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { useToast } from '@/hooks/use-toast'

/**
 * Share — a v7 secondary button that copies a link: the page's own address,
 * or `href` (a path on this site) when the page is the app's and the link
 * worth sharing is the public one — a list's share page (plan C5), a
 * person's public profile (plan C6). Either way it is a link someone else
 * can open, signed in or not.
 *
 * A copy that doesn't go through — or a browser that offers no clipboard —
 * says so with the link in the toast, so it can still be copied by hand;
 * never a click that does nothing.
 *
 * `window` is read inside the handler and never during render, so this
 * survives the server pass of a server-rendered page.
 */
export function ShareLinkButton({ href, size = 'sm' }: { href?: string; size?: 'sm' | 'md' }) {
  const { toast } = useToast()

  const share = () => {
    const url = href ? new URL(href, window.location.origin).toString() : window.location.href
    const failed = () =>
      toast({
        title: 'Could not copy the link',
        description: url,
        variant: 'destructive',
      })
    if (!navigator.clipboard) {
      failed()
      return
    }
    void navigator.clipboard
      .writeText(url)
      .then(() => toast({ title: 'Link copied', description: url }))
      .catch(failed)
  }

  return (
    <Button variant="stroke" size={size} onClick={share}>
      <Icon name="send" size={size === 'md' ? 12 : 11} /> Share
    </Button>
  )
}
