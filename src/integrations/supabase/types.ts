export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_settings: {
        Row: {
          budget_mode: boolean
          created_at: string
          default_llm_provider: string
          default_transcription_provider: string
          model_overrides: Json
          provider_keys: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          budget_mode?: boolean
          created_at?: string
          default_llm_provider?: string
          default_transcription_provider?: string
          model_overrides?: Json
          provider_keys?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          budget_mode?: boolean
          created_at?: string
          default_llm_provider?: string
          default_transcription_provider?: string
          model_overrides?: Json
          provider_keys?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      analysis_versions: {
        Row: {
          analysis_data: Json
          created_at: string
          id: string
          model: string | null
          models_used: Json
          project_id: string
          provider: string | null
          task: string
          version: number
        }
        Insert: {
          analysis_data?: Json
          created_at?: string
          id?: string
          model?: string | null
          models_used?: Json
          project_id: string
          provider?: string | null
          task: string
          version?: number
        }
        Update: {
          analysis_data?: Json
          created_at?: string
          id?: string
          model?: string | null
          models_used?: Json
          project_id?: string
          provider?: string | null
          task?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "analysis_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_candidates: {
        Row: {
          asset_type: string
          candidate_data: Json
          created_at: string
          id: string
          priority: number
          project_id: string
          provider: string
          scene_id: string | null
          search_query: string
          status: string
          storyboard_item_id: string | null
        }
        Insert: {
          asset_type: string
          candidate_data?: Json
          created_at?: string
          id?: string
          priority?: number
          project_id: string
          provider?: string
          scene_id?: string | null
          search_query: string
          status?: string
          storyboard_item_id?: string | null
        }
        Update: {
          asset_type?: string
          candidate_data?: Json
          created_at?: string
          id?: string
          priority?: number
          project_id?: string
          provider?: string
          scene_id?: string | null
          search_query?: string
          status?: string
          storyboard_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_candidates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_candidates_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_candidates_storyboard_item_id_fkey"
            columns: ["storyboard_item_id"]
            isOneToOne: false
            referencedRelation: "storyboard_items"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          asset_type: string
          created_at: string
          description: string | null
          duration_seconds: number | null
          height: number | null
          id: string
          metadata: Json
          project_id: string
          scene_id: string | null
          source_type: string
          status: string
          thumbnail_url: string | null
          title: string | null
          updated_at: string
          url: string | null
          width: number | null
        }
        Insert: {
          asset_type: string
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          height?: number | null
          id?: string
          metadata?: Json
          project_id: string
          scene_id?: string | null
          source_type: string
          status?: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          url?: string | null
          width?: number | null
        }
        Update: {
          asset_type?: string
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          height?: number | null
          id?: string
          metadata?: Json
          project_id?: string
          scene_id?: string | null
          source_type?: string
          status?: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          url?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action_type: string
          created_at: string
          id: string
          payload: Json
          project_id: string | null
          user_id: string
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          payload?: Json
          project_id?: string | null
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          payload?: Json
          project_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      broll_items: {
        Row: {
          asset_status: string
          asset_url: string | null
          created_at: string
          id: string
          item_index: number
          keyword: string
          placement_reason: string
          project_id: string
          recommended_end: number
          recommended_start: number
          scene_id: string | null
          search_prompt: string
        }
        Insert: {
          asset_status?: string
          asset_url?: string | null
          created_at?: string
          id?: string
          item_index?: number
          keyword?: string
          placement_reason?: string
          project_id: string
          recommended_end?: number
          recommended_start?: number
          scene_id?: string | null
          search_prompt?: string
        }
        Update: {
          asset_status?: string
          asset_url?: string | null
          created_at?: string
          id?: string
          item_index?: number
          keyword?: string
          placement_reason?: string
          project_id?: string
          recommended_end?: number
          recommended_start?: number
          scene_id?: string | null
          search_prompt?: string
        }
        Relationships: [
          {
            foreignKeyName: "broll_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broll_items_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      edit_actions: {
        Row: {
          action_type: string
          asset_query: string | null
          created_at: string
          duration: number
          end_time: number
          id: string
          layer: number
          layout_id: string | null
          parameters: Json
          priority: number
          project_id: string
          scene_id: string | null
          source: string
          start_time: number
          storyboard_item_id: string | null
          transition_in_id: string | null
          transition_out_id: string | null
          updated_at: string
        }
        Insert: {
          action_type: string
          asset_query?: string | null
          created_at?: string
          duration?: number
          end_time?: number
          id?: string
          layer?: number
          layout_id?: string | null
          parameters?: Json
          priority?: number
          project_id: string
          scene_id?: string | null
          source?: string
          start_time?: number
          storyboard_item_id?: string | null
          transition_in_id?: string | null
          transition_out_id?: string | null
          updated_at?: string
        }
        Update: {
          action_type?: string
          asset_query?: string | null
          created_at?: string
          duration?: number
          end_time?: number
          id?: string
          layer?: number
          layout_id?: string | null
          parameters?: Json
          priority?: number
          project_id?: string
          scene_id?: string | null
          source?: string
          start_time?: number
          storyboard_item_id?: string | null
          transition_in_id?: string | null
          transition_out_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "edit_actions_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "layout_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edit_actions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edit_actions_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edit_actions_storyboard_item_id_fkey"
            columns: ["storyboard_item_id"]
            isOneToOne: false
            referencedRelation: "storyboard_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edit_actions_transition_in_id_fkey"
            columns: ["transition_in_id"]
            isOneToOne: false
            referencedRelation: "transition_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edit_actions_transition_out_id_fkey"
            columns: ["transition_out_id"]
            isOneToOne: false
            referencedRelation: "transition_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      infographic_items: {
        Row: {
          asset_prompt: string
          asset_status: string
          asset_url: string | null
          bullets: Json
          created_at: string
          id: string
          item_index: number
          project_id: string
          scene_id: string | null
          t: string
          title: string
          type: string
        }
        Insert: {
          asset_prompt?: string
          asset_status?: string
          asset_url?: string | null
          bullets?: Json
          created_at?: string
          id?: string
          item_index?: number
          project_id: string
          scene_id?: string | null
          t?: string
          title?: string
          type?: string
        }
        Update: {
          asset_prompt?: string
          asset_status?: string
          asset_url?: string | null
          bullets?: Json
          created_at?: string
          id?: string
          item_index?: number
          project_id?: string
          scene_id?: string | null
          t?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "infographic_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infographic_items_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          kind: string
          progress: number
          project_id: string
          state: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          progress?: number
          project_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          progress?: number
          project_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      layout_decisions: {
        Row: {
          action_id: string | null
          attention_focus: string
          created_at: string
          doctor_size: string
          doctor_visibility: string
          end_time: number
          id: string
          layout_name: string
          project_id: string
          rationale: string | null
          scene_id: string | null
          start_time: number
          updated_at: string
        }
        Insert: {
          action_id?: string | null
          attention_focus?: string
          created_at?: string
          doctor_size?: string
          doctor_visibility?: string
          end_time?: number
          id?: string
          layout_name?: string
          project_id: string
          rationale?: string | null
          scene_id?: string | null
          start_time?: number
          updated_at?: string
        }
        Update: {
          action_id?: string | null
          attention_focus?: string
          created_at?: string
          doctor_size?: string
          doctor_visibility?: string
          end_time?: number
          id?: string
          layout_name?: string
          project_id?: string
          rationale?: string | null
          scene_id?: string | null
          start_time?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "layout_decisions_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "edit_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_decisions_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      layout_templates: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      motion_templates: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      pipeline_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          critical_failures: Json
          duration_ms: number | null
          failures_count: number
          id: string
          pipeline_version: string
          project_id: string
          started_at: string
          status: string
          warnings_count: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          critical_failures?: Json
          duration_ms?: number | null
          failures_count?: number
          id?: string
          pipeline_version?: string
          project_id: string
          started_at?: string
          status?: string
          warnings_count?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          critical_failures?: Json
          duration_ms?: number | null
          failures_count?: number
          id?: string
          pipeline_version?: string
          project_id?: string
          started_at?: string
          status?: string
          warnings_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          specialty: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          specialty?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          specialty?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_context: {
        Row: {
          audience: string | null
          brand_voice: string | null
          broll_types: Json
          content_type: string | null
          created_at: string
          infographic_types: Json
          project_id: string
          render_intent: string | null
          retention_priority: string | null
          scene_patterns: Json
          specialty: string | null
          target_platform: string | null
          thumbnail_style: Json
          updated_at: string
          visual_density: string | null
          visual_style: string | null
        }
        Insert: {
          audience?: string | null
          brand_voice?: string | null
          broll_types?: Json
          content_type?: string | null
          created_at?: string
          infographic_types?: Json
          project_id: string
          render_intent?: string | null
          retention_priority?: string | null
          scene_patterns?: Json
          specialty?: string | null
          target_platform?: string | null
          thumbnail_style?: Json
          updated_at?: string
          visual_density?: string | null
          visual_style?: string | null
        }
        Update: {
          audience?: string | null
          brand_voice?: string | null
          broll_types?: Json
          content_type?: string | null
          created_at?: string
          infographic_types?: Json
          project_id?: string
          render_intent?: string | null
          retention_priority?: string | null
          scene_patterns?: Json
          specialty?: string | null
          target_platform?: string | null
          thumbnail_style?: Json
          updated_at?: string
          visual_density?: string | null
          visual_style?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_context_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          duration_seconds: number | null
          id: string
          specialty_template_id: string | null
          status: string
          title: string
          topic: string | null
          updated_at: string
          user_id: string
          video_path: string | null
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          specialty_template_id?: string | null
          status?: string
          title: string
          topic?: string | null
          updated_at?: string
          user_id: string
          video_path?: string | null
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          specialty_template_id?: string | null
          status?: string
          title?: string
          topic?: string | null
          updated_at?: string
          user_id?: string
          video_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_specialty_template_id_fkey"
            columns: ["specialty_template_id"]
            isOneToOne: false
            referencedRelation: "specialty_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      render_jobs: {
        Row: {
          created_at: string
          id: string
          output_url: string | null
          project_id: string
          provider: string | null
          settings: Json
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          output_url?: string | null
          project_id: string
          provider?: string | null
          settings?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          output_url?: string | null
          project_id?: string
          provider?: string | null
          settings?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "render_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      render_manifest: {
        Row: {
          action_type: string | null
          asset_id: string | null
          asset_query: string
          asset_source: string
          asset_type: string
          asset_url: string | null
          attention_focus: string | null
          caption_style: string
          created_at: string
          doctor_size: string | null
          doctor_visibility: string | null
          edit_action_id: string | null
          id: string
          layer: number | null
          layout_id: string | null
          layout_name: string | null
          priority: number | null
          project_id: string
          rationale: string | null
          render_order: number
          scene_id: string | null
          status: string
          storyboard_item_id: string | null
          timeline_end: number
          timeline_start: number
          transition: string
          transition_in_id: string | null
          transition_out_id: string | null
        }
        Insert: {
          action_type?: string | null
          asset_id?: string | null
          asset_query?: string
          asset_source?: string
          asset_type?: string
          asset_url?: string | null
          attention_focus?: string | null
          caption_style?: string
          created_at?: string
          doctor_size?: string | null
          doctor_visibility?: string | null
          edit_action_id?: string | null
          id?: string
          layer?: number | null
          layout_id?: string | null
          layout_name?: string | null
          priority?: number | null
          project_id: string
          rationale?: string | null
          render_order?: number
          scene_id?: string | null
          status?: string
          storyboard_item_id?: string | null
          timeline_end?: number
          timeline_start?: number
          transition?: string
          transition_in_id?: string | null
          transition_out_id?: string | null
        }
        Update: {
          action_type?: string | null
          asset_id?: string | null
          asset_query?: string
          asset_source?: string
          asset_type?: string
          asset_url?: string | null
          attention_focus?: string | null
          caption_style?: string
          created_at?: string
          doctor_size?: string | null
          doctor_visibility?: string | null
          edit_action_id?: string | null
          id?: string
          layer?: number | null
          layout_id?: string | null
          layout_name?: string | null
          priority?: number | null
          project_id?: string
          rationale?: string | null
          render_order?: number
          scene_id?: string | null
          status?: string
          storyboard_item_id?: string | null
          timeline_end?: number
          timeline_start?: number
          transition?: string
          transition_in_id?: string | null
          transition_out_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "render_manifest_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_manifest_edit_action_id_fkey"
            columns: ["edit_action_id"]
            isOneToOne: false
            referencedRelation: "edit_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_manifest_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "layout_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_manifest_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_manifest_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_manifest_storyboard_item_id_fkey"
            columns: ["storyboard_item_id"]
            isOneToOne: false
            referencedRelation: "storyboard_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_manifest_transition_in_id_fkey"
            columns: ["transition_in_id"]
            isOneToOne: false
            referencedRelation: "transition_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_manifest_transition_out_id_fkey"
            columns: ["transition_out_id"]
            isOneToOne: false
            referencedRelation: "transition_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      render_profiles: {
        Row: {
          created_at: string
          id: string
          intro_video: string | null
          logo: string | null
          name: string
          outro_video: string | null
          subtitle_style: Json
          updated_at: string
          user_id: string
          watermark: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          intro_video?: string | null
          logo?: string | null
          name: string
          outro_video?: string | null
          subtitle_style?: Json
          updated_at?: string
          user_id: string
          watermark?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          intro_video?: string | null
          logo?: string | null
          name?: string
          outro_video?: string | null
          subtitle_style?: Json
          updated_at?: string
          user_id?: string
          watermark?: string | null
        }
        Relationships: []
      }
      scene_assets: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          is_primary: boolean
          render_order: number
          scene_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          render_order?: number
          scene_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          render_order?: number
          scene_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scene_assets_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_transcript_map: {
        Row: {
          id: string
          scene_id: string
          transcript_segment_id: string
        }
        Insert: {
          id?: string
          scene_id: string
          transcript_segment_id: string
        }
        Update: {
          id?: string
          scene_id?: string
          transcript_segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_transcript_map_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scene_transcript_map_transcript_segment_id_fkey"
            columns: ["transcript_segment_id"]
            isOneToOne: false
            referencedRelation: "transcript_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      scenes: {
        Row: {
          created_at: string
          duration: number
          end_time: number
          id: string
          narration_text: string
          objective: string
          project_id: string
          scene_number: number
          start_time: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration?: number
          end_time?: number
          id?: string
          narration_text?: string
          objective?: string
          project_id: string
          scene_number: number
          start_time?: number
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration?: number
          end_time?: number
          id?: string
          narration_text?: string
          objective?: string
          project_id?: string
          scene_number?: number
          start_time?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      specialty_templates: {
        Row: {
          created_at: string
          default_audience: string | null
          default_brand_voice: string | null
          default_broll_types: Json
          default_infographic_types: Json
          default_scene_patterns: Json
          default_thumbnail_style: Json
          default_visual_style: string | null
          id: string
          is_builtin: boolean
          owner_user_id: string | null
          specialty: string
          template_name: string
        }
        Insert: {
          created_at?: string
          default_audience?: string | null
          default_brand_voice?: string | null
          default_broll_types?: Json
          default_infographic_types?: Json
          default_scene_patterns?: Json
          default_thumbnail_style?: Json
          default_visual_style?: string | null
          id?: string
          is_builtin?: boolean
          owner_user_id?: string | null
          specialty: string
          template_name: string
        }
        Update: {
          created_at?: string
          default_audience?: string | null
          default_brand_voice?: string | null
          default_broll_types?: Json
          default_infographic_types?: Json
          default_scene_patterns?: Json
          default_thumbnail_style?: Json
          default_visual_style?: string | null
          id?: string
          is_builtin?: boolean
          owner_user_id?: string | null
          specialty?: string
          template_name?: string
        }
        Relationships: []
      }
      storyboard_items: {
        Row: {
          animation: string
          asset_prompt: string
          asset_status: string
          asset_url: string | null
          created_at: string
          duration_seconds: number
          id: string
          item_index: number
          priority: string
          project_id: string
          render_notes: string | null
          scene_id: string | null
          screen_layout: string
          timeline_end: number
          timeline_start: number
          visual_type: string
        }
        Insert: {
          animation?: string
          asset_prompt?: string
          asset_status?: string
          asset_url?: string | null
          created_at?: string
          duration_seconds?: number
          id?: string
          item_index?: number
          priority?: string
          project_id: string
          render_notes?: string | null
          scene_id?: string | null
          screen_layout?: string
          timeline_end?: number
          timeline_start?: number
          visual_type?: string
        }
        Update: {
          animation?: string
          asset_prompt?: string
          asset_status?: string
          asset_url?: string | null
          created_at?: string
          duration_seconds?: number
          id?: string
          item_index?: number
          priority?: string
          project_id?: string
          render_notes?: string | null
          scene_id?: string | null
          screen_layout?: string
          timeline_end?: number
          timeline_start?: number
          visual_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "storyboard_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storyboard_items_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      task_executions: {
        Row: {
          attempts: Json
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          fallback_stage: string | null
          fallback_used: boolean
          id: string
          model: string | null
          pipeline_run_id: string | null
          project_id: string
          provider: string | null
          retry_count: number
          started_at: string
          status: string
          task_name: string
          validation_errors: Json
          validation_passed: boolean | null
          validation_warnings: Json
        }
        Insert: {
          attempts?: Json
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          fallback_stage?: string | null
          fallback_used?: boolean
          id?: string
          model?: string | null
          pipeline_run_id?: string | null
          project_id: string
          provider?: string | null
          retry_count?: number
          started_at?: string
          status?: string
          task_name: string
          validation_errors?: Json
          validation_passed?: boolean | null
          validation_warnings?: Json
        }
        Update: {
          attempts?: Json
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          fallback_stage?: string | null
          fallback_used?: boolean
          id?: string
          model?: string | null
          pipeline_run_id?: string | null
          project_id?: string
          provider?: string | null
          retry_count?: number
          started_at?: string
          status?: string
          task_name?: string
          validation_errors?: Json
          validation_passed?: boolean | null
          validation_warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "task_executions_pipeline_run_id_fkey"
            columns: ["pipeline_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_executions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      thumbnail_items: {
        Row: {
          asset_prompt: string
          asset_status: string
          asset_url: string | null
          concept: string
          created_at: string
          id: string
          item_index: number
          layout: string
          palette: Json
          project_id: string
          text: string
        }
        Insert: {
          asset_prompt?: string
          asset_status?: string
          asset_url?: string | null
          concept?: string
          created_at?: string
          id?: string
          item_index?: number
          layout?: string
          palette?: Json
          project_id: string
          text?: string
        }
        Update: {
          asset_prompt?: string
          asset_status?: string
          asset_url?: string | null
          concept?: string
          created_at?: string
          id?: string
          item_index?: number
          layout?: string
          palette?: Json
          project_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "thumbnail_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      timeline_instructions: {
        Row: {
          asset_id: string | null
          caption_enabled: boolean
          created_at: string
          duration: number
          id: string
          layer: number
          project_id: string
          render_order: number
          scene_id: string | null
          storyboard_item_id: string | null
          timeline_end: number
          timeline_start: number
          transition: string
        }
        Insert: {
          asset_id?: string | null
          caption_enabled?: boolean
          created_at?: string
          duration?: number
          id?: string
          layer?: number
          project_id: string
          render_order?: number
          scene_id?: string | null
          storyboard_item_id?: string | null
          timeline_end?: number
          timeline_start?: number
          transition?: string
        }
        Update: {
          asset_id?: string | null
          caption_enabled?: boolean
          created_at?: string
          duration?: number
          id?: string
          layer?: number
          project_id?: string
          render_order?: number
          scene_id?: string | null
          storyboard_item_id?: string | null
          timeline_end?: number
          timeline_start?: number
          transition?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_instructions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_instructions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_instructions_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_instructions_storyboard_item_id_fkey"
            columns: ["storyboard_item_id"]
            isOneToOne: false
            referencedRelation: "storyboard_items"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_segments: {
        Row: {
          created_at: string
          duration: number
          end_time: number
          id: string
          project_id: string
          segment_index: number
          start_time: number
          text: string
          word_count: number
        }
        Insert: {
          created_at?: string
          duration?: number
          end_time?: number
          id?: string
          project_id: string
          segment_index: number
          start_time?: number
          text?: string
          word_count?: number
        }
        Update: {
          created_at?: string
          duration?: number
          end_time?: number
          id?: string
          project_id?: string
          segment_index?: number
          start_time?: number
          text?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "transcript_segments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      transcripts: {
        Row: {
          created_at: string
          full_text: string
          language: string | null
          project_id: string
          provider_used: string | null
          updated_at: string
          words: Json
        }
        Insert: {
          created_at?: string
          full_text?: string
          language?: string | null
          project_id: string
          provider_used?: string | null
          updated_at?: string
          words?: Json
        }
        Update: {
          created_at?: string
          full_text?: string
          language?: string | null
          project_id?: string
          provider_used?: string | null
          updated_at?: string
          words?: Json
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      transition_templates: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      usage_logs: {
        Row: {
          created_at: string
          estimated_cost: number
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          project_id: string | null
          provider: string
          task: string
          user_id: string
        }
        Insert: {
          created_at?: string
          estimated_cost?: number
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          project_id?: string | null
          provider: string
          task: string
          user_id: string
        }
        Update: {
          created_at?: string
          estimated_cost?: number
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          project_id?: string | null
          provider?: string
          task?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
