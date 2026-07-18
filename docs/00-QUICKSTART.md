# Quickstart: Building FieldScout with Claude Code

Hey Chris — here's how to go from these docs to a running app.

---

## What You Need Before Starting

### Accounts to Create (all free to start)

1. **GitHub** — github.com (you probably have this). Create a new repo called `fieldscout`.
2. **Vercel** — vercel.com — Sign up with GitHub. This hosts the app. Free tier is plenty.
3. **Supabase** — supabase.com — Sign up and create a new project called "fieldscout". Choose the region closest to you. Save the project URL and anon key (shown on the project dashboard under Settings → API).
4. **Stripe** — stripe.com — Sign up for an account. You'll use test mode until launch. Get your test API keys from the Developers dashboard.
5. **MySportsFeeds** — mysportsfeeds.com — Sign up for a developer account (non-commercial tier is free, paid tiers start ~$9/month). Get an NFL API key. This powers current-season stats and live game scoring. (You can skip this initially — Phases 1–6 use free data sources and mock data. Only needed for Phase 7 Live Mode.)
6. **Anthropic** — console.anthropic.com — You probably have this. Get an API key for Claude API access.
7. **Resend** — resend.com — Sign up for transactional email. Free tier is 100 emails/day.

### Software to Install

1. **Node.js 20+** — Download from nodejs.org (use the LTS version)
2. **Git** — Probably already installed. Check with `git --version` in terminal.
3. **Claude Code** — Install with: `npm install -g @anthropic-ai/claude-code`
4. **Supabase CLI** — Install with: `npm install -g supabase`
5. **A code editor** — VS Code is great (code.visualstudio.com), but you'll mostly be working in Claude Code's terminal.

---

## Step-by-Step: Your First Day

### 1. Create the GitHub Repo

```bash
mkdir fieldscout
cd fieldscout
git init
git remote add origin https://github.com/YOUR_USERNAME/fieldscout.git
```

### 2. CLAUDE.md

`CLAUDE.md` at the repo root is the instruction manual Claude Code reads automatically — it now reflects the live project, not a starting template, so there's nothing to copy here anymore.

### 3. Set Up Environment Variables

Create a `.env.local` file in the root:

```bash
# Copy from .env.example and fill in your actual values
cp .env.example .env.local
```

Fill in the values from your Supabase, Stripe, etc. dashboards.

### 4. Start Claude Code

```bash
cd fieldscout
claude
```

Claude Code will read CLAUDE.md and understand the project.

### 5. Start with Phase 0, Task 0.1

Open `docs/05-CLAUDE-CODE-PROMPTS.md`, copy the first prompt (Task 0.1 — Expert Seed Data + Profile Scrape), and paste it into Claude Code.

Let it work. It will create the project structure, install dependencies, and set up the foundational code.

### 6. Test It

After Claude Code finishes:

```bash
cd apps/web
npm run dev
```

Open http://localhost:3000 in your browser. You should see the basic app shell.

### 7. Continue Through the Tasks

Work through each task in order. After each one:
- Test in the browser
- Ask Claude Code to fix any issues
- Commit: `git add . && git commit -m "Phase 1, Task 1.1: Initialize monorepo"`
- Push: `git push origin main`

### 8. Deploy to Vercel

After Phase 1 is complete:
1. Go to vercel.com
2. Click "Import Project" → select your GitHub repo
3. Set the root directory to `apps/web`
4. Add your environment variables
5. Deploy

Every time you push to `main`, Vercel will auto-deploy.

---

## How to Talk to Claude Code

As a designer, here are the kinds of things you can ask:

**Building features:**
> "Build the list creation form from Task 2.2 of the prompts doc"

**Fixing bugs:**
> "The list page is showing a blank screen. Check the console for errors and fix them."

**Design tweaks:**
> "Make the list cards have more padding, round the corners more, and add a subtle shadow on hover"

**Figma integration:**
> "Look at my Figma file for the player card component. Use the Figma MCP to get the design specs and generate a matching React component."

**Understanding what happened:**
> "Explain what changes you just made in simple terms"

**Undoing changes:**
> "Undo all the changes you just made" (or manually: `git checkout .`)

---

## Project Documents

| File | What It Is |
|------|-----------|
| `00-QUICKSTART.md` | You're reading it. How to get started. |
| `01-PRD.md` | Full product requirements. What the app does and why. |
| `02-TECHNICAL-ARCHITECTURE.md` | How it's built. Tech stack, folder structure, infrastructure. |
| `03-DATA-MODEL.md` | Database tables, columns, relationships, and security policies. |
| `04-BUILD-ROADMAP.md` | 10-phase timeline from now to launch in July 2026. |
| `05-CLAUDE-CODE-PROMPTS.md` | Copy-paste prompts for Claude Code, one per task per phase. |

---

## Timeline Reminder

You have roughly 16 weeks to launch (targeting late July 2026 for fantasy draft season). That's tight but doable if you work through ~1 phase per week. The phases are front-loaded with the most important features (lists, rankings, research) so even if you don't finish everything, you'll have a useful app.

Phases 7-9 (Teams, Leagues, AI) are the most complex. If you need to cut scope, those can be simplified or pushed to a v1.1 release during the season.

---

## Getting Help

- **Claude Code** is your primary builder. Ask it anything about the code.
- **Supabase docs** — supabase.com/docs — for database, auth, and storage questions
- **Next.js docs** — nextjs.org/docs — for framework questions
- **shadcn/ui docs** — ui.shadcn.com — for component reference
- **Tailwind docs** — tailwindcss.com/docs — for styling reference
