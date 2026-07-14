/**
 * Unwrap a Supabase embedded one-to-one relation, which PostgREST may return
 * as an object or a single-element array depending on the join shape.
 */
export function firstEmbed<T>(value: T | T[] | null): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}
