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
      artifacts: {
        Row: {
          created_at: string
          id: string
          payload: Json
          run_id: string
        }
        Insert: {
          created_at?: string
          id: string
          payload?: Json
          run_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      compiler_runs: {
        Row: {
          created_at: string
          domain_id: string
          domain_version: string
          id: string
          payload: Json
        }
        Insert: {
          created_at?: string
          domain_id: string
          domain_version: string
          id: string
          payload?: Json
        }
        Update: {
          created_at?: string
          domain_id?: string
          domain_version?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "compiler_runs_domain_fkey"
            columns: ["domain_id", "domain_version"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id", "version"]
          },
        ]
      }
      decisions: {
        Row: {
          created_at: string
          id: string
          payload: Json
          run_id: string
        }
        Insert: {
          created_at?: string
          id: string
          payload?: Json
          run_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decisions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      domains: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          version: string
        }
        Insert: {
          created_at?: string
          id: string
          organization_id?: string
          version: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          version?: string
        }
        Relationships: []
      }
      eval_results: {
        Row: {
          created_at: string
          eval_run_id: string
          id: string
          payload: Json
        }
        Insert: {
          created_at?: string
          eval_run_id: string
          id: string
          payload?: Json
        }
        Update: {
          created_at?: string
          eval_run_id?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "eval_results_eval_run_id_fkey"
            columns: ["eval_run_id"]
            isOneToOne: false
            referencedRelation: "eval_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_runs: {
        Row: {
          created_at: string
          domain_id: string
          domain_version: string
          id: string
          payload: Json
        }
        Insert: {
          created_at?: string
          domain_id: string
          domain_version: string
          id: string
          payload?: Json
        }
        Update: {
          created_at?: string
          domain_id?: string
          domain_version?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "eval_runs_domain_fkey"
            columns: ["domain_id", "domain_version"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id", "version"]
          },
        ]
      }
      jobs: {
        Row: {
          behavior_fingerprint: string | null
          created_at: string
          domain_id: string
          domain_version: string
          id: string
          job: Json
          job_type: string
          objective: string
        }
        Insert: {
          behavior_fingerprint?: string | null
          created_at?: string
          domain_id: string
          domain_version: string
          id: string
          job: Json
          job_type: string
          objective: string
        }
        Update: {
          behavior_fingerprint?: string | null
          created_at?: string
          domain_id?: string
          domain_version?: string
          id?: string
          job?: Json
          job_type?: string
          objective?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_domain_fkey"
            columns: ["domain_id", "domain_version"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id", "version"]
          },
        ]
      }
      learning_runs: {
        Row: {
          created_at: string
          domain_id: string
          domain_version: string
          id: string
          payload: Json
        }
        Insert: {
          created_at?: string
          domain_id: string
          domain_version: string
          id: string
          payload?: Json
        }
        Update: {
          created_at?: string
          domain_id?: string
          domain_version?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "learning_runs_domain_fkey"
            columns: ["domain_id", "domain_version"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id", "version"]
          },
        ]
      }
      runs: {
        Row: {
          agent_version: string | null
          attempt: number
          behavior_fingerprint: string | null
          cost_usd: number | null
          created_at: string
          domain_id: string
          domain_version: string
          error: Json | null
          fallback_count: number
          finished_at: string | null
          human_review: boolean | null
          id: string
          jev_calls: number
          job_id: string
          job_type: string
          latency_ms: number | null
          model_calls: number
          quality_score: number | null
          runtime_metadata: Json
          runtime_name: string
          runtime_version: string
          started_at: string
          status: string
          success: boolean | null
          target: string | null
          tool_calls: number
          workflow_version_id: string | null
        }
        Insert: {
          agent_version?: string | null
          attempt?: number
          behavior_fingerprint?: string | null
          cost_usd?: number | null
          created_at?: string
          domain_id: string
          domain_version: string
          error?: Json | null
          fallback_count?: number
          finished_at?: string | null
          human_review?: boolean | null
          id: string
          jev_calls?: number
          job_id: string
          job_type: string
          latency_ms?: number | null
          model_calls?: number
          quality_score?: number | null
          runtime_metadata?: Json
          runtime_name: string
          runtime_version: string
          started_at: string
          status: string
          success?: boolean | null
          target?: string | null
          tool_calls?: number
          workflow_version_id?: string | null
        }
        Update: {
          agent_version?: string | null
          attempt?: number
          behavior_fingerprint?: string | null
          cost_usd?: number | null
          created_at?: string
          domain_id?: string
          domain_version?: string
          error?: Json | null
          fallback_count?: number
          finished_at?: string | null
          human_review?: boolean | null
          id?: string
          jev_calls?: number
          job_id?: string
          job_type?: string
          latency_ms?: number | null
          model_calls?: number
          quality_score?: number | null
          runtime_metadata?: Json
          runtime_name?: string
          runtime_version?: string
          started_at?: string
          status?: string
          success?: boolean | null
          target?: string | null
          tool_calls?: number
          workflow_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "runs_domain_fkey"
            columns: ["domain_id", "domain_version"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id", "version"]
          },
          {
            foreignKeyName: "runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_workflow_version_id_fkey"
            columns: ["workflow_version_id"]
            isOneToOne: false
            referencedRelation: "workflow_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      trace_events: {
        Row: {
          attempt: number
          behavior_fingerprint: string | null
          created_at: string
          error: Json | null
          id: string
          latency_ms: number | null
          node: string | null
          occurred_at: string
          parent_id: string | null
          payload: Json
          run_id: string
          sequence: number
          type: string
          usage: Json | null
          version: number
        }
        Insert: {
          attempt: number
          behavior_fingerprint?: string | null
          created_at?: string
          error?: Json | null
          id: string
          latency_ms?: number | null
          node?: string | null
          occurred_at: string
          parent_id?: string | null
          payload?: Json
          run_id: string
          sequence: number
          type: string
          usage?: Json | null
          version: number
        }
        Update: {
          attempt?: number
          behavior_fingerprint?: string | null
          created_at?: string
          error?: Json | null
          id?: string
          latency_ms?: number | null
          node?: string | null
          occurred_at?: string
          parent_id?: string | null
          payload?: Json
          run_id?: string
          sequence?: number
          type?: string
          usage?: Json | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "trace_events_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "trace_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trace_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_definitions: {
        Row: {
          created_at: string
          domain_id: string
          domain_version: string
          id: string
          job_type: string
          workflow_key: string
        }
        Insert: {
          created_at?: string
          domain_id: string
          domain_version: string
          id: string
          job_type: string
          workflow_key: string
        }
        Update: {
          created_at?: string
          domain_id?: string
          domain_version?: string
          id?: string
          job_type?: string
          workflow_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_definitions_domain_fkey"
            columns: ["domain_id", "domain_version"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id", "version"]
          },
        ]
      }
      workflow_promotions: {
        Row: {
          actor: string
          created_at: string
          from_status: string
          id: string
          reason: string | null
          to_status: string
          workflow_version_id: string
        }
        Insert: {
          actor: string
          created_at?: string
          from_status: string
          id: string
          reason?: string | null
          to_status: string
          workflow_version_id: string
        }
        Update: {
          actor?: string
          created_at?: string
          from_status?: string
          id?: string
          reason?: string | null
          to_status?: string
          workflow_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_promotions_workflow_version_id_fkey"
            columns: ["workflow_version_id"]
            isOneToOne: false
            referencedRelation: "workflow_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_versions: {
        Row: {
          compatibility: Json
          created_at: string
          definition: Json
          domain_id: string
          fingerprint: string
          id: string
          job_type: string
          metadata: Json
          status: string
          status_changed_at: string
          workflow_id: string
        }
        Insert: {
          compatibility: Json
          created_at?: string
          definition: Json
          domain_id: string
          fingerprint: string
          id: string
          job_type: string
          metadata?: Json
          status: string
          status_changed_at: string
          workflow_id: string
        }
        Update: {
          compatibility?: Json
          created_at?: string
          definition?: Json
          domain_id?: string
          fingerprint?: string
          id?: string
          job_type?: string
          metadata?: Json
          status?: string
          status_changed_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_versions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_definitions"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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

