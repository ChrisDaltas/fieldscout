import type { Metadata, Viewport } from 'next'
import { Inter, Silkscreen } from 'next/font/google'

import './globals.css'
import { DevAuthBadge } from '@/components/dev/dev-auth-badge'
import { PlayerWindowsLayer } from '@/components/players/player-windows-layer'
import { DevAuthProvider } from '@/components/providers/dev-auth-provider'
import { LAYOUT_MODE_HEAD_SCRIPT } from '@/hooks/use-layout-mode'
import { QueryProvider } from '@/components/providers/query-provider'
import { Toaster } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'

// Logomark only ("FieldScout" wordmark) — pixel font.
const silkscreen = Silkscreen({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-silkscreen',
})

// All UI text and numerals (v7 look) — Inter with the optical-size axis,
// pinned to its Display cut in globals.css. --font-sans and --font-mono both
// alias it; .fs-num keeps tabular digits so stat columns stay aligned.
const inter = Inter({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-inter',
})

// viewport-fit=cover lets the mobile layout run under the notch and home
// indicator and pad with env(safe-area-inset-*) itself (FieldScout Mobile).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'FieldScout',
  description: 'The all-in-one community app for fantasy football',
}

export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode
  /** @modal slot — route-intercepted modals (sign-in over the landing page). */
  modal: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Desktop vs mobile layout before first paint (use-layout-mode). */}
        <script dangerouslySetInnerHTML={{ __html: LAYOUT_MODE_HEAD_SCRIPT }} />
      </head>
      <body
        className={cn(
          'min-h-screen bg-background font-sans text-foreground antialiased',
          silkscreen.variable,
          inter.variable,
        )}
      >
        <QueryProvider>
          <DevAuthProvider>
            {children}
            {modal}
            <DevAuthBadge />
          </DevAuthProvider>
          <PlayerWindowsLayer />
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  )
}
