# Data Model: FieldScout Fantasy Football

**Version:** 1.0
**Date:** March 29, 2026

---

## Overview

All tables live in Supabase (PostgreSQL). Row-Level Security (RLS) is enabled on every table. Types are auto-generated from the schema using the Supabase CLI (`supabase gen types typescript`).

**Expert profiles and lists:** Expert profiles do not use Supabase Auth — they are application-level records. Their ranking lists (Big Board + position lists) are stored in the `lists` table but are owned by a special system account (`system_expert_owner_id`) until claimed. When claimed, ownership transfers to the expert's real FieldScout profile. This means the expert's lists participate in the consensus ranking system just like any user's lists.

**Phase 0 → Phase 1 player matching:** AI-generated expert rankings (Phase 0) store player names as plain text strings inside JSONB (e.g., `"Patrick Mahomes, QB, KC"`). The `list_players` table requires a real `player_id` foreign key referencing the `players` table, which is populated from the Sleeper API in Phase 1. During Phase 1, run a one-time matching script (`scripts/match-expert-players.ts`) that resolves each text name in every AI-generated ranking to a Sleeper player ID, then inserts the matched rows into `list_players`. Unmatched names should be logged for manual review. After this pass, expert lists are fully integrated into the consensus system.

**Persona system tables:** The AI persona tables (`ai_personas`, `persona_source_rankings`) and the persona content-engine tables (`persona_sources`, `persona_content_items`, `persona_context`, `persona_context_versions`, `persona_posts`) are defined in their specs ([spec-ai-expert-personas.md](specs/spec-ai-expert-personas.md), [spec-ai-content-engine.md](specs/spec-ai-content-engine.md)) rather than duplicated here. All are service-role-managed (no client policies) except published `persona_posts`, which are publicly readable.

---

## Tables

### profiles

Extends Supabase `auth.users`. Created automatically via a database trigger on signup.

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  -- display_name: GONE. Retired by migration 075 (ruling 2026-08-05), DROPPED by
  -- migration 077. FieldScout stores NO name for a person; the username is the
  -- identity. Do not reintroduce a name field.
  avatar_url TEXT,
  bio TEXT CHECK (char_length(bio) <= 280),
  cred_score NUMERIC DEFAULT 0,
  cred_rank INTEGER,                          -- Calculated: rank among all users
  is_pro BOOLEAN DEFAULT FALSE,
  stripe_customer_id TEXT,
  subscription_status TEXT DEFAULT 'free',     -- 'free', 'active', 'canceled', 'past_due'
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX idx_profiles_username ON profiles(username);
CREATE INDEX idx_profiles_cred_score ON profiles(cred_score DESC);

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read profiles
CREATE POLICY "Profiles are viewable by everyone"
  ON profiles FOR SELECT USING (true);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);
```

---

### follows

```sql
CREATE TABLE follows (
  follower_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id != following_id)
);

-- Indexes
CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);

-- RLS
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Follows are viewable by everyone"
  ON follows FOR SELECT USING (true);

CREATE POLICY "Users can manage own follows"
  ON follows FOR ALL USING (auth.uid() = follower_id);
