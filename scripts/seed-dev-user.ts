/**
 * Seed two dev users for local testing:
 *   - dev@fieldscout.local       (free)
 *   - dev-pro@fieldscout.local   (is_pro = true, subscription_status = 'active')
 *
 *   npm run seed:dev
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Idempotent: re-running re-syncs is_pro on existing users without recreating them.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const DEV_PASSWORD = 'dev-password-1234'

interface DevUserSpec {
  email: string
  username: string
  isPro: boolean
}

const USERS: DevUserSpec[] = [
  // 'dev_user' not 'dev': usernames are 5–20 chars (spec v2.8, Q4/Q7 rulings;
  // migration 040 CHECK). Email stays the stable login key on reruns.
  { email: 'dev@fieldscout.local', username: 'dev_user', isPro: false },
  { email: 'dev-pro@fieldscout.local', username: 'devpro', isPro: true },
]

async function findUserId(email: string): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  const match = data.users.find((u) => u.email === email)
  return match?.id ?? null
}

async function ensureUser(spec: DevUserSpec): Promise<string> {
  const existing = await findUserId(spec.email)
  if (existing) {
    console.log(`✓ ${spec.email} already exists`)
    return existing
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: spec.email,
    password: DEV_PASSWORD,
    email_confirm: true,
    user_metadata: { username: spec.username, full_name: spec.username },
  })
  if (error) throw error
  if (!data.user) throw new Error(`createUser returned no user for ${spec.email}`)

  console.log(`+ created ${spec.email}`)
  return data.user.id
}

async function syncProfile(userId: string, spec: DevUserSpec): Promise<void> {
  // Upsert in case the handle_new_user trigger didn't create the profile row
  // (it swallows exceptions, so a silent username conflict on first create
  // leaves us without a profile). This also re-syncs is_pro on rerun.
  const { error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: userId,
        username: spec.username,
        is_pro: spec.isPro,
        subscription_status: spec.isPro ? 'active' : 'free',
      },
      { onConflict: 'id' },
    )
  if (error) throw error
}

async function main(): Promise<void> {
  for (const spec of USERS) {
    const userId = await ensureUser(spec)
    await syncProfile(userId, spec)
  }
  console.log(`\nPassword for both dev users: ${DEV_PASSWORD}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
