import { notFound } from 'next/navigation'

import { isAdminViewer } from '@/lib/auth/require-admin'

/**
 * Every `/app/admin` page — the operator console and the persona-post review
 * tab — is "page not found" to anyone who is not an admin (spec §24.4
 * "Where"; Q96; tasks-M8 TD8; F581). `notFound()`, not a redirect: a guessed
 * address must look exactly like an address that does not exist. The
 * `/api/admin/*` routes answer 404 the same way (`requireAdminUser`).
 */
export const dynamic = 'force-dynamic'

export default async function AdminGate({ children }: { children: React.ReactNode }) {
  if (!(await isAdminViewer())) notFound()
  return <>{children}</>
}
