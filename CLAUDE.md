# CLAUDE.md — Hadouken Fantasy Football

> This file is the project-level instruction manual for Claude Code. Place it at the root of the `hadouken/` monorepo. Claude Code reads this file automatically when you start a session in this directory.

---

## Project Overview

Hadouken is an all-in-one fantasy football community app for the NFL. Users create player lists, rank players into tiers, earn credibility through prediction accuracy, do player research with custom scoring systems, and simulate their real fantasy leagues.

**Domain:** hadouken.gg
**Stack:** Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Supabase + Stripe + Vercel

---

## Tech Stack & Conventions

### Framework
- **Next.js 14+** with App Router (NOT Pages Router)
- **Server Components by default.** Only add `"use client"` when the component needs interactivity (event handlers, hooks, browser APIs)
- **Server Actions** for simple mutations. **Route Handlers** (`app/api/`) for complex mutations, webhooks, and external API calls
- **TypeScript** everywhere. No `any` types. Use Zod for runtime validation of API inputs.

### Styling
- **Tailwind CSS** for all styling. No CSS modules, no styled-components.
- **shadcn/ui** as the component library base. Import from `@/components/ui/`.
- Follow the existing Tailwind theme in `tailwind.config.ts`. Don't add arbitrary color values — use theme tokens.
- **Responsive design:** Mobile-first. Use Tailwind breakpoints (`sm:`, `md:`, `lg:`).
- **Dark mode:** Support `dark:` variant from the start. Use `class` strategy.

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

4. **Free users: 2 weekly ranking positions.** Count submissions for the current week before allowing new ones.

5. **Leagues are Pro only.** Gate league creation and joining behind Pro check.

6. **Custom scoring systems are Pro only.** System defaults available to everyone.

7. **Player exclusivity in leagues.** When adding a player to a team in a league, check that no other team in that league has that player.

8. **Soft deletes.** Never hard-delete lists, teams, or rankings. Set `deleted_at` to current timestamp.

9. **Cred score weighting.** Consensus rankings weight user rankings by cred score. New users (cred = 0) still contribute but with weight of 1.

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
