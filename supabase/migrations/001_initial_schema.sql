-- ============================================================================
-- FieldScout Fantasy Football — Initial Schema
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles
-- Extends Supabase auth.users. Created automatically via trigger on signup.
-- ----------------------------------------------------------------------------
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT CHECK (char_length(bio) <= 280),
  cred_score NUMERIC DEFAULT 0,
  cred_rank INTEGER,
  is_pro BOOLEAN DEFAULT FALSE,
  stripe_customer_id TEXT,
  subscription_status TEXT DEFAULT 'free',
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_profiles_username ON profiles(username);
CREATE INDEX idx_profiles_cred_score ON profiles(cred_score DESC);

-- ----------------------------------------------------------------------------
-- follows
-- ----------------------------------------------------------------------------
CREATE TABLE follows (
  follower_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id != following_id)
);

CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);

-- ----------------------------------------------------------------------------
-- players
-- NFL player data synced from external API. Read-only for application.
-- ----------------------------------------------------------------------------
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  position TEXT NOT NULL,
  team TEXT,
  jersey_number INTEGER,
  headshot_url TEXT,
  status TEXT DEFAULT 'active',
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

CREATE INDEX idx_players_position ON players(position);
CREATE INDEX idx_players_team ON players(team);
CREATE INDEX idx_players_name ON players(full_name);

-- ----------------------------------------------------------------------------
-- nfl_games
-- NFL game schedule and live game state.
-- ----------------------------------------------------------------------------
CREATE TABLE nfl_games (
  id TEXT PRIMARY KEY,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  game_type TEXT DEFAULT 'regular',
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  kickoff_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'scheduled',
  quarter INTEGER,
  game_clock TEXT,
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

-- ----------------------------------------------------------------------------
-- player_stats
-- Weekly and season stat lines for each player.
-- ----------------------------------------------------------------------------
CREATE TABLE player_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  week INTEGER,
  stat_type TEXT NOT NULL DEFAULT 'weekly',
  game_id TEXT REFERENCES nfl_games(id),
  is_live BOOLEAN DEFAULT FALSE,

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

  -- Live game context
  game_quarter INTEGER,
  game_clock TEXT,
  player_game_status TEXT,

  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(player_id, season, week)
);

CREATE INDEX idx_player_stats_player ON player_stats(player_id);
CREATE INDEX idx_player_stats_season_week ON player_stats(season, week);
CREATE INDEX idx_player_stats_live ON player_stats(is_live) WHERE is_live = TRUE;

-- ----------------------------------------------------------------------------
-- scoring_systems
-- ----------------------------------------------------------------------------
CREATE TABLE scoring_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  is_system_default BOOLEAN DEFAULT FALSE,
  rules JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- lists
-- The core entity of the app.
-- ----------------------------------------------------------------------------
CREATE TABLE lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL,
  position_filter TEXT,
  hide_order BOOLEAN DEFAULT FALSE,
  tiers_enabled BOOLEAN DEFAULT FALSE,
  is_private BOOLEAN DEFAULT FALSE,
  is_team BOOLEAN DEFAULT FALSE,
  is_big_board BOOLEAN DEFAULT FALSE,
  comments_enabled BOOLEAN DEFAULT TRUE,
  like_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  player_count INTEGER DEFAULT 0,
  scoring_system_id UUID REFERENCES scoring_systems(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(owner_id, slug)
);

-- Partial unique index: only one Big Board per user
CREATE UNIQUE INDEX idx_lists_one_big_board_per_user
  ON lists(owner_id) WHERE is_big_board = TRUE;

CREATE INDEX idx_lists_owner ON lists(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_lists_public ON lists(is_private, deleted_at) WHERE is_private = FALSE AND deleted_at IS NULL;
CREATE INDEX idx_lists_trending ON lists(like_count DESC, view_count DESC) WHERE is_private = FALSE AND deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- list_players
-- Junction table between lists and players, with ranking data.
-- ----------------------------------------------------------------------------
CREATE TABLE list_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE NOT NULL,
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  tier INTEGER,
  rank_in_tier INTEGER,
  overall_rank INTEGER,
  notes TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(list_id, player_id)
);

CREATE INDEX idx_list_players_list ON list_players(list_id);
CREATE INDEX idx_list_players_player ON list_players(player_id);
CREATE INDEX idx_list_players_rank ON list_players(list_id, overall_rank);

-- ----------------------------------------------------------------------------
-- list_likes
-- ----------------------------------------------------------------------------
CREATE TABLE list_likes (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, list_id)
);

