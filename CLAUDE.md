# CLAUDE.md — FieldScout Fantasy Football

> This file is the project-level instruction manual for Claude Code. Place it at the root of the `fieldscout/` monorepo. Claude Code reads this file automatically when you start a session in this directory.

---

## Project Overview

FieldScout is an all-in-one fantasy football community app for the NFL. Users create player lists, rank players into tiers, earn credibility through prediction accuracy, do player research with custom scoring systems, and simulate their real fantasy leagues.

**Domain:** fieldscout.gg
**Stack:** Next.js 15 (App Router) + TypeScript + Tailwind 3 + shadcn/ui + Supabase + Stripe + Vercel

---

## Redesign (In Progress — July 2026)

A whole-app visual overhaul is underway. The **Claude Design prototype ("Field Scout look") is the design source of truth** — the current UI (an early "make it look like Spotify" pass) carries no design value worth preserving. Rules for all redesign work:

- **Re-skin in place.** Restyle the existing shadcn/Radix/CVA components in `src/components/ui/` via tokens and variant styles. Do not generate a replacement component library or parallel component tree.
- **Single theme.** One mode blending dark and light. There is no dark/light toggle. Remove/ignore `next-themes` and `dark:` variants as screens are reskinned; never generate dual-theme tokens.
- **Design intent:** simpler and less pro-user-dense than the old UI. When a judgment call isn't covered by the design package, choose clarity over information density.
- **New IA:** right-side context-aware bar (Account, Notifications, Direct Messages, Players quick-research panel). Social/user-generated content lives on the Community tab; Home is a jump-off hub (join a live draft, adjust a lineup, player research). Lists are a draft tool, not social-media content.
- **Prototype gaps:** AI list generation and influencer personas/AI experts exist in the app but not the prototype. Keep them and restyle them in the new design language — never leave them in the old style, never remove them. Same for states the prototype doesn't show (loading, empty, error, overflow, free-vs-Pro gates): extend the new design language.
- **League/team/live-draft screens are UI-only for now.** The backend isn't built (PRD exists, not yet greenlit). Build these screens with clearly-marked mock data and stub handlers — do not invent API routes or schema for them.

---

## Tech Stack & Conventions

### Framework
- **Next.js 15+** with App Router (NOT Pages Router)
- **Server Components by default.** Only add `"use client"` when the component needs interactivity (event handlers, hooks, browser APIs)
- **Server Actions** for simple mutations. **Route Handlers** (`app/api/`) for complex mutations, webhooks, and external API calls
- **TypeScript** everywhere. No `any` types. Use Zod for runtime validation of API inputs.

### Styling
- **Tailwind CSS** for all styling. No CSS modules, no styled-components.
- **shadcn/ui** as the component library base. Import from `@/components/ui/`.
- Follow the existing Tailwind theme in `tailwind.config.ts`. Don't add arbitrary color values — use theme tokens.
- **Tailwind v3.4** — tokens live in `tailwind.config.ts` theme extensions + CSS variables. Do not use Tailwind v4 conventions (`@theme` blocks).
- **Responsive design:** Mobile-first. Use Tailwind breakpoints (`sm:`, `md:`, `lg:`).
- **Theming: single blended mode.** No dark/light toggle. Legacy `next-themes` / `dark:` variants are being removed as part of the redesign — don't add new ones.

### Components
- **No near-duplicate components.** Before creating any component, search `components/` for one that already does the job. Prefer adding a CVA variant or prop to an existing component over creating a new one. New shared components require explicit approval; small visual differences from a mock never justify forking a component.

### State Management
- **React Query (TanStack Query)** for all server state (data fetching, caching, mutations)
- **Zustand** for client-only UI state (sidebar open/closed, drag state, modal state)
- **Never** use React Context for data that changes frequently

### Database
- **Supabase** (PostgreSQL) with Row-Level Security on every table
- Use the **Supabase client** for all database operations — never write raw SQL in application code
- **Server-side:** Use `createServerClient` from `@supabase/ssr`
- **Client-side:** Use `createBrowserClient` from `@supabase/ssr`
- Types are generated from the schema: `npx supabase gen types typescript --project-id $PROJECT_ID > src/types/database.ts`

### File Organization
```
src/
  app/           → Routes and layouts only. Minimal logic.
  components/    → React components, organized by feature domain
  lib/           → Third-party client setup (supabase, stripe, etc.)
  hooks/         → Custom React hooks (one hook per file)
  stores/        → Zustand stores
  types/         → TypeScript types and Zod schemas
  utils/         → Pure utility functions (no side effects)
```

### Naming Conventions
- **Files:** kebab-case (`player-card.tsx`, `use-lists.ts`)
- **Components:** PascalCase (`PlayerCard`, `ListDetail`)
- **Hooks:** camelCase with `use` prefix (`useLists`, `useAuth`)
- **Types:** PascalCase (`Player`, `ListWithPlayers`)
- **Database columns:** snake_case (matches Supabase convention)
- **API routes:** kebab-case paths (`/api/lists/[id]/players`)