```

---

### players

NFL player data synced from external API. Users never modify this table directly.

```sql
CREATE TABLE players (
  id TEXT PRIMARY KEY,                        -- External API player ID
  full_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  position TEXT NOT NULL,                     -- QB, RB, WR, TE, K, DEF
  team TEXT,                                  -- NFL team abbreviation (e.g., 'KC', 'SF')
  jersey_number INTEGER,
  headshot_url TEXT,
  status TEXT DEFAULT 'active',               -- active, injured, suspended, free_agent
  experience_years INTEGER DEFAULT 0,
  draft_year INTEGER,
  draft_round INTEGER,
  draft_pick INTEGER,
  height TEXT,
  weight INTEGER,
  birth_date DATE,
  college TEXT,
  bye_week INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_players_position ON players(position);
CREATE INDEX idx_players_team ON players(team);
CREATE INDEX idx_players_name ON players(full_name);

-- RLS (read-only for everyone — anonymous access required for guest experience)
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players are viewable by everyone"
  ON players FOR SELECT USING (true);
```

---

### nfl_games

NFL game schedule and live game state. Populated by `sync-stats` cron pre-season, updated by `sync-live-stats` every 30 seconds during active windows.

```sql
CREATE TABLE nfl_games (
  id TEXT PRIMARY KEY,                        -- External API game ID
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  game_type TEXT DEFAULT 'regular',           -- 'regular', 'wildcard', 'divisional', 'championship', 'superbowl'
  home_team TEXT NOT NULL,                    -- NFL team abbreviation
  away_team TEXT NOT NULL,
  kickoff_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'scheduled',            -- 'scheduled', 'in_progress', 'halftime', 'final', 'cancelled', 'postponed'
  quarter INTEGER,                            -- 1-4, or 5 for OT; NULL if not started or final
  game_clock TEXT,                            -- e.g., '4:32' (minutes:seconds remaining); NULL if not live
  home_score INTEGER DEFAULT 0,
  away_score INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_nfl_games_season_week ON nfl_games(season, week);
CREATE INDEX idx_nfl_games_status ON nfl_games(status);
CREATE INDEX idx_nfl_games_kickoff ON nfl_games(kickoff_at);

-- Helper view: is there currently an active game window?
CREATE OR REPLACE VIEW active_game_window AS
  SELECT EXISTS (
    SELECT 1 FROM nfl_games
    WHERE status = 'in_progress'
       OR (status = 'scheduled' AND kickoff_at BETWEEN NOW() - INTERVAL '15 minutes' AND NOW() + INTERVAL '15 minutes')
  ) AS is_active;

ALTER TABLE nfl_games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Games are viewable by authenticated users"
  ON nfl_games FOR SELECT USING (auth.role() = 'authenticated');
```

---

### player_stats

Weekly and season stat lines for each player. During active game windows, the `sync-live-stats` cron updates the row for the current week with in-progress totals. Supabase Realtime broadcasts these updates to Live Mode clients.

```sql
CREATE TABLE player_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,                    -- e.g., 2026
  week INTEGER,                               -- NULL for season totals, 1-18 for weekly
  stat_type TEXT NOT NULL DEFAULT 'weekly',    -- 'weekly', 'season'
  game_id TEXT REFERENCES nfl_games(id),      -- NULL for season totals
  is_live BOOLEAN DEFAULT FALSE,              -- TRUE while the game is in-progress; FALSE once final

  -- Passing
  pass_attempts INTEGER DEFAULT 0,
  pass_completions INTEGER DEFAULT 0,
  pass_yards INTEGER DEFAULT 0,
  pass_tds INTEGER DEFAULT 0,
  interceptions INTEGER DEFAULT 0,
  sacks_taken INTEGER DEFAULT 0,

  -- Rushing
  rush_attempts INTEGER DEFAULT 0,
  rush_yards INTEGER DEFAULT 0,
  rush_tds INTEGER DEFAULT 0,
  fumbles_lost INTEGER DEFAULT 0,

  -- Receiving
  targets INTEGER DEFAULT 0,
  receptions INTEGER DEFAULT 0,
  receiving_yards INTEGER DEFAULT 0,
  receiving_tds INTEGER DEFAULT 0,

  -- Kicking
  fg_made INTEGER DEFAULT 0,
  fg_attempted INTEGER DEFAULT 0,
  fg_made_40_plus INTEGER DEFAULT 0,
  fg_made_50_plus INTEGER DEFAULT 0,
  xp_made INTEGER DEFAULT 0,
  xp_attempted INTEGER DEFAULT 0,

  -- Defense (team defense)
  def_sacks NUMERIC DEFAULT 0,
  def_interceptions INTEGER DEFAULT 0,
  def_fumble_recoveries INTEGER DEFAULT 0,
  def_tds INTEGER DEFAULT 0,
  def_safeties INTEGER DEFAULT 0,
  def_points_allowed INTEGER DEFAULT 0,

  -- General
  two_point_conversions INTEGER DEFAULT 0,

  -- Live game context (populated during in-progress games, NULL otherwise)
  game_quarter INTEGER,                       -- 1-4, 5 for OT
  game_clock TEXT,                            -- '4:32' (minutes remaining in quarter)
  player_game_status TEXT,                    -- 'active', 'questionable', 'out', 'dnp'

  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(player_id, season, week)
);

-- Indexes
CREATE INDEX idx_player_stats_player ON player_stats(player_id);
CREATE INDEX idx_player_stats_season_week ON player_stats(season, week);
CREATE INDEX idx_player_stats_live ON player_stats(is_live) WHERE is_live = TRUE;  -- Fast lookup for Live Mode

-- RLS
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Stats are viewable by authenticated users"
  ON player_stats FOR SELECT USING (auth.role() = 'authenticated');
```

---

### scoring_systems

```sql
CREATE TABLE scoring_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,  -- NULL for system defaults
  is_system_default BOOLEAN DEFAULT FALSE,
  rules JSONB NOT NULL,
  /*
    Example rules JSONB:
    {
      "pass_yards": 0.04,       -- 1 point per 25 yards
      "pass_tds": 4,
      "interceptions": -2,
      "rush_yards": 0.1,        -- 1 point per 10 yards
      "rush_tds": 6,
      "receptions": 1,          -- PPR
      "receiving_yards": 0.1,
      "receiving_tds": 6,
      "fumbles_lost": -2,
      "two_point_conversions": 2,
      "fg_made": 3,
      "fg_made_40_plus": 4,
      "fg_made_50_plus": 5,
      "xp_made": 1,
      "def_sacks": 1,
      "def_interceptions": 2,
      "def_fumble_recoveries": 2,
      "def_tds": 6,
      "def_safeties": 2,
      "def_points_allowed_0": 10,
      "def_points_allowed_1_6": 7,
      "def_points_allowed_7_13": 4,
      "def_points_allowed_14_20": 1,
      "def_points_allowed_21_27": 0,
      "def_points_allowed_28_34": -1,
      "def_points_allowed_35_plus": -4
    }
  */
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE scoring_systems ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System defaults are viewable by everyone"
  ON scoring_systems FOR SELECT USING (is_system_default = TRUE);

CREATE POLICY "Users can view own scoring systems"
  ON scoring_systems FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can manage own scoring systems"
  ON scoring_systems FOR ALL USING (auth.uid() = owner_id);
```

---

### lists

The core entity of the app.

```sql
CREATE TABLE lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL,                         -- URL-safe version of title
  position_filter TEXT,                       -- NULL = all positions, or 'QB', 'RB', etc.
  hide_order BOOLEAN DEFAULT FALSE,           -- If TRUE, list is marked "unranked" — order carries no meaning. FALSE by default (all lists are ordered).
  tiers_enabled BOOLEAN DEFAULT FALSE,        -- If TRUE, players are grouped into S/A/B/C/D/F tiers on top of their order.
  is_private BOOLEAN DEFAULT FALSE,
  is_team BOOLEAN DEFAULT FALSE,              -- Has this list been converted to a team?
  is_big_board BOOLEAN DEFAULT FALSE,         -- TRUE for the user's permanent top-100 Big Board
  comments_enabled BOOLEAN DEFAULT TRUE,      -- Owner can turn off comments
  like_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  player_count INTEGER DEFAULT 0,
  scoring_system_id UUID REFERENCES scoring_systems(id),
  deleted_at TIMESTAMPTZ,                     -- Soft delete (NULL for Big Board — never deleted)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(owner_id, slug),
  -- Only one Big Board per user
  UNIQUE NULLS NOT DISTINCT (owner_id, is_big_board) WHERE is_big_board = TRUE
);