-- ----------------------------------------------------------------------------
-- tags
-- ----------------------------------------------------------------------------
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  is_system_tag BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  use_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tags_slug ON tags(slug);
CREATE INDEX idx_tags_trending ON tags(use_count DESC);

-- ----------------------------------------------------------------------------
-- list_tags
-- ----------------------------------------------------------------------------
CREATE TABLE list_tags (
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (list_id, tag_id)
);

CREATE INDEX idx_list_tags_list ON list_tags(list_id);
CREATE INDEX idx_list_tags_tag ON list_tags(tag_id);

-- ----------------------------------------------------------------------------
-- list_comments
-- ----------------------------------------------------------------------------
CREATE TABLE list_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) <= 500),
  parent_comment_id UUID REFERENCES list_comments(id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_list_comments_list ON list_comments(list_id, created_at) WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- start_sit_questions
-- ----------------------------------------------------------------------------
CREATE TABLE start_sit_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poster_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  player_a_id TEXT REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  player_b_id TEXT REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  context_note TEXT CHECK (char_length(context_note) <= 280),
  scoring_system_id UUID REFERENCES scoring_systems(id),
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  vote_count_a INTEGER DEFAULT 0,
  vote_count_b INTEGER DEFAULT 0,
  correct_player TEXT,
  is_voided BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  voting_closes_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CHECK (player_a_id != player_b_id)
);

CREATE INDEX idx_sos_week ON start_sit_questions(season, week, created_at DESC);
CREATE INDEX idx_sos_poster ON start_sit_questions(poster_id);
CREATE INDEX idx_sos_unresolved ON start_sit_questions(resolved_at) WHERE resolved_at IS NULL AND is_voided = FALSE;

-- ----------------------------------------------------------------------------
-- start_sit_votes
-- ----------------------------------------------------------------------------
CREATE TABLE start_sit_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID REFERENCES start_sit_questions(id) ON DELETE CASCADE NOT NULL,
  voter_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  voted_for TEXT NOT NULL CHECK (voted_for IN ('a', 'b')),
  is_correct BOOLEAN,
  cred_points_earned NUMERIC DEFAULT 0,
  voted_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(question_id, voter_id)
);

CREATE INDEX idx_sos_votes_question ON start_sit_votes(question_id);
CREATE INDEX idx_sos_votes_voter ON start_sit_votes(voter_id);
CREATE INDEX idx_sos_votes_leaderboard ON start_sit_votes(voter_id, is_correct, cred_points_earned DESC);

-- ----------------------------------------------------------------------------
-- expert_profiles
-- ----------------------------------------------------------------------------
CREATE TABLE expert_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  employer TEXT,
  bio TEXT,
  avatar_url TEXT,
  twitter_handle TEXT,
  youtube_url TEXT,
  podcast_name TEXT,
  podcast_url TEXT,
  website_url TEXT,
  is_claimed BOOLEAN DEFAULT FALSE,
  claimed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  is_ai_generated BOOLEAN DEFAULT TRUE,
  ai_generated_disclaimer TEXT DEFAULT 'Rankings on this profile are AI-generated based on this expert''s publicly known opinions and historical analysis. They are not official rankings from this person.',
  follower_count INTEGER DEFAULT 0,
  last_rankings_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_expert_profiles_slug ON expert_profiles(slug);
CREATE INDEX idx_expert_profiles_claimed ON expert_profiles(is_claimed);
CREATE INDEX idx_expert_profiles_followers ON expert_profiles(follower_count DESC);

-- ----------------------------------------------------------------------------
-- expert_follows
-- ----------------------------------------------------------------------------
CREATE TABLE expert_follows (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  expert_id UUID REFERENCES expert_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, expert_id)
);

CREATE INDEX idx_expert_follows_user ON expert_follows(user_id);
CREATE INDEX idx_expert_follows_expert ON expert_follows(expert_id);

-- ----------------------------------------------------------------------------
-- expert_claim_requests
-- ----------------------------------------------------------------------------
CREATE TABLE expert_claim_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id UUID REFERENCES expert_profiles(id) ON DELETE CASCADE NOT NULL,
  requester_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  verification_method TEXT NOT NULL CHECK (verification_method IN ('twitter_oauth', 'email', 'manual_review')),
  twitter_verified_handle TEXT,
  email_sent_to TEXT,
  email_token TEXT,
  email_token_expires_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES profiles(id),
  review_note TEXT,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_expert_claims_expert ON expert_claim_requests(expert_id);