### Code Patterns

**React Query hook pattern:**
```typescript
// hooks/use-lists.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createBrowserClient } from '@/lib/supabase/client'

export function useLists(userId: string) {
  const supabase = createBrowserClient()

  return useQuery({
    queryKey: ['lists', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lists')
        .select('*')
        .eq('owner_id', userId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })

      if (error) throw error
      return data
    },
  })
}
```

**API route pattern:**
```typescript
// app/api/lists/route.ts
import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createListSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  position_filter: z.enum(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX']).optional(),
  is_ranked: z.boolean().default(false),
})

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = createListSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('lists')
    .insert({
      owner_id: user.id,
      ...parsed.data,
      slug: slugify(parsed.data.title),
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
```

**Component pattern:**
```typescript
// components/lists/list-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { List } from '@/types/database'

interface ListCardProps {
  list: List
}

export function ListCard({ list }: ListCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {list.title}
          {list.is_ranked && <Badge variant="secondary">Ranked</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{list.description}</p>
        <p className="text-xs text-muted-foreground mt-2">
          {list.player_count} players
        </p>
      </CardContent>
    </Card>
  )
}
```

---

## Key Business Rules (Enforce These)

1. **Each player can only appear once per list.** The `list_players` table has a unique constraint on `(list_id, player_id)`. Handle the duplicate gracefully in the UI with a toast message.

2. **Free users: 1 private list.** Check `is_pro` on the profile before allowing `is_private = true` on list creation. Count existing private lists.

3. **Free users: 1 team.** Same check — count existing teams before allowing conversion.

4. **Rankings are a free feature.** Weekly rankings and pre-draft big boards are available to everyone with no per-week or per-position limit. (There is intentionally no Pro gate on rankings — do not add one.)

5. **Leagues are Pro only.** Gate league creation and joining behind Pro check.

6. **Custom scoring systems are Pro only.** System defaults available to everyone.

7. **Player exclusivity in leagues.** When adding a player to a team in a league, check that no other team in that league has that player.

8. **Soft deletes.** Never hard-delete lists, teams, or rankings. Set `deleted_at` to current timestamp.

9. **Cred score weighting.** Consensus rankings weight user rankings by cred score. New users (cred = 0) still contribute but with weight of 1.

---

## Active Builds

### Redraft Leagues (in progress)
- Spec (LAW): docs/specs/spec-redraft-leagues.md (v2.6)
- Delivery plan: docs/specs/delivery-plan-redraft-leagues.md (v1.2)
- Progress/memory: docs/specs/PROGRESS-leagues.md — read at session start, update at session end
  (not yet created — first Architect session should create it, per delivery plan §9)
- The spec wins every disagreement. If code and spec conflict, the code is wrong.
  If the spec seems wrong or ambiguous: STOP, write the question + your recommendation
  to PROGRESS under "Spec questions". Never improvise around the spec.
- Server-authoritative always: clients never compute scores or write picks directly.
  RPCs are SECURITY DEFINER with search_path=''; RLS exactly per spec §12.
- Time only via TimeProvider; stats only via StatsProvider (spec §23, plan M0).
  No raw Date.now() or fetch in league logic.
- Never weaken: audit-log immutability (§12.12), lock semantics (§7.3.4/§11.2),
  scoring-snapshot reads (§7.3.3), §22.6 load gates.
- Definition of Done = delivery plan §2.3: tests green (shown, not claimed),
  checklists §8.1–8.4 pass for schema/RLS/RPC/realtime work, PROGRESS updated,
  small commit citing the spec §.

---


## Commands

```bash
# Development
npm run dev              # Start Next.js dev server (port 3000)
npm run build            # Production build
npm run lint             # ESLint check
npm run type-check       # TypeScript check (tsc --noEmit)

# Database
npx supabase db push     # Push migrations to Supabase
npx supabase gen types typescript --project-id $PROJECT_ID > src/types/database.ts  # Regen types

# Testing
npm run test             # Run Vitest
npm run test:e2e         # Run Playwright E2E tests
```

---

## Important Notes

- **Never commit `.env.local`** — it contains secrets. Use `.env.example` as a template.
- **Always run `npm run type-check`** before committing to catch type errors.
- **Migrations are version controlled** in `supabase/migrations/`. Create new migrations with `npx supabase migration new <name>`.
- **Player data is read-only.** The `players` and `player_stats` tables are populated by sync scripts only. Never insert/update player data from the application.
- **Use optimistic updates** for like/unlike, follow/unfollow, and list reordering to keep the UI snappy.
- **All public-facing pages must be server-rendered** for SEO (profiles, consensus rankings, public lists).
