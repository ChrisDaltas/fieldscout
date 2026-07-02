import { redirect } from 'next/navigation'

import { AppShell } from '@/components/layout/app-shell'
import { createServerClient } from '@/lib/supabase/server'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?redirect=/app')
  }

  return <AppShell>{children}</AppShell>
}
