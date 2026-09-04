/**
 * The in-season family's WIRE ID shape (M4 task L.D4.2; L.D4.1 composes onto
 * it the way it composes onto `inseason-errors.ts`).
 *
 * **Why this exists — R768.** Every in-season verb stamps an `action_id` and
 * names a `team_id`, and every one of them then compares the RPC's returned
 * payload against what the caller sent (the F65(b) identity guard: 113's
 * replay is kind/team-scoped but not ARGUMENT-scoped, 111's is kind-scoped
 * but not SEED-scoped, so a reused id must be caught in this layer). That
 * comparison is a STRING comparison against a value Postgres wrote — and
 * Postgres renders `uuid` in lowercase, always.
 *
 * `z.uuid()` is case-INSENSITIVE (zod 4.3.6), so
 * `AF800000-0000-4000-8000-000000000011` is a perfectly valid id on the wire.
 * Sent uppercase it reaches the RPC fine (Postgres parses either case), the
 * move COMMITS — and then the guard compares `'AF80…'` to the returned
 * `'af80…'`, they differ, and the route answers 409 "that didn't go through"
 * for a move that went through, with the `action_id` consumed so the retry
 * cannot succeed either. That is CLAUDE.md's "never let 'nothing happened'
 * mean 'it worked'" run in REVERSE, and it is the exact failure the guard
 * exists to prevent.
 *
 * So the normalisation happens ONCE, at the schema, before either the RPC or
 * the guard sees the value: parse, then lowercase. The guard keeps its whole
 * strength — two genuinely different uuids are still different in any case —
 * and gains the property it always assumed, that the string it compares is in
 * the same form the database returns.
 *
 * Use this for every uuid a request sends that the response is compared
 * against, or that is stored and re-read as text. A uuid that is only ever
 * handed to Postgres (a path parameter, a filter) does not need it — the
 * database casts and compares as `uuid`, where case is irrelevant.
 */
import { z } from 'zod'

/** A uuid on the wire, normalised to the form Postgres returns. */
export const normalizedUuid = z.uuid().transform((value) => value.toLowerCase())
