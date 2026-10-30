import { notFound } from 'next/navigation'

import { AdminReports } from '@/components/admin/admin-reports'
import { featureFlags } from '@/lib/feature-flags'

/**
 * Admin › Reports (Community launch plan C10). The `/app/admin` layout
 * already answers "not found" to anyone who isn't an admin; this page also
 * rides the Community switch — while it's off the address doesn't exist.
 */
export default function AdminReportsPage() {
  if (!featureFlags.community) notFound()
  return <AdminReports />
}
