export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_call_log: {
        Row: {
          created_at: string
          error: string | null
          feature: string
          id: string
          input_tokens: number | null
          latency_ms: number | null
          model: string
          output_tokens: number | null
          success: boolean
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          feature: string
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model: string
          output_tokens?: number | null
          success?: boolean
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          feature?: string
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string
          output_tokens?: number | null
          success?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generation_usage: {
        Row: {
          created_at: string
          feature: string
          updated_at: string
          usage_date: string
          used: number
          user_id: string
        }
        Insert: {
          created_at?: string
          feature: string
          updated_at?: string
          usage_date: string
          used?: number
          user_id: string
        }
        Update: {
          created_at?: string
          feature?: string
          updated_at?: string
          usage_date?: string
          used?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generation_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_personas: {
        Row: {
          avatar_url: string | null
          bio: string
          created_at: string | null
          deleted_at: string | null
          display_name: string
          id: string
          is_active: boolean | null
          style_profile: Json
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio: string
          created_at?: string | null
          deleted_at?: string | null
          display_name: string
          id?: string
          is_active?: boolean | null
          style_profile: Json
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string
          created_at?: string | null
          deleted_at?: string | null
          display_name?: string
          id?: string
          is_active?: boolean | null
          style_profile?: Json
          username?: string
        }
        Relationships: []
      }
      big_board_snapshots: {
        Row: {
          id: string
          saved_at: string
          snapshot_data: Json
          user_id: string
        }
        Insert: {
          id?: string
          saved_at?: string
          snapshot_data: Json
          user_id: string
        }
        Update: {
          id?: string
          saved_at?: string
          snapshot_data?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "big_board_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      big_board_weekly: {
        Row: {
          created_at: string
          id: string
          list_id: string
          season: number
          user_id: string
          week_number: number
        }
        Insert: {
          created_at?: string
          id?: string
          list_id: string
          season: number
          user_id: string
          week_number: number
        }
        Update: {
          created_at?: string
          id?: string
          list_id?: string
          season?: number
          user_id?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "big_board_weekly_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "big_board_weekly_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cred_scores: {
        Row: {
          average_accuracy: number | null
          best_week: number | null
          best_week_score: number | null
          id: string
          season: number
          total_cred: number | null
          updated_at: string | null
          user_id: string
          weeks_submitted: number | null
        }
        Insert: {
          average_accuracy?: number | null
          best_week?: number | null
          best_week_score?: number | null
          id?: string
          season: number
          total_cred?: number | null
          updated_at?: string | null
          user_id: string
          weeks_submitted?: number | null
        }
        Update: {
          average_accuracy?: number | null
          best_week?: number | null
          best_week_score?: number | null
          id?: string
          season?: number
          total_cred?: number | null
          updated_at?: string | null
          user_id?: string
          weeks_submitted?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cred_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      defense_position_splits: {
        Row: {
          defense: string
          factor: number
          position: string
          rank: number
          sample_weeks: number
          season: number
          updated_at: string
        }
        Insert: {
          defense: string
          factor: number
          position: string
          rank: number
          sample_weeks?: number
          season: number
          updated_at?: string
        }
        Update: {
          defense?: string
          factor?: number
          position?: string
          rank?: number
          sample_weeks?: number
          season?: number
          updated_at?: string
        }
        Relationships: []
      }
      draft_bids: {
        Row: {
          action_id: string | null
          amount: number
          created_at: string | null
          draft_id: string
          id: string
          league_id: string
          nomination_seq: number
          player_id: string
          team_id: string
          voided_at: string | null
        }
        Insert: {
          action_id?: string | null
          amount: number
          created_at?: string | null
          draft_id: string
          id?: string
          league_id: string
          nomination_seq: number
          player_id: string
          team_id: string
          voided_at?: string | null
        }
        Update: {
          action_id?: string | null
          amount?: number
          created_at?: string | null
          draft_id?: string
          id?: string
          league_id?: string
          nomination_seq?: number
          player_id?: string
          team_id?: string
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_bids_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_bids_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_bids_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_bids_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_dnd_marks: {
        Row: {
          created_at: string | null
          draft_id: string
          id: string
          player_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          draft_id: string
          id?: string
          player_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          draft_id?: string
          id?: string
          player_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_dnd_marks_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_dnd_marks_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_dnd_marks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_liveness: {
        Row: {
          draft_id: string
          last_seen_at: string
          user_id: string
        }
        Insert: {
          draft_id: string
          last_seen_at?: string
          user_id: string
        }
        Update: {
          draft_id?: string
          last_seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_liveness_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_liveness_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_picks: {
        Row: {
          action_id: string | null
          created_at: string | null
          draft_id: string
          id: string
          is_auto: boolean | null
          is_undone: boolean | null
          league_id: string
          made_via: string | null
          pick_number: number
          picked_by: string | null
          player_id: string
          price: number | null
          round: number | null
          team_id: string
        }
        Insert: {
          action_id?: string | null
          created_at?: string | null
          draft_id: string
          id?: string
          is_auto?: boolean | null
          is_undone?: boolean | null
          league_id: string
          made_via?: string | null
          pick_number: number
          picked_by?: string | null
          player_id: string
          price?: number | null
          round?: number | null
          team_id: string
        }
        Update: {
          action_id?: string | null
          created_at?: string | null
          draft_id?: string
          id?: string
          is_auto?: boolean | null
          is_undone?: boolean | null
          league_id?: string
          made_via?: string | null
          pick_number?: number
          picked_by?: string | null
          player_id?: string
          price?: number | null
          round?: number | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_picks_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_picked_by_fkey"
            columns: ["picked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_queues: {
        Row: {
          created_at: string | null
          draft_id: string
          id: string
          player_id: string
          rank: number
          team_id: string
        }
        Insert: {
          created_at?: string | null
          draft_id: string
          id?: string
          player_id: string
          rank: number
          team_id: string
        }
        Update: {
          created_at?: string | null
          draft_id?: string
          id?: string
          player_id?: string
          rank?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_queues_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_queues_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_queues_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      drafts: {
        Row: {
          budget_adjustments: Json
          completed_at: string | null
          config: Json
          created_at: string | null
          current_deadline: string | null
          current_nomination: Json | null
          current_pick_number: number | null
          current_round: number | null
          deadline_remaining_ms: number | null
          draft_order: Json | null
          draft_type: string
          id: string
          is_mock: boolean
          league_id: string
          nomination_order: Json | null
          on_clock_team_id: string | null
          paused_at: string | null
          started_at: string | null
          status: string
          total_rounds: number | null
          updated_at: string | null
        }
        Insert: {
          budget_adjustments?: Json
          completed_at?: string | null
          config?: Json
          created_at?: string | null
          current_deadline?: string | null
          current_nomination?: Json | null
          current_pick_number?: number | null
          current_round?: number | null
          deadline_remaining_ms?: number | null
          draft_order?: Json | null
          draft_type?: string
          id?: string
          is_mock?: boolean
          league_id: string
          nomination_order?: Json | null
          on_clock_team_id?: string | null
          paused_at?: string | null
          started_at?: string | null
          status?: string
          total_rounds?: number | null
          updated_at?: string | null
        }
        Update: {
          budget_adjustments?: Json
          completed_at?: string | null
          config?: Json
          created_at?: string | null
          current_deadline?: string | null
          current_nomination?: Json | null
          current_pick_number?: number | null
          current_round?: number | null
          deadline_remaining_ms?: number | null
          draft_order?: Json | null
          draft_type?: string
          id?: string
          is_mock?: boolean
          league_id?: string
          nomination_order?: Json | null
          on_clock_team_id?: string | null
          paused_at?: string | null
          started_at?: string | null
          status?: string
          total_rounds?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drafts_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_on_clock_team_id_fkey"
            columns: ["on_clock_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_claim_requests: {
        Row: {
          email_sent_to: string | null
          email_token: string | null
          email_token_expires_at: string | null
          expert_id: string
          id: string
          requested_at: string | null
          requester_id: string
          resolved_at: string | null
          review_note: string | null
          reviewed_by: string | null
          status: string | null
          twitter_verified_handle: string | null
          verification_method: string
        }
        Insert: {
          email_sent_to?: string | null
          email_token?: string | null
          email_token_expires_at?: string | null
          expert_id: string
          id?: string
          requested_at?: string | null
          requester_id: string
          resolved_at?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string | null
          twitter_verified_handle?: string | null
          verification_method: string
        }
        Update: {
          email_sent_to?: string | null
          email_token?: string | null
          email_token_expires_at?: string | null
          expert_id?: string
          id?: string
          requested_at?: string | null
          requester_id?: string
          resolved_at?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string | null
          twitter_verified_handle?: string | null
          verification_method?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_claim_requests_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "expert_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_claim_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_claim_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_follows: {
        Row: {
          created_at: string | null
          expert_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expert_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          expert_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_follows_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "expert_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_follows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_profiles: {
        Row: {
          ai_generated_disclaimer: string | null
          avatar_url: string | null
          bio: string | null
          claimed_at: string | null
          claimed_by: string | null
          created_at: string | null
          display_name: string
          employer: string | null
          follower_count: number | null
          id: string
          is_ai_generated: boolean | null
          is_claimed: boolean | null
          last_rankings_updated_at: string | null
          podcast_name: string | null
          podcast_url: string | null
          slug: string
          twitter_handle: string | null
          updated_at: string | null
          website_url: string | null
          youtube_url: string | null
        }
        Insert: {
          ai_generated_disclaimer?: string | null
          avatar_url?: string | null
          bio?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string | null
          display_name: string
          employer?: string | null
          follower_count?: number | null
          id?: string
          is_ai_generated?: boolean | null
          is_claimed?: boolean | null
          last_rankings_updated_at?: string | null
          podcast_name?: string | null
          podcast_url?: string | null
          slug: string
          twitter_handle?: string | null
          updated_at?: string | null
          website_url?: string | null
          youtube_url?: string | null
        }
        Update: {
          ai_generated_disclaimer?: string | null
          avatar_url?: string | null
          bio?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string | null
          display_name?: string
          employer?: string | null
          follower_count?: number | null
          id?: string
          is_ai_generated?: boolean | null
          is_claimed?: boolean | null
          last_rankings_updated_at?: string | null
          podcast_name?: string | null
          podcast_url?: string | null
          slug?: string
          twitter_handle?: string | null
          updated_at?: string | null
          website_url?: string | null
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_profiles_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string | null
          follower_id: string
          following_id: string
        }
        Insert: {
          created_at?: string | null
          follower_id: string
          following_id: string
        }
        Update: {
          created_at?: string | null
          follower_id?: string
          following_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_following_id_fkey"
            columns: ["following_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_chat: {
        Row: {
          context: string | null
          created_at: string | null
          id: string
          is_system: boolean | null
          league_id: string
          message: string
          user_id: string | null
        }
        Insert: {
          context?: string | null
          created_at?: string | null
          id?: string
          is_system?: boolean | null
          league_id: string
          message: string
          user_id?: string | null
        }
        Update: {
          context?: string | null
          created_at?: string | null
          id?: string
          is_system?: boolean | null
          league_id?: string
          message?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_chat_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_chat_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_invites: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          invited_email: string | null
          invited_username: string | null
          last_sent_at: string | null
          league_id: string
          max_uses: number
          revoked_at: string | null
          target_team_id: string | null
          token: string
          use_count: number
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          invited_email?: string | null
          invited_username?: string | null
          last_sent_at?: string | null
          league_id: string
          max_uses?: number
          revoked_at?: string | null
          target_team_id?: string | null
          token?: string
          use_count?: number
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          invited_email?: string | null
          invited_username?: string | null
          last_sent_at?: string | null
          league_id?: string
          max_uses?: number
          revoked_at?: string | null
          target_team_id?: string | null
          token?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "league_invites_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_invites_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_invites_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      league_lists: {
        Row: {
          created_at: string | null
          id: string
          is_primary_board: boolean | null
          league_id: string
          list_id: string
          owner_id: string
          shared_with_league: boolean | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_primary_board?: boolean | null
          league_id: string
          list_id: string
          owner_id: string
          shared_with_league?: boolean | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_primary_board?: boolean | null
          league_id?: string
          list_id?: string
          owner_id?: string
          shared_with_league?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "league_lists_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_lists_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_lists_list_owner_fkey"
            columns: ["list_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "league_lists_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_members: {
        Row: {
          faab_balance: number | null
          id: string
          is_autodraft: boolean | null
          is_placeholder: boolean | null
          joined_at: string | null
          league_id: string
          role: string
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          faab_balance?: number | null
          id?: string
          is_autodraft?: boolean | null
          is_placeholder?: boolean | null
          joined_at?: string | null
          league_id: string
          role?: string
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          faab_balance?: number | null
          id?: string
          is_autodraft?: boolean | null
          is_placeholder?: boolean | null
          joined_at?: string | null
          league_id?: string
          role?: string
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_rosters: {
        Row: {
          acquired_at: string | null
          acquisition_cost: number | null
          acquisition_type: string | null
          id: string
          ir_lock_until_week: number | null
          ir_placed_week: number | null
          league_id: string
          player_id: string
          slot_key: string | null
          team_id: string
        }
        Insert: {
          acquired_at?: string | null
          acquisition_cost?: number | null
          acquisition_type?: string | null
          id?: string
          ir_lock_until_week?: number | null
          ir_placed_week?: number | null
          league_id: string
          player_id: string
          slot_key?: string | null
          team_id: string
        }
        Update: {
          acquired_at?: string | null
          acquisition_cost?: number | null
          acquisition_type?: string | null
          id?: string
          ir_lock_until_week?: number | null
          ir_placed_week?: number | null
          league_id?: string
          player_id?: string
          slot_key?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_rosters_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_rosters_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_rosters_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      league_weeks: {
        Row: {
          finalized_at: string | null
          id: string
          league_id: string
          median_score: number | null
          reopened_by_action_id: string | null
          season: number
          status: string
          waivers_processed_at: string | null
          week: number
        }
        Insert: {
          finalized_at?: string | null
          id?: string
          league_id: string
          median_score?: number | null
          reopened_by_action_id?: string | null
          season: number
          status?: string
          waivers_processed_at?: string | null
          week: number
        }
        Update: {
          finalized_at?: string | null
          id?: string
          league_id?: string
          median_score?: number | null
          reopened_by_action_id?: string | null
          season?: number
          status?: string
          waivers_processed_at?: string | null
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "league_weeks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_weeks_season_week_fkey"
            columns: ["season", "week"]
            isOneToOne: false
            referencedRelation: "nfl_weeks"
            referencedColumns: ["season", "week"]
          },
        ]
      }
      leagues: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          creation_action_id: string | null
          deleted_at: string | null
          description: string | null
          faab_budget: number
          format: string
          id: string
          invite_code: string | null
          invite_slug: string | null
          is_active: boolean | null
          lineup_lock: string
          max_teams: number
          name: string
          owner_id: string
          playoff_start_week: number
          playoff_teams: number
          regular_season_weeks: number
          roster_settings: Json
          scoring_rules_snapshot: Json | null
          scoring_system_id: string | null
          season: number
          settings: Json
          status: string
          team_count: number
          trade_deadline_week: number | null
          trade_review: string
          updated_at: string | null
          waiver_type: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          creation_action_id?: string | null
          deleted_at?: string | null
          description?: string | null
          faab_budget?: number
          format?: string
          id?: string
          invite_code?: string | null
          invite_slug?: string | null
          is_active?: boolean | null
          lineup_lock?: string
          max_teams?: number
          name: string
          owner_id: string
          playoff_start_week?: number
          playoff_teams?: number
          regular_season_weeks?: number
          roster_settings?: Json
          scoring_rules_snapshot?: Json | null
          scoring_system_id?: string | null
          season: number
          settings?: Json
          status?: string
          team_count?: number
          trade_deadline_week?: number | null
          trade_review?: string
          updated_at?: string | null
          waiver_type?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          creation_action_id?: string | null
          deleted_at?: string | null
          description?: string | null
          faab_budget?: number
          format?: string
          id?: string
          invite_code?: string | null
          invite_slug?: string | null
          is_active?: boolean | null
          lineup_lock?: string
          max_teams?: number
          name?: string
          owner_id?: string
          playoff_start_week?: number
          playoff_teams?: number
          regular_season_weeks?: number
          roster_settings?: Json
          scoring_rules_snapshot?: Json | null
          scoring_system_id?: string | null
          season?: number
          settings?: Json
          status?: string
          team_count?: number
          trade_deadline_week?: number | null
          trade_review?: string
          updated_at?: string | null
          waiver_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "leagues_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leagues_scoring_system_id_fkey"
            columns: ["scoring_system_id"]
            isOneToOne: false
            referencedRelation: "scoring_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      list_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string | null
          deleted_at: string | null
          id: string
          list_id: string
          parent_id: string | null
          updated_at: string | null
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          list_id: string
          parent_id?: string | null
          updated_at?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          list_id?: string
          parent_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "list_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_comments_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_comments_parent_comment_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "list_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      list_favorites: {
        Row: {
          created_at: string
          list_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          list_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          list_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_favorites_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      list_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_folders_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      list_likes: {
        Row: {
          created_at: string | null
          list_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          list_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          list_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_likes_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      list_links: {
        Row: {
          created_at: string
          duration_label: string | null
          id: string
          kind: string
          list_id: string
          position: number
          source_label: string | null
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          duration_label?: string | null
          id?: string
          kind: string
          list_id: string
          position?: number
          source_label?: string | null
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          duration_label?: string | null
          id?: string
          kind?: string
          list_id?: string
          position?: number
          source_label?: string | null
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_links_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_player_drafted: {
        Row: {
          drafted_at: string
          list_id: string
          player_id: string
          user_id: string
        }
        Insert: {
          drafted_at?: string
          list_id: string
          player_id: string
          user_id: string
        }
        Update: {
          drafted_at?: string
          list_id?: string
          player_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_player_drafted_list_player_fkey"
            columns: ["list_id", "player_id"]
            isOneToOne: false
            referencedRelation: "list_players"
            referencedColumns: ["list_id", "player_id"]
          },
          {
            foreignKeyName: "list_player_drafted_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      list_players: {
        Row: {
          added_at: string | null
          id: string
          list_id: string
          notes: string | null
          overall_rank: number | null
          player_id: string
          position: number
          rank_in_tier: number | null
          slot: string | null
          tier: string | null
          updated_at: string | null
        }
        Insert: {
          added_at?: string | null
          id?: string
          list_id: string
          notes?: string | null
          overall_rank?: number | null
          player_id: string
          position: number
          rank_in_tier?: number | null
          slot?: string | null
          tier?: string | null
          updated_at?: string | null
        }
        Update: {
          added_at?: string | null
          id?: string
          list_id?: string
          notes?: string | null
          overall_rank?: number | null
          player_id?: string
          position?: number
          rank_in_tier?: number | null
          slot?: string | null
          tier?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "list_players_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      list_tags: {
        Row: {
          created_at: string | null
          list_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string | null
          list_id: string
          tag_id: string
        }
        Update: {
          created_at?: string | null
          list_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_tags_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          ai_persona_id: string | null
          comments_enabled: boolean | null
          created_at: string | null
          deleted_at: string | null
          description: string | null
          folder_id: string | null
          hide_order: boolean | null
          id: string
          is_big_board: boolean | null
          is_favorited: boolean | null
          is_favorites: boolean
          is_private: boolean | null
          is_team: boolean | null
          like_count: number | null
          owner_id: string
          player_count: number | null
          position_filter: string | null
          ranking_mode: string
          roster_settings: Json | null
          scoring_system_id: string | null
          slug: string
          thumbnail_url: string | null
          tiers_enabled: boolean | null
          title: string
          updated_at: string | null
          view_count: number | null
        }
        Insert: {
          ai_persona_id?: string | null
          comments_enabled?: boolean | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          folder_id?: string | null
          hide_order?: boolean | null
          id?: string
          is_big_board?: boolean | null
          is_favorited?: boolean | null
          is_favorites?: boolean
          is_private?: boolean | null
          is_team?: boolean | null
          like_count?: number | null
          owner_id: string
          player_count?: number | null
          position_filter?: string | null
          ranking_mode?: string
          roster_settings?: Json | null
          scoring_system_id?: string | null
          slug: string
          thumbnail_url?: string | null
          tiers_enabled?: boolean | null
          title: string
          updated_at?: string | null
          view_count?: number | null
        }
        Update: {
          ai_persona_id?: string | null
          comments_enabled?: boolean | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          folder_id?: string | null
          hide_order?: boolean | null
          id?: string
          is_big_board?: boolean | null
          is_favorited?: boolean | null
          is_favorites?: boolean
          is_private?: boolean | null
          is_team?: boolean | null
          like_count?: number | null
          owner_id?: string
          player_count?: number | null
          position_filter?: string | null
          ranking_mode?: string
          roster_settings?: Json | null
          scoring_system_id?: string | null
          slug?: string
          thumbnail_url?: string | null
          tiers_enabled?: boolean | null
          title?: string
          updated_at?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lists_ai_persona_id_fkey"
            columns: ["ai_persona_id"]
            isOneToOne: false
            referencedRelation: "ai_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lists_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "list_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lists_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lists_scoring_system_id_fkey"
            columns: ["scoring_system_id"]
            isOneToOne: false
            referencedRelation: "scoring_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      nfl_games: {
        Row: {
          away_score: number | null
          away_team: string
          game_clock: string | null
          game_type: string | null
          home_score: number | null
          home_team: string
          id: string
          kickoff_at: string
          quarter: number | null
          season: number
          status: string | null
          updated_at: string | null
          week: number
        }
        Insert: {
          away_score?: number | null
          away_team: string
          game_clock?: string | null
          game_type?: string | null
          home_score?: number | null
          home_team: string
          id: string
          kickoff_at: string
          quarter?: number | null
          season: number
          status?: string | null
          updated_at?: string | null
          week: number
        }
        Update: {
          away_score?: number | null
          away_team?: string
          game_clock?: string | null
          game_type?: string | null
          home_score?: number | null
          home_team?: string
          id?: string
          kickoff_at?: string
          quarter?: number | null
          season?: number
          status?: string | null
          updated_at?: string | null
          week?: number
        }
        Relationships: []
      }
      nfl_weeks: {
        Row: {
          correction_window_ends_at: string | null
          first_kickoff_at: string | null
          last_game_ends_at: string | null
          season: number
          starts_at: string
          week: number
        }
        Insert: {
          correction_window_ends_at?: string | null
          first_kickoff_at?: string | null
          last_game_ends_at?: string | null
          season: number
          starts_at: string
          week: number
        }
        Update: {
          correction_window_ends_at?: string | null
          first_kickoff_at?: string | null
          last_game_ends_at?: string | null
          season?: number
          starts_at?: string
          week?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string | null
          data: Json | null
          id: string
          read: boolean | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          read?: boolean | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          read?: boolean | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_content_items: {
        Row: {
          ai_persona_id: string
          content_hash: string
          extracted: Json
          id: string
          ingested_at: string | null
          published_at: string | null
          raw_excerpt: string | null
          source_id: string | null
          source_type: string | null
          source_url: string
          title: string | null
        }
        Insert: {
          ai_persona_id: string
          content_hash: string
          extracted: Json
          id?: string
          ingested_at?: string | null
          published_at?: string | null
          raw_excerpt?: string | null
          source_id?: string | null
          source_type?: string | null
          source_url: string
          title?: string | null
        }
        Update: {
          ai_persona_id?: string
          content_hash?: string
          extracted?: Json
          id?: string
          ingested_at?: string | null
          published_at?: string | null
          raw_excerpt?: string | null
          source_id?: string | null
          source_type?: string | null
          source_url?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "persona_content_items_ai_persona_id_fkey"
            columns: ["ai_persona_id"]
            isOneToOne: false
            referencedRelation: "ai_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_content_items_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "persona_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_context: {
        Row: {
          ai_persona_id: string
          context: Json
          last_material_change_at: string | null
          rendered_md: string | null
          source_item_count: number | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          ai_persona_id: string
          context: Json
          last_material_change_at?: string | null
          rendered_md?: string | null
          source_item_count?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          ai_persona_id?: string
          context?: Json
          last_material_change_at?: string | null
          rendered_md?: string | null
          source_item_count?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "persona_context_ai_persona_id_fkey"
            columns: ["ai_persona_id"]
            isOneToOne: true
            referencedRelation: "ai_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_context_versions: {
        Row: {
          ai_persona_id: string
          context: Json
          created_at: string | null
          id: string
          version: number
        }
        Insert: {
          ai_persona_id: string
          context: Json
          created_at?: string | null
          id?: string
          version: number
        }
        Update: {
          ai_persona_id?: string
          context?: Json
          created_at?: string | null
          id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "persona_context_versions_ai_persona_id_fkey"
            columns: ["ai_persona_id"]
            isOneToOne: false
            referencedRelation: "ai_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_posts: {
        Row: {
          ai_persona_id: string
          body_md: string
          citations: Json
          created_at: string | null
          dek: string | null
          deleted_at: string | null
          id: string
          kind: string
          list_id: string | null
          published_at: string | null
          slug: string
          status: string | null
          title: string
          view_count: number | null
        }
        Insert: {
          ai_persona_id: string
          body_md: string
          citations: Json
          created_at?: string | null
          dek?: string | null
          deleted_at?: string | null
          id?: string
          kind: string
          list_id?: string | null
          published_at?: string | null
          slug: string
          status?: string | null
          title: string
          view_count?: number | null
        }
        Update: {
          ai_persona_id?: string
          body_md?: string
          citations?: Json
          created_at?: string | null
          dek?: string | null
          deleted_at?: string | null
          id?: string
          kind?: string
          list_id?: string | null
          published_at?: string | null
          slug?: string
          status?: string | null
          title?: string
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "persona_posts_ai_persona_id_fkey"
            columns: ["ai_persona_id"]
            isOneToOne: false
            referencedRelation: "ai_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_posts_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_source_rankings: {
        Row: {
          ai_persona_id: string
          id: string
          position: string | null
          raw_rankings: Json
          scoring: string | null
          scraped_at: string | null
          source_published_at: string | null
          source_url: string
        }
        Insert: {
          ai_persona_id: string
          id?: string
          position?: string | null
          raw_rankings: Json
          scoring?: string | null
          scraped_at?: string | null
          source_published_at?: string | null
          source_url: string
        }
        Update: {
          ai_persona_id?: string
          id?: string
          position?: string | null
          raw_rankings?: Json
          scoring?: string | null
          scraped_at?: string | null
          source_published_at?: string | null
          source_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "persona_source_rankings_ai_persona_id_fkey"
            columns: ["ai_persona_id"]
            isOneToOne: false
            referencedRelation: "ai_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_sources: {
        Row: {
          ai_persona_id: string
          created_at: string | null
          deleted_at: string | null
          etag: string | null
          id: string
          is_active: boolean | null
          is_paywalled: boolean | null
          label: string | null
          last_checked_at: string | null
          last_item_published_at: string | null
          last_listing_hash: string | null
          type: string
          url: string
        }
        Insert: {
          ai_persona_id: string
          created_at?: string | null
          deleted_at?: string | null
          etag?: string | null
          id?: string
          is_active?: boolean | null
          is_paywalled?: boolean | null
          label?: string | null
          last_checked_at?: string | null
          last_item_published_at?: string | null
          last_listing_hash?: string | null
          type: string
          url: string
        }
        Update: {
          ai_persona_id?: string
          created_at?: string | null
          deleted_at?: string | null
          etag?: string | null
          id?: string
          is_active?: boolean | null
          is_paywalled?: boolean | null
          label?: string | null
          last_checked_at?: string | null
          last_item_published_at?: string | null
          last_listing_hash?: string | null
          type?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "persona_sources_ai_persona_id_fkey"
            columns: ["ai_persona_id"]
            isOneToOne: false
            referencedRelation: "ai_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      player_stats: {
        Row: {
          def_block: number | null
          def_fumble_recoveries: number | null
          def_interceptions: number | null
          def_points_allowed: number | null
          def_return_td: number | null
          def_sacks: number | null
          def_safeties: number | null
          def_tds: number | null
          def_yards_allowed: number | null
          fg_0_39: number | null
          fg_attempted: number | null
          fg_made: number | null
          fg_made_40_plus: number | null
          fg_made_50_plus: number | null
          fg_missed: number | null
          fumble_recovery_td: number | null
          fumbles_lost: number | null
          game_clock: string | null
          game_id: string | null
          game_quarter: number | null
          id: string
          interceptions: number | null
          is_live: boolean | null
          pass_2pt: number | null
          pass_attempts: number | null
          pass_completions: number | null
          pass_tds: number | null
          pass_yards: number | null
          pat_missed: number | null
          player_game_status: string | null
          player_id: string | null
          rec_2pt: number | null
          receiving_tds: number | null
          receiving_yards: number | null
          receptions: number | null
          return_td: number | null
          rush_2pt: number | null
          rush_attempts: number | null
          rush_tds: number | null
          rush_yards: number | null
          sacks_taken: number | null
          season: number
          source: string | null
          stat_type: string
          targets: number | null
          two_point_conversions: number | null
          updated_at: string | null
          week: number | null
          xp_attempted: number | null
          xp_made: number | null
        }
        Insert: {
          def_block?: number | null
          def_fumble_recoveries?: number | null
          def_interceptions?: number | null
          def_points_allowed?: number | null
          def_return_td?: number | null
          def_sacks?: number | null
          def_safeties?: number | null
          def_tds?: number | null
          def_yards_allowed?: number | null
          fg_0_39?: number | null
          fg_attempted?: number | null
          fg_made?: number | null
          fg_made_40_plus?: number | null
          fg_made_50_plus?: number | null
          fg_missed?: number | null
          fumble_recovery_td?: number | null
          fumbles_lost?: number | null
          game_clock?: string | null
          game_id?: string | null
          game_quarter?: number | null
          id?: string
          interceptions?: number | null
          is_live?: boolean | null
          pass_2pt?: number | null
          pass_attempts?: number | null
          pass_completions?: number | null
          pass_tds?: number | null
          pass_yards?: number | null
          pat_missed?: number | null
          player_game_status?: string | null
          player_id?: string | null
          rec_2pt?: number | null
          receiving_tds?: number | null
          receiving_yards?: number | null
          receptions?: number | null
          return_td?: number | null
          rush_2pt?: number | null
          rush_attempts?: number | null
          rush_tds?: number | null
          rush_yards?: number | null
          sacks_taken?: number | null
          season: number
          source?: string | null
          stat_type?: string
          targets?: number | null
          two_point_conversions?: number | null
          updated_at?: string | null
          week?: number | null
          xp_attempted?: number | null
          xp_made?: number | null
        }
        Update: {
          def_block?: number | null
          def_fumble_recoveries?: number | null
          def_interceptions?: number | null
          def_points_allowed?: number | null
          def_return_td?: number | null
          def_sacks?: number | null
          def_safeties?: number | null
          def_tds?: number | null
          def_yards_allowed?: number | null
          fg_0_39?: number | null
          fg_attempted?: number | null
          fg_made?: number | null
          fg_made_40_plus?: number | null
          fg_made_50_plus?: number | null
          fg_missed?: number | null
          fumble_recovery_td?: number | null
          fumbles_lost?: number | null
          game_clock?: string | null
          game_id?: string | null
          game_quarter?: number | null
          id?: string
          interceptions?: number | null
          is_live?: boolean | null
          pass_2pt?: number | null
          pass_attempts?: number | null
          pass_completions?: number | null
          pass_tds?: number | null
          pass_yards?: number | null
          pat_missed?: number | null
          player_game_status?: string | null
          player_id?: string | null
          rec_2pt?: number | null
          receiving_tds?: number | null
          receiving_yards?: number | null
          receptions?: number | null
          return_td?: number | null
          rush_2pt?: number | null
          rush_attempts?: number | null
          rush_tds?: number | null
          rush_yards?: number | null
          sacks_taken?: number | null
          season?: number
          source?: string | null
          stat_type?: string
          targets?: number | null
          two_point_conversions?: number | null
          updated_at?: string | null
          week?: number | null
          xp_attempted?: number | null
          xp_made?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_stats_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nfl_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_usage: {
        Row: {
          player_id: string
          season: number
          snap_pct: number | null
          target_share: number | null
          updated_at: string
        }
        Insert: {
          player_id: string
          season: number
          snap_pct?: number | null
          target_share?: number | null
          updated_at?: string
        }
        Update: {
          player_id?: string
          season?: number
          snap_pct?: number | null
          target_share?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_usage_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          adp: number | null
          auction_updated_at: string | null
          auction_value: number | null
          birth_date: string | null
          bye_week: number | null
          college: string | null
          depth_chart_order: number | null
          depth_chart_position: string | null
          draft_pick: number | null
          draft_round: number | null
          draft_year: number | null
          espn_id: string | null
          experience_years: number | null
          first_name: string | null
          full_name: string
          headshot_url: string | null
          height: string | null
          id: string
          injury_body_part: string | null
          injury_notes: string | null
          injury_start_date: string | null
          jersey_number: number | null
          last_name: string | null
          position: string
          practice_participation: string | null
          projected_games: number | null
          projected_pts_half_ppr: number | null
          projected_pts_ppr: number | null
          projected_pts_standard: number | null
          projected_stats: Json | null
          projections_season: number | null
          projections_updated_at: string | null
          search_name: string | null
          sleeper_id: string | null
          sos: number | null
          status: string | null
          team: string | null
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          adp?: number | null
          auction_updated_at?: string | null
          auction_value?: number | null
          birth_date?: string | null
          bye_week?: number | null
          college?: string | null
          depth_chart_order?: number | null
          depth_chart_position?: string | null
          draft_pick?: number | null
          draft_round?: number | null
          draft_year?: number | null
          espn_id?: string | null
          experience_years?: number | null
          first_name?: string | null
          full_name: string
          headshot_url?: string | null
          height?: string | null
          id: string
          injury_body_part?: string | null
          injury_notes?: string | null
          injury_start_date?: string | null
          jersey_number?: number | null
          last_name?: string | null
          position: string
          practice_participation?: string | null
          projected_games?: number | null
          projected_pts_half_ppr?: number | null
          projected_pts_ppr?: number | null
          projected_pts_standard?: number | null
          projected_stats?: Json | null
          projections_season?: number | null
          projections_updated_at?: string | null
          search_name?: string | null
          sleeper_id?: string | null
          sos?: number | null
          status?: string | null
          team?: string | null
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          adp?: number | null
          auction_updated_at?: string | null
          auction_value?: number | null
          birth_date?: string | null
          bye_week?: number | null
          college?: string | null
          depth_chart_order?: number | null
          depth_chart_position?: string | null
          draft_pick?: number | null
          draft_round?: number | null
          draft_year?: number | null
          espn_id?: string | null
          experience_years?: number | null
          first_name?: string | null
          full_name?: string
          headshot_url?: string | null
          height?: string | null
          id?: string
          injury_body_part?: string | null
          injury_notes?: string | null
          injury_start_date?: string | null
          jersey_number?: number | null
          last_name?: string | null
          position?: string
          practice_participation?: string | null
          projected_games?: number | null
          projected_pts_half_ppr?: number | null
          projected_pts_ppr?: number | null
          projected_pts_standard?: number | null
          projected_stats?: Json | null
          projections_season?: number | null
          projections_updated_at?: string | null
          search_name?: string | null
          sleeper_id?: string | null
          sos?: number | null
          status?: string | null
          team?: string | null
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          cred_rank: number | null
          cred_score: number | null
          follower_count: number | null
          following_count: number | null
          id: string
          is_admin: boolean
          is_pro: boolean | null
          stripe_customer_id: string | null
          subscription_status: string | null
          updated_at: string | null
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          cred_rank?: number | null
          cred_score?: number | null
          follower_count?: number | null
          following_count?: number | null
          id: string
          is_admin?: boolean
          is_pro?: boolean | null
          stripe_customer_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          cred_rank?: number | null
          cred_score?: number | null
          follower_count?: number | null
          following_count?: number | null
          id?: string
          is_admin?: boolean
          is_pro?: boolean | null
          stripe_customer_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          username?: string
        }
        Relationships: []
      }
      ranking_history: {
        Row: {
          changed_at: string | null
          id: string
          list_id: string | null
          new_rank: number | null
          old_rank: number | null
          player_id: string | null
        }
        Insert: {
          changed_at?: string | null
          id?: string
          list_id?: string | null
          new_rank?: number | null
          old_rank?: number | null
          player_id?: string | null
        }
        Update: {
          changed_at?: string | null
          id?: string
          list_id?: string | null
          new_rank?: number | null
          old_rank?: number | null
          player_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ranking_history_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ranking_history_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      research_configs: {
        Row: {
          columns: Json
          created_at: string | null
          filters: Json
          id: string
          name: string
          owner_id: string
          position_filter: string | null
          scoring_system_id: string | null
          sort_by: string | null
          sort_direction: string | null
          updated_at: string | null
        }
        Insert: {
          columns?: Json
          created_at?: string | null
          filters?: Json
          id?: string
          name: string
          owner_id: string
          position_filter?: string | null
          scoring_system_id?: string | null
          sort_by?: string | null
          sort_direction?: string | null
          updated_at?: string | null
        }
        Update: {
          columns?: Json
          created_at?: string | null
          filters?: Json
          id?: string
          name?: string
          owner_id?: string
          position_filter?: string | null
          scoring_system_id?: string | null
          sort_by?: string | null
          sort_direction?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "research_configs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_configs_scoring_system_id_fkey"
            columns: ["scoring_system_id"]
            isOneToOne: false
            referencedRelation: "scoring_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_systems: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_system_default: boolean | null
          is_template: boolean
          name: string
          owner_id: string | null
          rules: Json
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_system_default?: boolean | null
          is_template?: boolean
          name: string
          owner_id?: string | null
          rules: Json
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_system_default?: boolean | null
          is_template?: boolean
          name?: string
          owner_id?: string | null
          rules?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scoring_systems_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      start_sit_questions: {
        Row: {
          context_note: string | null
          correct_player: string | null
          created_at: string | null
          id: string
          is_voided: boolean | null
          player_a_id: string
          player_b_id: string
          poster_id: string
          resolved_at: string | null
          scoring_system_id: string | null
          season: number
          vote_count_a: number | null
          vote_count_b: number | null
          voting_closes_at: string
          week: number
        }
        Insert: {
          context_note?: string | null
          correct_player?: string | null
          created_at?: string | null
          id?: string
          is_voided?: boolean | null
          player_a_id: string
          player_b_id: string
          poster_id: string
          resolved_at?: string | null
          scoring_system_id?: string | null
          season: number
          vote_count_a?: number | null
          vote_count_b?: number | null
          voting_closes_at: string
          week: number
        }
        Update: {
          context_note?: string | null
          correct_player?: string | null
          created_at?: string | null
          id?: string
          is_voided?: boolean | null
          player_a_id?: string
          player_b_id?: string
          poster_id?: string
          resolved_at?: string | null
          scoring_system_id?: string | null
          season?: number
          vote_count_a?: number | null
          vote_count_b?: number | null
          voting_closes_at?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "start_sit_questions_player_a_id_fkey"
            columns: ["player_a_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "start_sit_questions_player_b_id_fkey"
            columns: ["player_b_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "start_sit_questions_poster_id_fkey"
            columns: ["poster_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "start_sit_questions_scoring_system_id_fkey"
            columns: ["scoring_system_id"]
            isOneToOne: false
            referencedRelation: "scoring_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      start_sit_votes: {
        Row: {
          cred_points_earned: number | null
          id: string
          is_correct: boolean | null
          question_id: string
          voted_at: string | null
          voted_for: string
          voter_id: string
        }
        Insert: {
          cred_points_earned?: number | null
          id?: string
          is_correct?: boolean | null
          question_id: string
          voted_at?: string | null
          voted_for: string
          voter_id: string
        }
        Update: {
          cred_points_earned?: number | null
          id?: string
          is_correct?: boolean | null
          question_id?: string
          voted_at?: string | null
          voted_for?: string
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "start_sit_votes_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "start_sit_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "start_sit_votes_voter_id_fkey"
            columns: ["voter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_system_tag: boolean | null
          name: string
          slug: string
          use_count: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_system_tag?: boolean | null
          name: string
          slug: string
          use_count?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_system_tag?: boolean | null
          name?: string
          slug?: string
          use_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_lineups: {
        Row: {
          bench: Json
          id: string
          season: number
          set_at: string | null
          starters: Json
          team_id: string
          total_points: number | null
          week: number
        }
        Insert: {
          bench: Json
          id?: string
          season: number
          set_at?: string | null
          starters: Json
          team_id: string
          total_points?: number | null
          week: number
        }
        Update: {
          bench?: Json
          id?: string
          season?: number
          set_at?: string | null
          starters?: Json
          team_id?: string
          total_points?: number | null
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "team_lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_managers: {
        Row: {
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          ended_week: number | null
          id: string
          league_id: string
          role: string
          started_at: string
          started_week: number | null
          team_id: string
          user_id: string
        }
        Insert: {
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          ended_week?: number | null
          id?: string
          league_id: string
          role?: string
          started_at?: string
          started_week?: number | null
          team_id: string
          user_id: string
        }
        Update: {
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          ended_week?: number | null
          id?: string
          league_id?: string
          role?: string
          started_at?: string
          started_week?: number | null
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_managers_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_managers_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_managers_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_managers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string | null
          id: string
          league_id: string | null
          list_id: string | null
          losses: number | null
          name: string
          owner_id: string
          retired_at_week: number | null
          scoring_system_id: string | null
          status: string
          successor_team_id: string | null
          total_points: number | null
          updated_at: string | null
          wins: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          league_id?: string | null
          list_id?: string | null
          losses?: number | null
          name: string
          owner_id: string
          retired_at_week?: number | null
          scoring_system_id?: string | null
          status?: string
          successor_team_id?: string | null
          total_points?: number | null
          updated_at?: string | null
          wins?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          league_id?: string | null
          list_id?: string | null
          losses?: number | null
          name?: string
          owner_id?: string
          retired_at_week?: number | null
          scoring_system_id?: string | null
          status?: string
          successor_team_id?: string | null
          total_points?: number | null
          updated_at?: string | null
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_scoring_system_id_fkey"
            columns: ["scoring_system_id"]
            isOneToOne: false
            referencedRelation: "scoring_systems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_successor_team_id_fkey"
            columns: ["successor_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_rankings: {
        Row: {
          accuracy_score: number | null
          cred_points_earned: number | null
          id: string
          position: string
          rankings: Json
          season: number
          submitted_at: string | null
          user_id: string
          week: number
        }
        Insert: {
          accuracy_score?: number | null
          cred_points_earned?: number | null
          id?: string
          position: string
          rankings: Json
          season: number
          submitted_at?: string | null
          user_id: string
          week: number
        }
        Update: {
          accuracy_score?: number | null
          cred_points_earned?: number | null
          id?: string
          position?: string
          rankings?: Json
          season?: number
          submitted_at?: string | null
          user_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_rankings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      active_game_window: {
        Row: {
          is_active: boolean | null
        }
        Relationships: []
      }
      consensus_rankings: {
        Row: {
          average_rank: number | null
          consensus_position_rank: number | null
          full_name: string | null
          player_id: string | null
          position: string | null
          ranker_count: number | null
          team: string | null
          weighted_rank: number | null
        }
        Relationships: [
          {
            foreignKeyName: "list_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_placeholder_seat: {
        Args: { p_league_id: string; p_team_name?: string }
        Returns: Json
      }
      applied_migration_versions: {
        Args: never
        Returns: {
          version: string
        }[]
      }
      assign_manager: {
        Args: { p_league_id: string; p_team_id: string; p_user_id: string }
        Returns: Json
      }
      claim_ai_generation: {
        Args: { p_feature: string; p_limit: number; p_user_id: string }
        Returns: {
          daily_limit: number
          is_allowed: boolean
          used_today: number
        }[]
      }
      claim_league_invite: { Args: { p_token: string }; Returns: Json }
      create_league: {
        Args: {
          p_action_id: string
          p_faab_budget: number
          p_format: string
          p_lineup_lock: string
          p_name: string
          p_playoff_start_week: number
          p_playoff_teams: number
          p_regular_season_weeks: number
          p_roster_settings: Json
          p_scoring_system_id: string
          p_season: number
          p_settings: Json
          p_team_count: number
          p_team_name: string
          p_trade_deadline_week: number
          p_trade_review: string
          p_waiver_type: string
        }
        Returns: Json
      }
      create_league_invite: {
        Args: {
          p_invited_email?: string
          p_invited_username?: string
          p_league_id: string
          p_max_uses?: number
          p_target_team_id?: string
        }
        Returns: Json
      }
      create_mock_draft: {
        Args: {
          p_action_id?: string
          p_cpu_speed?: string
          p_human_team_id?: string
          p_league_id: string
        }
        Returns: Json
      }
      delete_mock_draft: { Args: { p_draft_id: string }; Returns: undefined }
      draft_actor_name: { Args: never; Returns: string }
      draft_adjust_budget: {
        Args: {
          p_delta: number
          p_draft_id: string
          p_reason?: string
          p_team_id: string
        }
        Returns: Json
      }
      draft_apply_pick_internal: {
        Args: {
          p_action_id: string
          p_draft_id: string
          p_is_auto: boolean
          p_made_via: string
          p_picked_by: string
          p_player_id: string
        }
        Returns: Json
      }
      draft_auction_high_bid_gate_internal: {
        Args: {
          p_draft: Database["public"]["Tables"]["drafts"]["Row"]
          p_remedy: string
          p_team_id: string
          p_verb: string
        }
        Returns: undefined
      }
      draft_auction_pause_gate_internal: {
        Args: {
          p_draft: Database["public"]["Tables"]["drafts"]["Row"]
          p_verb: string
        }
        Returns: undefined
      }
      draft_auction_solvent: { Args: { p_draft_id: string }; Returns: boolean }
      draft_autopick_resolve: {
        Args: { p_draft_id: string; p_team_id: string }
        Returns: string
      }
      draft_broadcast_payload: {
        Args: { d: Database["public"]["Tables"]["drafts"]["Row"] }
        Returns: Json
      }
      draft_cancel_nomination: {
        Args: { p_draft_id: string; p_reason?: string }
        Returns: Json
      }
      draft_complete_internal: {
        Args: { p_draft_id: string }
        Returns: {
          budget_adjustments: Json
          completed_at: string | null
          config: Json
          created_at: string | null
          current_deadline: string | null
          current_nomination: Json | null
          current_pick_number: number | null
          current_round: number | null
          deadline_remaining_ms: number | null
          draft_order: Json | null
          draft_type: string
          id: string
          is_mock: boolean
          league_id: string
          nomination_order: Json | null
          on_clock_team_id: string | null
          paused_at: string | null
          started_at: string | null
          status: string
          total_rounds: number | null
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "drafts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      draft_create: { Args: { p_league_id: string }; Returns: Json }
      draft_create_internal: {
        Args: { p_league_id: string; p_require_commish: boolean }
        Returns: Json
      }
      draft_end: {
        Args: { p_draft_id: string; p_reason?: string }
        Returns: Json
      }
      draft_force_pick: {
        Args: {
          p_action_id?: string
          p_draft_id: string
          p_player_id: string
          p_reason?: string
        }
        Returns: Json
      }
      draft_liveness_freshness: { Args: never; Returns: string }
      draft_make_pick: {
        Args: { p_action_id: string; p_draft_id: string; p_player_id: string }
        Returns: Json
      }
      draft_mock_cpu_due: {
        Args: {
          p_config: Json
          p_current_deadline: string
          p_draft_id: string
          p_pick_number: number
          p_updated_at: string
        }
        Returns: string
      }
      draft_mock_think_fraction: {
        Args: { p_draft_id: string; p_pick_number: number }
        Returns: number
      }
      draft_move_player: {
        Args: {
          p_draft_id: string
          p_from_team: string
          p_player_id: string
          p_price?: number
          p_reason?: string
          p_to_team: string
        }
        Returns: Json
      }
      draft_nominate: {
        Args: {
          p_action_id: string
          p_draft_id: string
          p_opening_bid: number
          p_player_id: string
        }
        Returns: Json
      }
      draft_nomination_order_internal: {
        Args: {
          p_candidate: Json
          p_draft_order: Json
          p_label: string
          p_league_id: string
          p_mode: string
          p_seed: string
          p_team_count: number
        }
        Returns: Json
      }
      draft_pause: {
        Args: { p_draft_id: string; p_reason?: string }
        Returns: Json
      }
      draft_pause_internal: {
        Args: { p_actor: string; p_draft_id: string; p_message: string }
        Returns: Json
      }
      draft_pick_broadcast_payload: {
        Args: { p: Database["public"]["Tables"]["draft_picks"]["Row"] }
        Returns: Json
      }
      draft_place_bid: {
        Args: {
          p_action_id: string
          p_amount: number
          p_draft_id: string
          p_nomination_seq?: number
          p_player_id?: string
        }
        Returns: Json
      }
      draft_queue_replace: {
        Args: { p_draft_id: string; p_players: string[]; p_team_id: string }
        Returns: Json
      }
      draft_reassign_pick: {
        Args: {
          p_draft_id: string
          p_pick_id: string
          p_player_id?: string
          p_price?: number
          p_reason?: string
          p_team_id?: string
        }
        Returns: Json
      }
      draft_reset: {
        Args: { p_draft_id: string; p_reason?: string }
        Returns: Json
      }
      draft_resolve_order_internal: {
        Args: {
          p_candidate: Json
          p_config_order: Json
          p_label: string
          p_league_id: string
          p_mode: string
          p_seed: string
          p_team_count: number
        }
        Returns: Json
      }
      draft_resume: {
        Args: { p_draft_id: string; p_reason?: string }
        Returns: Json
      }
      draft_reverse_won_bid: {
        Args: { p_draft_id: string; p_pick_id: string; p_reason?: string }
        Returns: Json
      }
      draft_rounds_from_roster: { Args: { p_roster: Json }; Returns: number }
      draft_set_clock: {
        Args: {
          p_anti_snipe_seconds?: number
          p_bid_seconds?: number
          p_draft_id: string
          p_extend_current?: boolean
          p_nomination_seconds?: number
          p_pick_timer_seconds?: number
          p_reason?: string
        }
        Returns: Json
      }
      draft_set_order: {
        Args: { p_draft_id: string; p_order: string[]; p_reason?: string }
        Returns: Json
      }
      draft_start: { Args: { p_league_id: string }; Returns: Json }
      draft_start_internal: {
        Args: { p_league_id: string; p_require_commish: boolean }
        Returns: Json
      }
      draft_team_budget: {
        Args: { p_draft_id: string; p_team_id: string }
        Returns: {
          committed: number
          max_bid: number
          open_slots: number
          remaining: number
        }[]
      }
      draft_team_for_pick: {
        Args: {
          p_draft_order: Json
          p_draft_type: string
          p_pick_number: number
          p_snake_reversal: boolean
        }
        Returns: string
      }
      draft_tick: { Args: never; Returns: Json }
      draft_touch: { Args: { p_draft_id: string }; Returns: undefined }
      draft_undo: {
        Args: {
          p_draft_id: string
          p_reason?: string
          p_to_pick_number?: number
        }
        Returns: Json
      }
      draft_void_nomination_internal: {
        Args: { p_draft_id: string }
        Returns: number
      }
      duplicate_list: {
        Args: {
          p_force_public?: boolean
          p_slug: string
          p_source_id: string
          p_title: string
        }
        Returns: {
          ai_persona_id: string | null
          comments_enabled: boolean | null
          created_at: string | null
          deleted_at: string | null
          description: string | null
          folder_id: string | null
          hide_order: boolean | null
          id: string
          is_big_board: boolean | null
          is_favorited: boolean | null
          is_favorites: boolean
          is_private: boolean | null
          is_team: boolean | null
          like_count: number | null
          owner_id: string
          player_count: number | null
          position_filter: string | null
          ranking_mode: string
          roster_settings: Json | null
          scoring_system_id: string | null
          slug: string
          thumbnail_url: string | null
          tiers_enabled: boolean | null
          title: string
          updated_at: string | null
          view_count: number | null
        }
        SetofOptions: {
          from: "*"
          to: "lists"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_join_preview: { Args: { p_value: string }; Returns: Json }
      is_league_commish: { Args: { p_league_id: string }; Returns: boolean }
      is_league_member: { Args: { p_league_id: string }; Returns: boolean }
      join_league_by_code: { Args: { p_code_or_slug: string }; Returns: Json }
      league_broadcast_payload: {
        Args: { l: Database["public"]["Tables"]["leagues"]["Row"] }
        Returns: Json
      }
      league_chat_broadcast_payload: {
        Args: { c: Database["public"]["Tables"]["league_chat"]["Row"] }
        Returns: Json
      }
      league_roster_broadcast_payload: {
        Args: { r: Database["public"]["Tables"]["league_rosters"]["Row"] }
        Returns: Json
      }
      leave_league: { Args: { p_league_id: string }; Returns: Json }
      mock_draft_expire: { Args: never; Returns: Json }
      notify_league_invite_internal: {
        Args: {
          p_league_id: string
          p_league_name: string
          p_team_name: string
          p_token: string
          p_user_id: string
        }
        Returns: undefined
      }
      notify_league_member_internal: {
        Args: {
          p_body: string
          p_data: Json
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      notify_list_followers: {
        Args: { p_actor: string; p_list_id: string }
        Returns: undefined
      }
      release_ai_generation: {
        Args: { p_feature: string; p_user_id: string }
        Returns: number
      }
      remove_manager: {
        Args: {
          p_league_id: string
          p_member_id: string
          p_mode: string
          p_reason?: string
          p_successor_user_id?: string
        }
        Returns: Json
      }
      reorder_list_players: {
        Args: { p_list_id: string; p_positions: Json }
        Returns: undefined
      }
      revoke_league_invite: {
        Args: { p_invite_id: string; p_league_id: string }
        Returns: undefined
      }
      rotate_invite_code: { Args: { p_league_id: string }; Returns: Json }
      seat_league_member_internal: {
        Args: {
          p_faab_budget: number
          p_league_id: string
          p_team_id?: string
          p_user_id: string
        }
        Returns: string
      }
      set_league_invite_slug: {
        Args: { p_league_id: string; p_slug: string }
        Returns: Json
      }
      set_league_status: {
        Args: { p_league_id: string; p_status: string }
        Returns: undefined
      }
      set_member_role: {
        Args: { p_league_id: string; p_member_id: string; p_role: string }
        Returns: Json
      }
      set_team_autodraft: {
        Args: {
          p_league_id: string
          p_on: boolean
          p_reason?: string
          p_team_id: string
        }
        Returns: Json
      }
      snapshot_league_scoring: {
        Args: { p_league_id: string }
        Returns: undefined
      }
      snapshot_league_scoring_internal: {
        Args: { p_league_id: string }
        Returns: undefined
      }
      soft_delete_league: { Args: { p_league_id: string }; Returns: undefined }
      update_league_profile: {
        Args: {
          p_avatar_url?: string
          p_clear_avatar?: boolean
          p_league_id: string
          p_name?: string
        }
        Returns: undefined
      }
      update_league_settings: {
        Args: {
          p_faab_budget: number
          p_format: string
          p_league_id: string
          p_lineup_lock: string
          p_playoff_start_week: number
          p_playoff_teams: number
          p_regular_season_weeks: number
          p_roster_settings: Json
          p_scoring_system_id: string
          p_settings: Json
          p_team_count: number
          p_trade_deadline_week: number
          p_trade_review: string
          p_waiver_type: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

// ============================================================================
// Hand-written convenience aliases.
//
// These are NOT emitted by `supabase gen types`. Keep this block when
// regenerating database.ts (or re-add it) — the app imports these from
// `@/types/database`.
// ============================================================================

export type AiCallLog = Database['public']['Tables']['ai_call_log']['Row']
export type AiPersona = Database['public']['Tables']['ai_personas']['Row']
export type Draft = Database['public']['Tables']['drafts']['Row']
export type DraftBid = Database['public']['Tables']['draft_bids']['Row']
export type DraftPick = Database['public']['Tables']['draft_picks']['Row']
export type DraftLiveness = Database['public']['Tables']['draft_liveness']['Row']
export type DraftDndMark = Database['public']['Tables']['draft_dnd_marks']['Row']
export type DraftQueueEntry = Database['public']['Tables']['draft_queues']['Row']
export type League = Database['public']['Tables']['leagues']['Row']
export type LeagueInvite = Database['public']['Tables']['league_invites']['Row']
export type LeagueList = Database['public']['Tables']['league_lists']['Row']
export type LeagueMember = Database['public']['Tables']['league_members']['Row']
export type LeagueRoster = Database['public']['Tables']['league_rosters']['Row']
export type LeagueWeek = Database['public']['Tables']['league_weeks']['Row']
export type List = Database['public']['Tables']['lists']['Row']
export type ListComment = Database['public']['Tables']['list_comments']['Row']
export type ListFolder = Database['public']['Tables']['list_folders']['Row']
export type ListPlayer = Database['public']['Tables']['list_players']['Row']
export type PersonaContentItem =
  Database['public']['Tables']['persona_content_items']['Row']
export type PersonaContextRow =
  Database['public']['Tables']['persona_context']['Row']
export type PersonaPost = Database['public']['Tables']['persona_posts']['Row']
export type PersonaSource = Database['public']['Tables']['persona_sources']['Row']
export type PersonaSourceRanking =
  Database['public']['Tables']['persona_source_rankings']['Row']
export type Player = Database['public']['Tables']['players']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']
export type ScoringSystem = Database['public']['Tables']['scoring_systems']['Row']
export type Tag = Database['public']['Tables']['tags']['Row']
export type Team = Database['public']['Tables']['teams']['Row']
export type TeamManager = Database['public']['Tables']['team_managers']['Row']

/** Tier grade a player can be assigned within a ranked list. */
export type ListTier = 'S' | 'A' | 'B' | 'C' | 'D' | 'F'

/** Roster slot a player can occupy in a team list (mirrors the list_players.slot CHECK). */
export type TeamSlot =
  | 'QB'
  | 'RB'
  | 'WR'
  | 'FLEX'
  | 'TE'
  | 'DST'
  | 'K'
  | 'IR'
  | 'BENCH'

/** Shape of lists.roster_settings (JSONB) for team lists. */
export interface ListRosterSettings {
  total: number
  qb: number
  rb: number
  wr: number
  te: number
  flex: number
  k: number
  dst: number
  bench: number
  ir: number
}
