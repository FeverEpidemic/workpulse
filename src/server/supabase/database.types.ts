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
      achievement_skills: {
        Row: {
          achievement_id: string
          created_at: string
          skill_id: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          created_at?: string
          skill_id: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          created_at?: string
          skill_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "achievement_skills_user_achievement_fk"
            columns: ["user_id", "achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "achievement_skills_user_skill_fk"
            columns: ["user_id", "skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      achievements: {
        Row: {
          achieved_on: string | null
          activity_id: string | null
          contribution: string | null
          created_at: string
          cv_bullet: string | null
          experience_id: string | null
          id: string
          metrics: Json
          origin: string
          outcome: string | null
          project_id: string | null
          revision: number
          scope: string | null
          source_activity_revision: number | null
          source_excerpt: string | null
          status: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          achieved_on?: string | null
          activity_id?: string | null
          contribution?: string | null
          created_at?: string
          cv_bullet?: string | null
          experience_id?: string | null
          id?: string
          metrics?: Json
          origin?: string
          outcome?: string | null
          project_id?: string | null
          revision?: number
          scope?: string | null
          source_activity_revision?: number | null
          source_excerpt?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          achieved_on?: string | null
          activity_id?: string | null
          contribution?: string | null
          created_at?: string
          cv_bullet?: string | null
          experience_id?: string | null
          id?: string
          metrics?: Json
          origin?: string
          outcome?: string | null
          project_id?: string | null
          revision?: number
          scope?: string | null
          source_activity_revision?: number | null
          source_excerpt?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "achievements_activity_fk"
            columns: ["user_id", "activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "achievements_experience_fk"
            columns: ["user_id", "experience_id"]
            isOneToOne: false
            referencedRelation: "experiences"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "achievements_project_fk"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      activities: {
        Row: {
          analysis_state: string
          capture_mode: string
          created_at: string
          experience_id: string | null
          id: string
          occurred_on: string
          outcome: string | null
          project_id: string | null
          raw_text: string
          revision: number
          role: string | null
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_state?: string
          capture_mode: string
          created_at?: string
          experience_id?: string | null
          id?: string
          occurred_on: string
          outcome?: string | null
          project_id?: string | null
          raw_text: string
          revision?: number
          role?: string | null
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis_state?: string
          capture_mode?: string
          created_at?: string
          experience_id?: string | null
          id?: string
          occurred_on?: string
          outcome?: string | null
          project_id?: string | null
          raw_text?: string
          revision?: number
          role?: string | null
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_user_experience_fkey"
            columns: ["user_id", "experience_id"]
            isOneToOne: false
            referencedRelation: "experiences"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_user_project_fkey"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
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
      chat_messages: {
        Row: {
          activity_id: string
          content: string
          created_at: string
          id: string
          role: string
          sequence_no: number
          user_id: string
        }
        Insert: {
          activity_id: string
          content: string
          created_at?: string
          id?: string
          role: string
          sequence_no: number
          user_id: string
        }
        Update: {
          activity_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: string
          sequence_no?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_user_activity_fkey"
            columns: ["user_id", "activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "chat_messages_user_id_fkey"
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
      evidence_files: {
        Row: {
          achievement_id: string | null
          activity_id: string | null
          actual_bytes: number | null
          bytes: number
          created_at: string
          error_code: string | null
          finalize_payload_hash: string | null
          id: string
          idempotency_key: string
          mime_type: string
          object_key: string
          original_name: string
          parent_revision: number
          payload_hash: string
          project_id: string | null
          reserved_until: string | null
          revision: number
          scan_job_id: string | null
          sha256: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          achievement_id?: string | null
          activity_id?: string | null
          actual_bytes?: number | null
          bytes: number
          created_at?: string
          error_code?: string | null
          finalize_payload_hash?: string | null
          id?: string
          idempotency_key: string
          mime_type: string
          object_key: string
          original_name: string
          parent_revision: number
          payload_hash: string
          project_id?: string | null
          reserved_until?: string | null
          revision?: number
          scan_job_id?: string | null
          sha256?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          achievement_id?: string | null
          activity_id?: string | null
          actual_bytes?: number | null
          bytes?: number
          created_at?: string
          error_code?: string | null
          finalize_payload_hash?: string | null
          id?: string
          idempotency_key?: string
          mime_type?: string
          object_key?: string
          original_name?: string
          parent_revision?: number
          payload_hash?: string
          project_id?: string | null
          reserved_until?: string | null
          revision?: number
          scan_job_id?: string | null
          sha256?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_files_achievement_fk"
            columns: ["user_id", "achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "evidence_files_activity_fk"
            columns: ["user_id", "activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "evidence_files_project_fk"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "evidence_files_user_id_fkey"
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
      claim_evidence_cleanup_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          attempt_token: string
          bucket_id: string
          created_at: string
          error_code: string
          evidence_bytes: number
          evidence_id: string
          evidence_mime_type: string
          evidence_original_name: string
          evidence_parent_id: string
          evidence_parent_kind: string
          evidence_sha256: string
          finished_at: string
          id: string
          kind: string
          last_error_code: string
          lease_expires_at: string
          next_attempt_at: string
          object_key: string
          status: string
          updated_at: string
          user_id: string
        }[]
      }
      claim_evidence_scan_jobs: {
        Args: { p_limit?: number }
        Returns: unknown[]
        SetofOptions: {
          from: "*"
          to: "evidence_scan_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_evidence_cleanup_job: {
        Args: { p_attempt_token: string; p_job_id: string }
        Returns: boolean
      }
      complete_evidence_scan_job: {
        Args: {
          p_attempt_token: string
          p_error_code?: string
          p_job_id: string
          p_result: string
        }
        Returns: boolean
      }
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
      create_achievement_idempotent: {
        Args: {
          p_activity_id: string
          p_experience_id: string
          p_operation_key: string
          p_project_id: string
        }
        Returns: {
          achievement_id: string
          revision: number
          user_id: string
        }[]
      }
      create_activity_idempotent: {
        Args: {
          p_capture_mode: string
          p_experience_id: string
          p_occurred_on: string
          p_operation_key: string
          p_outcome: string
          p_project_id: string
          p_raw_text: string
          p_role: string
          p_scope: string
        }
        Returns: {
          activity_id: string
          capture_mode: string
          occurred_on: string
          revision: number
          user_id: string
        }[]
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
      create_project_idempotent: {
        Args: {
          p_description: string
          p_end_date: string
          p_end_precision: string
          p_experience_id: string
          p_is_current: boolean
          p_operation_key: string
          p_outcome: string
          p_start_date: string
          p_start_precision: string
          p_status: string
          p_title: string
          p_user_role: string
        }
        Returns: {
          project_id: string
          revision: number
          user_id: string
        }[]
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
      delete_achievement: {
        Args: { p_achievement_id: string; p_expected_revision: number }
        Returns: {
          deleted_achievement_id: string
          retained_activity: boolean
        }[]
      }
      delete_activity: {
        Args: { p_activity_id: string; p_expected_revision: number }
        Returns: {
          deleted_activity_id: string
          retained_achievement_count: number
          retained_chat_count: number
        }[]
      }
      delete_certification: {
        Args: { p_certification_id: string; p_expected_revision: number }
        Returns: string
      }
      delete_education: {
        Args: { p_education_id: string; p_expected_revision: number }
        Returns: string
      }
      delete_evidence_file: {
        Args: {
          p_evidence_id: string
          p_expected_revision: number
          p_user_id: string
        }
        Returns: {
          actual_bytes: number
          content_type: string
          created_at: string
          expected_bytes: number
          failure_code: string
          filename: string
          id: string
          object_key: string
          parent_id: string
          parent_kind: string
          parent_revision: number
          reservation_expires_at: string
          revision: number
          scan_job_id: string
          sha256: string
          status: string
          updated_at: string
          user_id: string
        }[]
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
        Returns: {
          deleted_project_id: string
          released_achievement_count: number
          released_activity_count: number
        }[]
      }
      delete_skill: {
        Args: { p_expected_revision: number; p_skill_id: string }
        Returns: string
      }
      expire_evidence_uploads: { Args: { p_limit?: number }; Returns: number }
      fail_evidence_cleanup_job: {
        Args: {
          p_attempt_token: string
          p_error_code: string
          p_job_id: string
        }
        Returns: boolean
      }
      fail_evidence_upload: {
        Args: {
          p_error_code: string
          p_evidence_id: string
          p_expected_revision: number
          p_user_id: string
        }
        Returns: {
          actual_bytes: number
          content_type: string
          created_at: string
          expected_bytes: number
          failure_code: string
          filename: string
          id: string
          object_key: string
          parent_id: string
          parent_kind: string
          parent_revision: number
          reservation_expires_at: string
          revision: number
          scan_job_id: string
          sha256: string
          status: string
          updated_at: string
          user_id: string
        }[]
      }
      finalize_evidence_upload: {
        Args: {
          p_actual_bytes: number
          p_evidence_id: string
          p_expected_revision: number
          p_sha256: string
          p_user_id: string
          p_verified_content_type: string
        }
        Returns: {
          actual_bytes: number
          content_type: string
          created_at: string
          expected_bytes: number
          failure_code: string
          filename: string
          id: string
          object_key: string
          parent_id: string
          parent_kind: string
          parent_revision: number
          reservation_expires_at: string
          revision: number
          scan_job_id: string
          sha256: string
          status: string
          updated_at: string
          user_id: string
        }[]
      }
      get_evidence_file: {
        Args: { p_evidence_id: string; p_user_id: string }
        Returns: {
          actual_bytes: number
          content_type: string
          created_at: string
          expected_bytes: number
          failure_code: string
          filename: string
          id: string
          object_key: string
          parent_id: string
          parent_kind: string
          parent_revision: number
          reservation_expires_at: string
          revision: number
          scan_job_id: string
          sha256: string
          status: string
          updated_at: string
          user_id: string
        }[]
      }
      reconcile_orphan_evidence_objects: {
        Args: { p_limit?: number; p_min_age_seconds?: number }
        Returns: {
          job_id: string
          object_key: string
          user_id: string
        }[]
      }
      relink_achievement_project: {
        Args: {
          p_achievement_id: string
          p_expected_revision: number
          p_project_id: string
        }
        Returns: {
          achieved_on: string | null
          activity_id: string | null
          contribution: string | null
          created_at: string
          cv_bullet: string | null
          experience_id: string | null
          id: string
          metrics: Json
          origin: string
          outcome: string | null
          project_id: string | null
          revision: number
          scope: string | null
          source_activity_revision: number | null
          source_excerpt: string | null
          status: string
          title: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "achievements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      relink_activity_project: {
        Args: {
          p_activity_id: string
          p_expected_revision: number
          p_project_id: string
        }
        Returns: {
          analysis_state: string
          capture_mode: string
          created_at: string
          experience_id: string | null
          id: string
          occurred_on: string
          outcome: string | null
          project_id: string | null
          raw_text: string
          revision: number
          role: string | null
          scope: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "activities"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      requeue_failed_evidence_cleanup_job: {
        Args: { p_job_id: string; p_next_attempt_at?: string }
        Returns: boolean
      }
      reserve_evidence_upload: {
        Args: {
          p_content_type: string
          p_expected_bytes: number
          p_expected_revision: number
          p_filename: string
          p_idempotency_key: string
          p_parent_id: string
          p_parent_kind: string
          p_user_id: string
        }
        Returns: {
          actual_bytes: number
          content_type: string
          created_at: string
          expected_bytes: number
          failure_code: string
          filename: string
          id: string
          object_key: string
          parent_id: string
          parent_kind: string
          parent_revision: number
          reservation_expires_at: string
          revision: number
          scan_job_id: string
          sha256: string
          status: string
          updated_at: string
          user_id: string
        }[]
      }
      retry_evidence_cleanup_job: {
        Args: {
          p_attempt_token: string
          p_error_code: string
          p_job_id: string
          p_next_attempt_at: string
        }
        Returns: boolean
      }
      retry_evidence_scan_job: {
        Args: {
          p_attempt_token: string
          p_error_code: string
          p_job_id: string
          p_next_attempt_at: string
        }
        Returns: boolean
      }
      save_achievement: {
        Args: {
          p_achievement_id: string
          p_action: string
          p_changes: Json
          p_expected_revision: number
          p_skill_names: Json
        }
        Returns: {
          achieved_on: string | null
          activity_id: string | null
          contribution: string | null
          created_at: string
          cv_bullet: string | null
          experience_id: string | null
          id: string
          metrics: Json
          origin: string
          outcome: string | null
          project_id: string | null
          revision: number
          scope: string | null
          source_activity_revision: number | null
          source_excerpt: string | null
          status: string
          title: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "achievements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_activity: {
        Args: {
          p_activity_id: string
          p_changes: Json
          p_expected_revision: number
        }
        Returns: {
          analysis_state: string
          capture_mode: string
          created_at: string
          experience_id: string | null
          id: string
          occurred_on: string
          outcome: string | null
          project_id: string | null
          raw_text: string
          revision: number
          role: string | null
          scope: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "activities"
          isOneToOne: false
          isSetofReturn: true
        }
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

