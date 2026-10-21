/**
 * True only for the local Supabase stack (`supabase start`): an http(s) URL
 * whose host is exactly localhost, 127.0.0.1 or [::1]. Dev seeding scripts
 * refuse to run against anything else — `.env.local` points at the hosted
 * project, so a bare run would otherwise write dev accounts or fake data there.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isLocalSupabaseUrl(raw: string | null | undefined): boolean {
  if (!raw) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  return LOCAL_HOSTS.has(url.hostname)
}
