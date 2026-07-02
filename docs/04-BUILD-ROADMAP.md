# Build Roadmap: FieldScout Fantasy Football

**Target:** Real users by fantasy draft season (late July / early August 2026)
**Builder:** Chris (product designer) + Claude Code (implementation)
**Method:** Phase-by-phase. Each phase ships something real. No dates — we move as fast as quality allows.

---

## Phase Overview

| Phase | Focus | Goal |
|-------|-------|------|
| **Phase 0** | Foundation | Working infrastructure — nothing user-facing yet |
| **Phase 1** | MVP | A usable pre-draft tool with a social layer. Real users, real use. |
| **Phase 2** | Teams | Persistent lists with a locked scoring system |
| **Phase 3** | Player Research + Scoring | Deep stat exploration with custom scoring |
| **Phase 4** | Pro Subscription | Stripe-powered Pro tier |
| **Phase 5** | Submissions + Cred + Start or Sit | Competitive layer for in-season use |
| **Phase 6** | Full Social + Explore | Rich profiles, follow graph, full discovery |
| **Phase 7** | Player Following + News Feed | Personalized player news on the home feed |
| **Phase 8** | Leagues + Live Mode | League simulation and real-time game day scoring |
| **Phase 9** | AI Features | Claude-powered research and recommendations |
| **Phase 10** | Polish + Launch | Production-ready, open registration |

---

## Phase 0: Foundation

**Goal:** Working infrastructure. No user-facing features. A deployed skeleton ready to build on.

- Foundation & Infrastructure → [specs/spec-foundation.md](specs/spec-foundation.md)
- AI Expert Personas (definitions + seeded lists) → [specs/spec-ai-expert-personas.md](specs/spec-ai-expert-personas.md)
- AI Persona Content Engine (context store + on-demand context builder) → [specs/spec-ai-content-engine.md](specs/spec-ai-content-engine.md)

---

## Phase 1: MVP

**Goal:** A usable pre-draft tool with a social layer. The north star: *"I can open FieldScout before my fantasy draft, build out my rankings, and use them as my cheat sheet while I'm on the clock."*

- Guest Experience → [specs/spec-guest-experience.md](specs/spec-guest-experience.md)
- Authentication + Profiles → [specs/spec-auth-profiles.md](specs/spec-auth-profiles.md)
- Big Board → [specs/spec-big-board.md](specs/spec-big-board.md)
- Player Lists → [specs/spec-player-lists.md](specs/spec-player-lists.md)
- Tier View → [specs/spec-tier-view.md](specs/spec-tier-view.md)
- Home Feed → [specs/spec-home-feed.md](specs/spec-home-feed.md)
- Likes + Comments → [specs/spec-social-likes-comments.md](specs/spec-social-likes-comments.md)
- Search → [specs/spec-search.md](specs/spec-search.md)
- AI List Generation ✦ Pro → [specs/spec-ai-list-generation.md](specs/spec-ai-list-generation.md)
- AI Persona Content Engine — daily ingestion + automated posts/SEO → [specs/spec-ai-content-engine.md](specs/spec-ai-content-engine.md)
- YouTube Highlights (link-out) → [specs/spec-youtube-highlights.md](specs/spec-youtube-highlights.md)

---

## Phase 2: Teams

**Goal:** Users can create a persistent fantasy team with a scoring system locked in at creation.

- Teams → [specs/spec-teams.md](specs/spec-teams.md)

---

## Phase 3: Player Research + Scoring Systems

**Goal:** Powerful stat exploration with custom scoring. Deep player data with league-specific fantasy point values.

- Player Research + Scoring Systems → [specs/spec-player-research.md](specs/spec-player-research.md)
- YouTube Highlights (embedded, Phase 2) ✦ Pro → [specs/spec-youtube-highlights.md](specs/spec-youtube-highlights.md)

---

## Phase 4: Pro Subscription

**Goal:** Stripe-powered subscription unlocking premium features.

- Pro Subscription → [specs/spec-pro-subscription.md](specs/spec-pro-subscription.md)

---

## Phase 5: Submissions + Cred + Start or Sit

**Goal:** The competitive, in-season layer. Rankings get evaluated, cred gets earned, Start or Sit drives daily engagement.

- Ranking Submissions + Cred → [specs/spec-submissions-cred.md](specs/spec-submissions-cred.md)
- Start or Sit → [specs/spec-start-or-sit.md](specs/spec-start-or-sit.md)

---

## Phase 6: Full Social + Explore

**Goal:** Rich profiles, follow graph, and full content discovery. The platform starts to feel like a community.

- Social + Explore → [specs/spec-social-explore.md](specs/spec-social-explore.md)

---

## Phase 7: Player Following + News Feed

**Goal:** Users follow individual NFL players and get a personalized stream of news and updates.

- Player Following + News Feed → [specs/spec-player-following.md](specs/spec-player-following.md)

---

## Phase 8: Leagues + Live Mode

**Goal:** Full league simulation and real-time game day scoring.

- Leagues + Live Mode → [specs/spec-leagues-live-mode.md](specs/spec-leagues-live-mode.md)

---

## Phase 9: AI Features

**Goal:** Claude-powered research assistant for lineup decisions, trades, and roster moves.

- Ask AI → [specs/spec-ask-ai.md](specs/spec-ask-ai.md)

---

## Phase 10: Polish + Launch

**Goal:** Production-ready. Open registration. Real users.

1. Performance audit — Lighthouse scores, Core Web Vitals
2. Mobile polish — test every flow on real mobile devices
3. Error handling — graceful errors everywhere, no blank screens
4. Loading states — skeleton screens for all data-heavy pages
5. SEO finalization — full sitemap, robots.txt, structured data
6. Analytics — PostHog events on all key actions
7. Error tracking — Sentry integration
8. Email flows — welcome email, weekly digest
9. Landing page — marketing page for logged-out users
10. Domain setup — fieldscout.gg pointed to Vercel
11. Beta testing — invite 20–50 users for feedback
12. Bug fixes from beta
13. Launch — open registration, share on Twitter/Reddit/fantasy communities

---

## How to Work With Claude Code

1. Open a spec file for the feature you're building
2. Open Claude Code in the `FieldScout/` directory
3. Paste the spec as context — Claude Code will implement the tasks
4. Review the output, test in browser, iterate
5. Use Figma MCP to pull design specs for pixel-perfect components
6. Commit and deploy — Vercel auto-deploys on push

> **Tip:** Hand Claude Code one spec file at a time. Smaller, focused context = better output.