-- Indexes
CREATE INDEX idx_lists_owner ON lists(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_lists_public ON lists(is_private, deleted_at) WHERE is_private = FALSE AND deleted_at IS NULL;
CREATE INDEX idx_lists_trending ON lists(like_count DESC, view_count DESC) WHERE is_private = FALSE AND deleted_at IS NULL;

-- RLS
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public lists are viewable by everyone"
  ON lists FOR SELECT USING (
    (is_private = FALSE AND deleted_at IS NULL)
    OR auth.uid() = owner_id
  );

CREATE POLICY "Users can manage own lists"
  ON lists FOR ALL USING (auth.uid() = owner_id);
```

---

### list_players

Junction table between lists and players, with ranking data.

```sql
CREATE TABLE list_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE NOT NULL,
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  tier INTEGER,                               -- NULL if unranked list, 1+ for ranked
  rank_in_tier INTEGER,                       -- Position within tier (for granular ordering)
  overall_rank INTEGER,                       -- Computed overall rank (tier * 100 + rank_in_tier)
  notes TEXT,                                 -- User's notes on why they ranked this player here
  added_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(list_id, player_id)                  -- Each player only once per list
);

-- Indexes
CREATE INDEX idx_list_players_list ON list_players(list_id);
CREATE INDEX idx_list_players_player ON list_players(player_id);
CREATE INDEX idx_list_players_rank ON list_players(list_id, overall_rank);

