export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      certifications: {
        Row: {
          created_at: string
          credential_url: string | null
          id: string
          issued_date: string | null
          issued_precision: string | null
          issuer: string | null
          name: string
          revision: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credential_url?: string | null
          id?: string
          issued_date?: string | null
          issued_precision?: string | null
          issuer?: string | null
          name: string
          revision?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credential_url?: string | null
          id?: string
          issued_date?: string | null
          issued_precision?: string | null
          issuer?: string | null
          name?: string
          revision?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "certifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      education: {
        Row: {
          created_at: string
          description: string | null
          end_date: string | null
          end_precision: string | null
          field_of_study: string | null
          id: string
          institution: string
          is_current: boolean
          qualification: string
          revision: number
          start_date: string | null
          start_precision: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          end_precision?: string | null
          field_of_study?: string | null
          id?: string
          institution: string
          is_current?: boolean
          qualification: string
          revision?: number
          start_date?: string | null
          start_precision?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          end_precision?: string | null
          field_of_study?: string | null
          id?: string
          institution?: string
          is_current?: boolean
          qualification?: string
          revision?: number
          start_date?: string | null
          start_precision?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "education_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      experiences: {
        Row: {
          created_at: string
          description: string | null
          end_date: string | null
          end_precision: string | null
          id: string
          is_current: boolean
          kind: string
          organization: string
          revision: number
          role_title: string
          start_date: string | null
          start_precision: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          end_precision?: string | null
          id?: string
          is_current?: boolean
          kind: string
          organization: string
          revision?: number
          role_title: string
          start_date?: string | null
          start_precision?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          end_precision?: string | null
          id?: string
          is_current?: boolean
          kind?: string
          organization?: string
          revision?: number
          role_title?: string
          start_date?: string | null
          start_precision?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ai_consent_at: string | null
          ai_consent_version: string | null
          contact_email: string | null
          created_at: string
          deleting_at: string | null
          display_name: string
          headline: string | null
          id: string
          locale: string
          location: string | null
          onboarding_completed_at: string | null
          phone: string | null
          revision: number
          summary: string | null
          timezone: string
          updated_at: string
          website: string | null
        }
        Insert: {
          ai_consent_at?: string | null
          ai_consent_version?: string | null
          contact_email?: string | null
          created_at?: string
          deleting_at?: string | null
          display_name?: string
          headline?: string | null
          id: string
          locale?: string
          location?: string | null
          onboarding_completed_at?: string | null
          phone?: string | null
          revision?: number
          summary?: string | null
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          ai_consent_at?: string | null
          ai_consent_version?: string | null
          contact_email?: string | null
          created_at?: string
          deleting_at?: string | null
          display_name?: string
          headline?: string | null
          id?: string
          locale?: string
          location?: string | null
          onboarding_completed_at?: string | null
          phone?: string | null
          revision?: number
          summary?: string | null
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          end_date: string | null
          end_precision: string | null
          experience_id: string | null
          id: string
          is_current: boolean
          outcome: string | null
          revision: number
          start_date: string | null
          start_precision: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
          user_role: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          end_precision?: string | null
          experience_id?: string | null
          id?: string
          is_current?: boolean
          outcome?: string | null
          revision?: number
          start_date?: string | null
          start_precision?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
          user_role?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          end_precision?: string | null
          experience_id?: string | null
          id?: string
          is_current?: boolean
          outcome?: string | null
          revision?: number
          start_date?: string | null
          start_precision?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          user_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_experience_fk"
            columns: ["user_id", "experience_id"]
            isOneToOne: false
            referencedRelation: "experiences"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "projects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          created_at: string
          id: string
          name: string
          normalized_name: string | null
          revision: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          normalized_name?: string | null
          revision?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          normalized_name?: string | null
          revision?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skills_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_onboarding: {
        Args: {
          p_display_name: string
          p_expected_revision: number
          p_locale: string
          p_timezone: string
        }
        Returns: {
          ai_consent_at: string | null
          ai_consent_version: string | null
          contact_email: string | null
          created_at: string
          deleting_at: string | null
          display_name: string
          headline: string | null
          id: string
          locale: string
          location: string | null
          onboarding_completed_at: string | null
          phone: string | null
          revision: number
          summary: string | null
          timezone: string
          updated_at: string
          website: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_certification_idempotent: {
        Args: {
          p_credential_url: string
          p_issued_date: string
          p_issued_precision: string
          p_issuer: string
          p_name: string
          p_operation_key: string
        }
        Returns: {
          created_at: string
          credential_url: string | null
          id: string
          issued_date: string | null
          issued_precision: string | null
          issuer: string | null
          name: string
          revision: number
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "certifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_education_idempotent: {
        Args: {
          p_description: string
          p_end_date: string
          p_end_precision: string
          p_field_of_study: string
          p_institution: string
          p_is_current: boolean
          p_operation_key: string
          p_qualification: string
          p_start_date: string
          p_start_precision: string
        }
        Returns: {
          created_at: string
          description: string | null
          end_date: string | null
          end_precision: string | null
          field_of_study: string | null
          id: string
          institution: string
          is_current: boolean
          qualification: string
          revision: number
          start_date: string | null
          start_precision: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "education"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_experience_idempotent: {
        Args: {
          p_description: string
          p_end_date: string
          p_end_precision: string
          p_is_current: boolean
          p_kind: string
          p_operation_key: string
          p_organization: string
          p_role_title: string
          p_start_date: string
          p_start_precision: string
        }
        Returns: {
          created_at: string
          description: string | null
          end_date: string | null
          end_precision: string | null
          id: string
          is_current: boolean
          kind: string
          organization: string
          revision: number
          role_title: string
          start_date: string | null
          start_precision: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "experiences"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_skill_idempotent: {
        Args: { p_name: string; p_operation_key: string }
        Returns: {
          created_at: string
          id: string
          name: string
          normalized_name: string | null
          revision: number
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "skills"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      delete_certification: {
        Args: { p_certification_id: string; p_expected_revision: number }
        Returns: string
      }
      delete_education: {
        Args: { p_education_id: string; p_expected_revision: number }
        Returns: string
      }
      delete_experience: {
        Args: { p_expected_revision: number; p_experience_id: string }
        Returns: {
          deleted_experience_id: string
          released_project_count: number
        }[]
      }
      delete_project: {
        Args: { p_expected_revision: number; p_project_id: string }
        Returns: string
      }
      delete_skill: {
        Args: { p_expected_revision: number; p_skill_id: string }
        Returns: string
      }
      update_certification: {
        Args: {
          p_certification_id: string
          p_changes: Json
          p_expected_revision: number
        }
        Returns: {
          created_at: string
          credential_url: string | null
          id: string
          issued_date: string | null
          issued_precision: string | null
          issuer: string | null
          name: string
          revision: number
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "certifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_education: {
        Args: {
          p_changes: Json
          p_education_id: string
          p_expected_revision: number
        }
        Returns: {
          created_at: string
          description: string | null
          end_date: string | null
          end_precision: string | null
          field_of_study: string | null
          id: string
          institution: string
          is_current: boolean
          qualification: string
          revision: number
          start_date: string | null
          start_precision: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "education"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_experience: {
        Args: {
          p_changes: Json
          p_expected_revision: number
          p_experience_id: string
        }
        Returns: {
          created_at: string
          description: string | null
          end_date: string | null
          end_precision: string | null
          id: string
          is_current: boolean
          kind: string
          organization: string
          revision: number
          role_title: string
          start_date: string | null
          start_precision: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "experiences"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_profile: {
        Args: { p_changes: Json; p_expected_revision: number }
        Returns: {
          ai_consent_at: string | null
          ai_consent_version: string | null
          contact_email: string | null
          created_at: string
          deleting_at: string | null
          display_name: string
          headline: string | null
          id: string
          locale: string
          location: string | null
          onboarding_completed_at: string | null
          phone: string | null
          revision: number
          summary: string | null
          timezone: string
          updated_at: string
          website: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_project: {
        Args: {
          p_changes: Json
          p_expected_revision: number
          p_project_id: string
        }
        Returns: {
          created_at: string
          description: string | null
          end_date: string | null
          end_precision: string | null
          experience_id: string | null
          id: string
          is_current: boolean
          outcome: string | null
          revision: number
          start_date: string | null
          start_precision: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
          user_role: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_skill: {
        Args: {
          p_changes: Json
          p_expected_revision: number
          p_skill_id: string
        }
        Returns: {
          created_at: string
          id: string
          name: string
          normalized_name: string | null
          revision: number
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "skills"
          isOneToOne: false
          isSetofReturn: true
        }
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
  public: {
    Enums: {},
  },
} as const

