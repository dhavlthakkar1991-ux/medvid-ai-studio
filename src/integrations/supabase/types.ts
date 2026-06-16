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