-- RLS (inherits from lists — if you can see the list, you can see its players)
ALTER TABLE list_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "List players follow list visibility"
  ON list_players FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = list_players.list_id
      AND (lists.is_private = FALSE OR lists.owner_id = auth.uid())
      AND lists.deleted_at IS NULL
    )
  );

CREATE POLICY "Users can manage players in own lists"
  ON list_players FOR ALL USING (
    EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = list_players.list_id
      AND lists.owner_id = auth.uid()
    )
  );
```

---

### list_likes

```sql
CREATE TABLE list_likes (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, list_id)
);

-- RLS
ALTER TABLE list_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Likes are viewable by everyone"
  ON list_likes FOR SELECT USING (true);

CREATE POLICY "Users can manage own likes"
  ON list_likes FOR ALL USING (auth.uid() = user_id);
```

---

### tags

```sql
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,                  -- Display name (e.g., "Week 3", "Sleepers")
  slug TEXT NOT NULL UNIQUE,                  -- URL-safe (e.g., "week-3", "sleepers")
  is_system_tag BOOLEAN DEFAULT FALSE,        -- TRUE for FieldScout-provided tags
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- NULL for system tags
  use_count INTEGER DEFAULT 0,                -- How many lists use this tag (denormalized for speed)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed system tags in migration (Sleepers, Busts, Rookies, Week 1-18, etc.)
CREATE INDEX idx_tags_slug ON tags(slug);
CREATE INDEX idx_tags_trending ON tags(use_count DESC);

-- RLS: Tags are publicly visible, only system can create system tags
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tags are viewable by everyone"
  ON tags FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create custom tags"
  ON tags FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND is_system_tag = FALSE
    AND auth.uid() = created_by
  );
```

---

### list_tags

```sql
CREATE TABLE list_tags (
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (list_id, tag_id)
);

-- Max 5 tags per list enforced at the API layer (not DB constraint for flexibility)
CREATE INDEX idx_list_tags_list ON list_tags(list_id);
CREATE INDEX idx_list_tags_tag ON list_tags(tag_id);

-- RLS: follows list visibility
ALTER TABLE list_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "List tags follow list visibility"
  ON list_tags FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = list_tags.list_id
      AND (lists.is_private = FALSE OR lists.owner_id = auth.uid())
      AND lists.deleted_at IS NULL
    )
  );

CREATE POLICY "List owners can manage tags on their lists"
  ON list_tags FOR ALL USING (
    EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = list_tags.list_id
      AND lists.owner_id = auth.uid()
    )
  );

-- Trigger to keep tags.use_count in sync
CREATE OR REPLACE FUNCTION update_tag_use_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tags SET use_count = use_count + 1 WHERE id = NEW.tag_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE tags SET use_count = use_count - 1 WHERE id = OLD.tag_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_list_tag_change
  AFTER INSERT OR DELETE ON list_tags
  FOR EACH ROW EXECUTE FUNCTION update_tag_use_count();
```

---

### list_comments

```sql
CREATE TABLE list_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) <= 500),
  parent_comment_id UUID REFERENCES list_comments(id) ON DELETE CASCADE,  -- NULL for top-level
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_list_comments_list ON list_comments(list_id, created_at) WHERE deleted_at IS NULL;

ALTER TABLE list_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Comments on public lists are viewable by everyone"
  ON list_comments FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = list_comments.list_id
      AND lists.is_private = FALSE
      AND lists.comments_enabled = TRUE
      AND lists.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM lists WHERE lists.id = list_comments.list_id AND lists.owner_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can comment on lists with comments enabled"
  ON list_comments FOR INSERT WITH CHECK (
    auth.uid() = author_id
    AND EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = list_comments.list_id
      AND lists.comments_enabled = TRUE
      AND lists.deleted_at IS NULL
      AND (lists.is_private = FALSE OR lists.owner_id = auth.uid())
    )
  );

