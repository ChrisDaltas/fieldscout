import { notFound } from 'next/navigation'

import { AdminLeaguePage } from '@/components/admin/admin-leagues'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function AdminLeagueStatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  return <AdminLeaguePage leagueId={id.toLowerCase()} />
}
