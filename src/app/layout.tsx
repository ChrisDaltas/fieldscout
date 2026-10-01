import type { Metadata } from 'next'
import { Inter, Silkscreen } from 'next/font/google'

import './globals.css'
import { DevAuthBadge } from '@/components/dev/dev-auth-badge'
import { PlayerWindowsLayer } from '@/components/players/player-windows-layer'
import { DevAuthProvider } from '@/components/providers/dev-auth-provider'
import { QueryProvider } from '@/components/providers/query-provider'
import { Toaster } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'

// All UI text and numerals — Inter, pinned to its Display optical size in
// globals.css. --font-mono aliases this; .fs-num keeps tabular digits.
const inter = Inter({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-sans',
})

// Logomark only ("FieldScout" wordmark) — pixel font.
const silkscreen = Silkscreen({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-silkscreen',
})

export const metadata: Metadata = {
  title: 'FieldScout',
  description: 'The all-in-one community app for fantasy football',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          'min-h-screen bg-background font-sans text-foreground antialiased',
          inter.variable,
          silkscreen.variable,
        )}
      >
        <QueryProvider>
          <DevAuthProvider>
            {children}
            <DevAuthBadge />
          </DevAuthProvider>
          <PlayerWindowsLayer />
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  )
}