CREATE POLICY "Authors can soft-delete own comments"
  ON list_comments FOR UPDATE USING (auth.uid() = author_id);

CREATE POLICY "List owners can soft-delete any comment on their list"
  ON list_comments FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM lists WHERE lists.id = list_comments.list_id AND lists.owner_id = auth.uid()
    )
  );
```

---

### start_sit_questions

```sql
CREATE TABLE start_sit_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poster_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  player_a_id TEXT REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  player_b_id TEXT REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  context_note TEXT CHECK (char_length(context_note) <= 280),   -- e.g., "PPR, need 20+ points"
  scoring_system_id UUID REFERENCES scoring_systems(id),
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  vote_count_a INTEGER DEFAULT 0,                -- Votes for player A (denormalized)
  vote_count_b INTEGER DEFAULT 0,                -- Votes for player B (denormalized)
  correct_player TEXT,                           -- 'a', 'b', or NULL if unresolved/voided
  is_voided BOOLEAN DEFAULT FALSE,               -- TRUE if game cancelled or player DNP
  resolved_at TIMESTAMPTZ,                       -- Set after games complete
  voting_closes_at TIMESTAMPTZ NOT NULL,         -- Set to Sunday 1pm ET of the relevant week
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CHECK (player_a_id != player_b_id)
);

-- Indexes
CREATE INDEX idx_sos_week ON start_sit_questions(season, week, created_at DESC);
CREATE INDEX idx_sos_poster ON start_sit_questions(poster_id);
CREATE INDEX idx_sos_unresolved ON start_sit_questions(resolved_at) WHERE resolved_at IS NULL AND is_voided = FALSE;
CREATE INDEX idx_sos_trending ON start_sit_questions(vote_count_a + vote_count_b DESC) WHERE resolved_at IS NULL;

-- RLS
ALTER TABLE start_sit_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Start or Sit questions are public"
  ON start_sit_questions FOR SELECT USING (true);

CREATE POLICY "Authenticated users can post questions"
  ON start_sit_questions FOR INSERT WITH CHECK (auth.uid() = poster_id);

CREATE POLICY "Posters can update their own questions (before voting closes)"
  ON start_sit_questions FOR UPDATE USING (
    auth.uid() = poster_id
    AND voting_closes_at > NOW()
  );
```

---

### start_sit_votes

```sql
CREATE TABLE start_sit_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID REFERENCES start_sit_questions(id) ON DELETE CASCADE NOT NULL,
  voter_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  voted_for TEXT NOT NULL CHECK (voted_for IN ('a', 'b')),
  is_correct BOOLEAN,                            -- NULL until resolved, then TRUE/FALSE
  cred_points_earned NUMERIC DEFAULT 0,          -- Filled in after resolution
  voted_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(question_id, voter_id)                  -- One vote per user per question
);

-- Indexes
CREATE INDEX idx_sos_votes_question ON start_sit_votes(question_id);
CREATE INDEX idx_sos_votes_voter ON start_sit_votes(voter_id);
CREATE INDEX idx_sos_votes_leaderboard ON start_sit_votes(voter_id, is_correct, cred_points_earned DESC);

-- RLS
ALTER TABLE start_sit_votes ENABLE ROW LEVEL SECURITY;

-- Users can see vote totals (but not who voted for who, before question resolves)
CREATE POLICY "Vote totals are public after question resolves"
  ON start_sit_votes FOR SELECT USING (
    -- After resolution: fully public
    EXISTS (SELECT 1 FROM start_sit_questions WHERE id = start_sit_votes.question_id AND resolved_at IS NOT NULL)
    -- Or user viewing their own vote (always)
    OR auth.uid() = voter_id
  );

CREATE POLICY "Users can cast their own vote"
  ON start_sit_votes FOR INSERT WITH CHECK (
    auth.uid() = voter_id
    -- Cannot vote on own question
    AND NOT EXISTS (
      SELECT 1 FROM start_sit_questions
      WHERE id = start_sit_votes.question_id
      AND poster_id = auth.uid()
    )
    -- Voting window must be open
    AND EXISTS (
      SELECT 1 FROM start_sit_questions
      WHERE id = start_sit_votes.question_id
      AND voting_closes_at > NOW()
      AND resolved_at IS NULL
      AND is_voided = FALSE
    )
  );