CREATE INDEX idx_expert_claims_requester ON expert_claim_requests(requester_id);
CREATE INDEX idx_expert_claims_pending ON expert_claim_requests(status) WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- ranking_history
-- Tracks how a player's rank changes over time within a list.
-- ----------------------------------------------------------------------------
CREATE TABLE ranking_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE,
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
  old_rank INTEGER,
  new_rank INTEGER,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ranking_history_list_player ON ranking_history(list_id, player_id);

-- ----------------------------------------------------------------------------
-- weekly_rankings
-- Users submit position rankings each week during the NFL season.
-- ----------------------------------------------------------------------------
CREATE TABLE weekly_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  position TEXT NOT NULL,
  rankings JSONB NOT NULL,
  accuracy_score NUMERIC,
  cred_points_earned NUMERIC,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, season, week, position)
);

CREATE INDEX idx_weekly_rankings_user ON weekly_rankings(user_id);
CREATE INDEX idx_weekly_rankings_week ON weekly_rankings(season, week);
CREATE INDEX idx_weekly_rankings_leaderboard ON weekly_rankings(season, week, position, accuracy_score DESC);

-- ----------------------------------------------------------------------------
-- cred_scores
-- Aggregated cred data per user per season.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- leagues (created before teams due to FK dependency)
-- ----------------------------------------------------------------------------
CREATE TABLE leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  max_teams INTEGER NOT NULL DEFAULT 12,
  scoring_system_id UUID REFERENCES scoring_systems(id),
  roster_settings JSONB NOT NULL DEFAULT '{"qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "k": 1, "def": 1, "bench": 6}',
  invite_code TEXT UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  season INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- teams
-- ----------------------------------------------------------------------------
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  list_id UUID REFERENCES lists(id) NOT NULL,
  name TEXT NOT NULL,
  scoring_system_id UUID REFERENCES scoring_systems(id),
  league_id UUID REFERENCES leagues(id),
  total_points NUMERIC DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- team_lineups
-- Weekly lineup decisions (starters vs bench).
-- ----------------------------------------------------------------------------
CREATE TABLE team_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  starters JSONB NOT NULL,
  bench JSONB NOT NULL,
  total_points NUMERIC,
  set_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(team_id, season, week)
);

-- ----------------------------------------------------------------------------
-- league_chat
-- ----------------------------------------------------------------------------
CREATE TABLE league_chat (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_league_chat_league ON league_chat(league_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- notifications
-- ----------------------------------------------------------------------------
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at DESC);

-- ----------------------------------------------------------------------------
-- research_configs
-- User-saved research table configurations.
-- ----------------------------------------------------------------------------
CREATE TABLE research_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  position_filter TEXT,
  scoring_system_id UUID REFERENCES scoring_systems(id),
  columns JSONB NOT NULL DEFAULT '[]',
  filters JSONB NOT NULL DEFAULT '{}',
  sort_by TEXT,
  sort_direction TEXT DEFAULT 'desc',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_research_configs_owner ON research_configs(owner_id);

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================

-- profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by everyone"
  ON profiles FOR SELECT USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- follows
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Follows are viewable by everyone"
  ON follows FOR SELECT USING (true);

CREATE POLICY "Users can manage own follows"
  ON follows FOR ALL USING (auth.uid() = follower_id);

-- players (read-only, anonymous access for guest experience)
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players are viewable by everyone"
  ON players FOR SELECT USING (true);

-- nfl_games
ALTER TABLE nfl_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Games are viewable by authenticated users"
  ON nfl_games FOR SELECT USING (auth.role() = 'authenticated');

-- player_stats
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Stats are viewable by authenticated users"
  ON player_stats FOR SELECT USING (auth.role() = 'authenticated');

-- scoring_systems
ALTER TABLE scoring_systems ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System defaults are viewable by everyone"
  ON scoring_systems FOR SELECT USING (is_system_default = TRUE);

CREATE POLICY "Users can view own scoring systems"
  ON scoring_systems FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can manage own scoring systems"
  ON scoring_systems FOR ALL USING (auth.uid() = owner_id);

-- lists
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public lists are viewable by everyone"
  ON lists FOR SELECT USING (
    (is_private = FALSE AND deleted_at IS NULL)
    OR auth.uid() = owner_id
  );

CREATE POLICY "Users can manage own lists"
  ON lists FOR ALL USING (auth.uid() = owner_id);

-- list_players
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

-- list_likes
ALTER TABLE list_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Likes are viewable by everyone"
  ON list_likes FOR SELECT USING (true);

CREATE POLICY "Users can manage own likes"
  ON list_likes FOR ALL USING (auth.uid() = user_id);

-- tags
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tags are viewable by everyone"
  ON tags FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create custom tags"
  ON tags FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND is_system_tag = FALSE
    AND auth.uid() = created_by
  );

