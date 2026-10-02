import type { Metadata } from 'next'
import { Inter, Roboto_Flex, Roboto_Mono, Silkscreen } from 'next/font/google'

import './globals.css'
import { DevAuthBadge } from '@/components/dev/dev-auth-badge'
import { PlayerWindowsLayer } from '@/components/players/player-windows-layer'
import { DevAuthProvider } from '@/components/providers/dev-auth-provider'
import { QueryProvider } from '@/components/providers/query-provider'
import { Toaster } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'

// Workhorse type — variable optical size + weight (400–800 headings).
const robotoFlex = Roboto_Flex({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-sans',
})

// Every numeral/stat renders mono + tabular (see .fs-num).
const robotoMono = Roboto_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
})

// Logomark only ("FieldScout" wordmark) — pixel font.
const silkscreen = Silkscreen({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-silkscreen',
})

// v13 look (landing first) — Inter with the optical-size axis, so large
// headings render as Inter Display like the design.
const inter = Inter({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-inter',
})

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
      <body
        className={cn(
          'min-h-screen bg-background font-sans text-foreground antialiased',
          robotoFlex.variable,
          robotoMono.variable,
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
