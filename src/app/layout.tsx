import type { Metadata, Viewport } from 'next'
import { Inter, Silkscreen } from 'next/font/google'
import localFont from 'next/font/local'

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
// alias it; .fs-num keeps tabular digits so stat columns stay aligned (the
// phone layout has them everywhere — see interPhone below).
const inter = Inter({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-inter',
})

// Phone layout only (gap list §4 item 4): the full Inter 4.1 build (rsms,
// SIL OFL 1.1 — the licence text and copyright ship beside it in
// fonts/LICENSE-inter.txt; converted TTF → WOFF2). L.F1.4 subset it to the
// characters the app draws — Google's Latin range plus the arrows, math and
// symbols used in src/ plus Latin Extended-A (the list sits beside it in
// inter-variable.unicodes.txt) — keeping every OpenType feature, both axes
// and the name table: 367 KB → 126 KB, which was costing a phone ~1.8 s of first
// paint. Anything outside it falls back to the Google Inter, which carries
// every subset lazily. Google's copy above strips the
// character variants, so it can't draw the design's single-storey "a"
// (cv11). globals.css puts it first in the font stack for
// `html[data-layout='mobile']` only, so desktop never downloads it (hence no
// preload); until it arrives a phone shows the Google Inter behind it, which
// has the same metrics.
const interPhone = localFont({
  src: './fonts/inter-variable.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-inter-phone',
})

// viewport-fit=cover is set only by the app shell's layout, where the mobile
// screens pad for the notch and home indicator themselves; public pages and
// the draft room keep Safari's own safe-area insets.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
          interPhone.variable,
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
