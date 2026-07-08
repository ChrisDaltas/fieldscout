import type { Metadata } from 'next'
import { Roboto_Flex, Roboto_Mono, Silkscreen } from 'next/font/google'

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
          robotoFlex.variable,
          robotoMono.variable,
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