-- list_tags
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

-- list_comments
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

-- start_sit_questions
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

-- start_sit_votes
ALTER TABLE start_sit_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vote totals are public after question resolves"
  ON start_sit_votes FOR SELECT USING (
    EXISTS (SELECT 1 FROM start_sit_questions WHERE id = start_sit_votes.question_id AND resolved_at IS NOT NULL)
    OR auth.uid() = voter_id
  );

CREATE POLICY "Users can cast their own vote"
  ON start_sit_votes FOR INSERT WITH CHECK (
    auth.uid() = voter_id
    AND NOT EXISTS (
      SELECT 1 FROM start_sit_questions
      WHERE id = start_sit_votes.question_id
      AND poster_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM start_sit_questions
      WHERE id = start_sit_votes.question_id
      AND voting_closes_at > NOW()
      AND resolved_at IS NULL
      AND is_voided = FALSE
    )
  );

-- expert_profiles
ALTER TABLE expert_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Expert profiles are viewable by everyone"
  ON expert_profiles FOR SELECT USING (true);

CREATE POLICY "Claimed experts can update their profile"
  ON expert_profiles FOR UPDATE USING (
    is_claimed = TRUE
    AND claimed_by = auth.uid()
  );

-- expert_follows
ALTER TABLE expert_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Expert follows are viewable by everyone"
  ON expert_follows FOR SELECT USING (true);

CREATE POLICY "Users can manage own expert follows"
  ON expert_follows FOR ALL USING (auth.uid() = user_id);

-- expert_claim_requests
ALTER TABLE expert_claim_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own claim requests"
  ON expert_claim_requests FOR SELECT USING (auth.uid() = requester_id);

CREATE POLICY "Users can submit claim requests"
  ON expert_claim_requests FOR INSERT WITH CHECK (auth.uid() = requester_id);

-- ranking_history
ALTER TABLE ranking_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ranking history follows list visibility"
  ON ranking_history FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM lists
      WHERE lists.id = ranking_history.list_id
      AND (lists.is_private = FALSE OR lists.owner_id = auth.uid())
      AND lists.deleted_at IS NULL
    )
  );

-- weekly_rankings
ALTER TABLE weekly_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Weekly rankings are viewable by everyone"
  ON weekly_rankings FOR SELECT USING (true);

CREATE POLICY "Users can manage own weekly rankings"
  ON weekly_rankings FOR ALL USING (auth.uid() = user_id);

-- cred_scores
ALTER TABLE cred_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cred scores are viewable by everyone"
  ON cred_scores FOR SELECT USING (true);

-- teams
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teams are viewable by everyone"
  ON teams FOR SELECT USING (true);

CREATE POLICY "Users can manage own teams"
  ON teams FOR ALL USING (auth.uid() = owner_id);

-- team_lineups
ALTER TABLE team_lineups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lineups follow team visibility"
  ON team_lineups FOR SELECT USING (true);

CREATE POLICY "Users can manage own team lineups"
  ON team_lineups FOR ALL USING (
    EXISTS (
      SELECT 1 FROM teams WHERE teams.id = team_lineups.team_id AND teams.owner_id = auth.uid()
    )
  );

-- leagues
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

-- league_chat
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

-- notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE USING (auth.uid() = user_id);

-- research_configs
ALTER TABLE research_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own research configs"
  ON research_configs FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can manage own research configs"
  ON research_configs FOR ALL USING (auth.uid() = owner_id);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Auto-create profile + Big Board on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_user_id UUID := NEW.id;
  new_username TEXT := NEW.raw_user_meta_data->>'username';
BEGIN
  INSERT INTO profiles (id, username, display_name, avatar_url)
  VALUES (
    new_user_id,
    COALESCE(new_username, 'user_' || substr(new_user_id::text, 1, 8)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', new_username, 'New User'),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  INSERT INTO lists (
    owner_id, title, slug, hide_order, is_big_board, is_private, comments_enabled
  ) VALUES (
    new_user_id, 'My Big Board', 'big-board', FALSE, TRUE, FALSE, TRUE
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Update follower counts on follow/unfollow
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

-- Update list player count on add/remove
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

-- Update tag use count on tag/untag
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

-- Update expert follower count
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

-- ============================================================================
-- MATERIALIZED VIEWS
-- ============================================================================

CREATE MATERIALIZED VIEW consensus_rankings AS
SELECT
  lp.player_id,
  p.full_name,
  p.position,
  p.team,
  COUNT(DISTINCT l.owner_id) AS ranker_count,
  AVG(lp.overall_rank) AS average_rank,
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