```

---

### expert_profiles

Fantasy football analyst/influencer profiles. Unclaimed rows are AI-generated and clearly labeled. Once claimed, the real person takes control.

```sql
CREATE TABLE expert_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,                    -- URL-safe name: 'matthew-berry'
  display_name TEXT NOT NULL,                   -- 'Matthew Berry'
  employer TEXT,                                -- 'ESPN', 'NFL Network', 'Independent', etc.
  bio TEXT,
  avatar_url TEXT,
  twitter_handle TEXT,                          -- Without the @ sign
  youtube_url TEXT,
  podcast_name TEXT,
  podcast_url TEXT,
  website_url TEXT,

  -- Claim status
  is_claimed BOOLEAN DEFAULT FALSE,
  claimed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- The FieldScout profile that claimed this
  claimed_at TIMESTAMPTZ,

  -- Content labeling
  is_ai_generated BOOLEAN DEFAULT TRUE,         -- TRUE until claimed; AI label shown prominently
  ai_generated_disclaimer TEXT DEFAULT 'Rankings on this profile are AI-generated based on this expert''s publicly known opinions and historical analysis. They are not official rankings from this person.',

  -- Engagement
  follower_count INTEGER DEFAULT 0,

  -- Metadata
  last_rankings_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX idx_expert_profiles_slug ON expert_profiles(slug);
CREATE INDEX idx_expert_profiles_claimed ON expert_profiles(is_claimed);
CREATE INDEX idx_expert_profiles_followers ON expert_profiles(follower_count DESC);

-- RLS: Expert profiles are fully public
ALTER TABLE expert_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Expert profiles are viewable by everyone"
  ON expert_profiles FOR SELECT USING (true);

-- Only service role (used by AI generation scripts) can insert/update unclaimed profiles
-- Claimed experts can update their own profile via the application
CREATE POLICY "Claimed experts can update their profile"
  ON expert_profiles FOR UPDATE USING (
    is_claimed = TRUE
    AND claimed_by = auth.uid()
  );
```

---

### expert_follows

Separate follow relationship for expert profiles (distinct from user-to-user follows since experts may not have FieldScout accounts).

```sql
CREATE TABLE expert_follows (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  expert_id UUID REFERENCES expert_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, expert_id)
);

CREATE INDEX idx_expert_follows_user ON expert_follows(user_id);
CREATE INDEX idx_expert_follows_expert ON expert_follows(expert_id);

ALTER TABLE expert_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Expert follows are viewable by everyone"
  ON expert_follows FOR SELECT USING (true);

CREATE POLICY "Users can manage own expert follows"
  ON expert_follows FOR ALL USING (auth.uid() = user_id);

-- Trigger to keep follower_count in sync
CREATE OR REPLACE FUNCTION update_expert_follower_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE expert_profiles SET follower_count = follower_count + 1 WHERE id = NEW.expert_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE expert_profiles SET follower_count = follower_count - 1 WHERE id = OLD.expert_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_expert_follow_change
  AFTER INSERT OR DELETE ON expert_follows
  FOR EACH ROW EXECUTE FUNCTION update_expert_follower_count();
```

---

### expert_claim_requests

Tracks profile claim verification requests.

```sql
CREATE TABLE expert_claim_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id UUID REFERENCES expert_profiles(id) ON DELETE CASCADE NOT NULL,
  requester_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  verification_method TEXT NOT NULL CHECK (verification_method IN ('twitter_oauth', 'email', 'manual_review')),

  -- Twitter OAuth verification
  twitter_verified_handle TEXT,               -- The handle verified via OAuth

  -- Email verification
  email_sent_to TEXT,
  email_token TEXT,                           -- Hashed verification token
  email_token_expires_at TIMESTAMPTZ,

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES profiles(id),   -- Admin who reviewed (for manual review)
  review_note TEXT,

  requested_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_expert_claims_expert ON expert_claim_requests(expert_id);
