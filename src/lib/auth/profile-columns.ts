/**
 * The `profiles` columns the browser and the signed-in server client may
 * read (migration 210, F720 — SELECT is column-level for anon /
 * authenticated). `stripe_customer_id` and `is_admin` are not among them, so
 * a `select('*')` on `profiles` through a user's client is refused: every
 * read names its columns. The signed-in user's admin status is
 * `is_platform_operator()`.
 *
 * pgTAP 160 D1 / D2 pin the same list on the database side;
 * `profile-columns.test.ts` pins this string against migration 210's GRANT.
 */
export const PROFILE_READABLE_COLUMNS =
  'id, username, avatar_url, bio, cred_score, cred_rank, is_pro, subscription_status, follower_count, following_count, created_at, updated_at'
