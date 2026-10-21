# Prompt: Architect pass for the next-phase PRDs

Paste the prompt below into Claude Code from the repo root. It replaces the earlier "Next-phase product roadmap + video build" prompt, which is retired; its Duel mechanics are out of date.

The PRDs in `docs/specs/` are the source of truth. If this prompt and a PRD disagree, the PRD wins. When a PRD changes in Claude Docs, re-export it over its file here.

---

You're working in the FieldScout codebase (Next.js, Supabase, Stripe, Vercel). Read `CLAUDE.md` and `PROGRESS.md` first, and follow the existing workflow: Architect → Builder → Reviewer → Fix, branch + PR only, and update `PROGRESS.md` at the end of every session.

The product plan is in `docs/specs/`. Start with `spec-next-phase-index.md`, then read these in full before planning anything:

- `spec-duel.md`
- `spec-highlights-watch.md`
- `spec-player-profiles.md`
- `spec-manager-profiles-versus.md`

Also read the existing specs these overlap with, and note where the new PRDs supersede or extend them: `spec-youtube-highlights.md`, `spec-leagues-live-mode.md`, `spec-redraft-leagues.md`, `spec-auth-profiles.md`, `spec-player-research.md`, `spec-teams.md`.

**Do not change the product name, branding, or domains.** That's a separate decision.

## First job: Architect pass (no code yet)

Write `docs/specs/architecture-plan-next-phase.md` containing:

1. What already exists in the codebase that each PRD builds on (schema, stats pipeline, Stat Center, league and team pages, data providers).
2. Where the PRDs share infrastructure (the live stats feed, the stats warehouse, player and team tables) and how to build each shared piece once.
3. Conflicts with the existing specs and shipped code, and how you'd resolve each.
4. Gaps, contradictions or ambiguities in the PRDs, as questions for me.
5. External dependencies to confirm before building: live per-quarter stats feed and its cost, YouTube API quota, historical stats sources, history import from ESPN/Yahoo/Sleeper.
6. A milestone plan following the launch order in the index: Duel Live on single games plus highlights first, then manager profiles, Versus and player profiles, then Duel Week.

Stop after writing the doc and wait for my review. After I approve, build one milestone at a time, starting with the Duel M0 data spike.

## Guardrails

- Keep everything that already works working. Standard league play is the priority.
- Each milestone ships behind a feature flag with tests.
- Ask me before adding paid services, changing pricing, or adding anything involving real money. Duel stays free to play.