CREATE INDEX idx_expert_claims_requester ON expert_claim_requests(requester_id);
CREATE INDEX idx_expert_claims_pending ON expert_claim_requests(status) WHERE status = 'pending';

ALTER TABLE expert_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own claim requests"
  ON expert_claim_requests FOR SELECT USING (auth.uid() = requester_id);

CREATE POLICY "Users can submit claim requests"
  ON expert_claim_requests FOR INSERT WITH CHECK (auth.uid() = requester_id);
```

---

### ranking_history

Tracks how a player's rank changes over time within a list (for trending).

```sql
CREATE TABLE ranking_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE,
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
  old_rank INTEGER,
  new_rank INTEGER,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ranking_history_list_player ON ranking_history(list_id, player_id);
```

---

### weekly_rankings

Users submit position rankings each week during the NFL season.

```sql
CREATE TABLE weekly_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  position TEXT NOT NULL,                     -- QB, RB, WR, TE
  rankings JSONB NOT NULL,
  /*
    Example:
    [
      {"player_id": "abc123", "rank": 1},
      {"player_id": "def456", "rank": 2},
      ...
    ]
  */
  accuracy_score NUMERIC,                     -- Filled in after games complete
  cred_points_earned NUMERIC,                 -- Filled in after calculation
  submitted_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, season, week, position)
);

-- Indexes
CREATE INDEX idx_weekly_rankings_user ON weekly_rankings(user_id);
CREATE INDEX idx_weekly_rankings_week ON weekly_rankings(season, week);
CREATE INDEX idx_weekly_rankings_leaderboard ON weekly_rankings(season, week, position, accuracy_score DESC);

-- RLS
ALTER TABLE weekly_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Weekly rankings are viewable by everyone"
  ON weekly_rankings FOR SELECT USING (true);

CREATE POLICY "Users can manage own weekly rankings"
  ON weekly_rankings FOR ALL USING (auth.uid() = user_id);
```

---

### cred_scores

Aggregated cred data per user per season.

```sql
CREATE TABLE cred_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  season INTEGER NOT NULL,
  total_cred NUMERIC DEFAULT 0,
  weeks_submitted INTEGER DEFAULT 0,
  average_accuracy NUMERIC DEFAULT 0,
  best_week INTEGER,
  best_week_score NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, season)
);

-- RLS
ALTER TABLE cred_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cred scores are viewable by everyone"
  ON cred_scores FOR SELECT USING (true);
```

---

### teams

```sql
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  list_id UUID REFERENCES lists(id) NOT NULL,  -- The list this team was created from
  name TEXT NOT NULL,
  scoring_system_id UUID REFERENCES scoring_systems(id),
  league_id UUID REFERENCES leagues(id),        -- NULL if not in a league
  total_points NUMERIC DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teams are viewable by everyone"
  ON teams FOR SELECT USING (true);

CREATE POLICY "Users can manage own teams"
  ON teams FOR ALL USING (auth.uid() = owner_id);
```

---

### team_lineups

Weekly lineup decisions (starters vs bench).

```sql
CREATE TABLE team_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  starters JSONB NOT NULL,                    -- Array of player_ids in starting slots
  bench JSONB NOT NULL,                       -- Array of player_ids on bench
  total_points NUMERIC,                       -- Calculated after games
  set_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(team_id, season, week)
);

-- RLS
ALTER TABLE team_lineups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lineups follow team visibility"
  ON team_lineups FOR SELECT USING (true);

CREATE POLICY "Users can manage own team lineups"
  ON team_lineups FOR ALL USING (
    EXISTS (
      SELECT 1 FROM teams WHERE teams.id = team_lineups.team_id AND teams.owner_id = auth.uid()
    )
  );
```

---

### leagues

```sql
CREATE TABLE leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  max_teams INTEGER NOT NULL DEFAULT 12,
  scoring_system_id UUID REFERENCES scoring_systems(id),
  roster_settings JSONB NOT NULL DEFAULT '{
    "qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "k": 1, "def": 1, "bench": 6
  }',
  invite_code TEXT UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  season INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leagues are viewable by members"
  ON leagues FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM teams WHERE teams.league_id = leagues.id AND teams.owner_id = auth.uid()
    )
    OR owner_id = auth.uid()
  );

CREATE POLICY "League owners can manage"
  ON leagues FOR ALL USING (auth.uid() = owner_id);
```

---

### league_chat

```sql
CREATE TABLE league_chat (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_league_chat_league ON league_chat(league_id, created_at DESC);

-- RLS
ALTER TABLE league_chat ENABLE ROW LEVEL SECURITY;

CREATE POLICY "League members can view chat"
  ON league_chat FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM teams WHERE teams.league_id = league_chat.league_id AND teams.owner_id = auth.uid()
    )
  );

CREATE POLICY "League members can send messages"
  ON league_chat FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM teams WHERE teams.league_id = league_chat.league_id AND teams.owner_id = auth.uid()
    )
  );
```

---

### notifications

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,          -- 'follow', 'list_like', 'list_comment', 'cred_awarded', 'start_sit_resolved', 'league_invite', 'trade_proposal'
  title TEXT NOT NULL,
  body TEXT,
  data JSONB,                  -- Contextual data (e.g., { "list_id": "...", "from_user": "..." })
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at DESC);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE USING (auth.uid() = user_id);
```

---

## Materialized Views

### consensus_rankings

Refreshed every 30 minutes via cron.

```sql
CREATE MATERIALIZED VIEW consensus_rankings AS
SELECT
  lp.player_id,
  p.full_name,
  p.position,
  p.team,
  COUNT(DISTINCT l.owner_id) AS ranker_count,
  AVG(lp.overall_rank) AS average_rank,
  -- Weighted average: users with higher cred have more influence
  SUM(lp.overall_rank * GREATEST(pr.cred_score, 1)) / SUM(GREATEST(pr.cred_score, 1)) AS weighted_rank,
  RANK() OVER (PARTITION BY p.position ORDER BY SUM(lp.overall_rank * GREATEST(pr.cred_score, 1)) / SUM(GREATEST(pr.cred_score, 1))) AS consensus_position_rank
FROM list_players lp
JOIN lists l ON l.id = lp.list_id
JOIN players p ON p.id = lp.player_id
JOIN profiles pr ON pr.id = l.owner_id
WHERE l.hide_order = FALSE
  AND l.is_private = FALSE
  AND l.deleted_at IS NULL
  AND lp.overall_rank IS NOT NULL
GROUP BY lp.player_id, p.full_name, p.position, p.team;

CREATE UNIQUE INDEX idx_consensus_player ON consensus_rankings(player_id);
CREATE INDEX idx_consensus_position ON consensus_rankings(position, consensus_position_rank);
```

---

## Database Functions

### Auto-create profile on signup

```sql
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_user_id UUID := NEW.id;
  new_username TEXT := NEW.raw_user_meta_data->>'username';
BEGIN
  -- Create the user profile. No name column is written: FieldScout stores no
  -- name for a person (ruling 2026-08-05, migration 075), so the OAuth
  -- `full_name` claim is deliberately ignored.
  INSERT INTO profiles (id, username, avatar_url)
  VALUES (
    new_user_id,
    new_username,
    NEW.raw_user_meta_data->>'avatar_url'
  );

  -- Auto-create the user's permanent Big Board
  INSERT INTO lists (
    owner_id,
    title,
    slug,
    is_ranked,
    is_big_board,
    is_private,
    comments_enabled
  ) VALUES (
    new_user_id,
    'My Big Board',
    'big-board',
    TRUE,
    TRUE,
    FALSE,       -- Big Board is always public
    TRUE
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

### Update follower counts

```sql
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET follower_count = follower_count + 1 WHERE id = NEW.following_id;
    UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET follower_count = follower_count - 1 WHERE id = OLD.following_id;
    UPDATE profiles SET following_count = following_count - 1 WHERE id = OLD.follower_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_follow_change
  AFTER INSERT OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION update_follow_counts();
```

### Update list player count

```sql
CREATE OR REPLACE FUNCTION update_list_player_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE lists SET player_count = player_count + 1, updated_at = NOW() WHERE id = NEW.list_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE lists SET player_count = player_count - 1, updated_at = NOW() WHERE id = OLD.list_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_list_player_change
  AFTER INSERT OR DELETE ON list_players
  FOR EACH ROW EXECUTE FUNCTION update_list_player_count();
```
