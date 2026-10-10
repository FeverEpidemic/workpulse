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
      ai_jobs: {
        Row: {
          activity_id: string | null
          attempt_count: number
          attempt_token: string | null
          consent_version: string
          created_at: string
          error_code: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          import_batch_id: string | null
          input_revision: number
          kind: string
          lease_expires_at: string | null
          payload_hash: string
          result: Json | null
          revision: number
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_id?: string | null
          attempt_count?: number
          attempt_token?: string | null
          consent_version: string
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          import_batch_id?: string | null
          input_revision: number
          kind: string
          lease_expires_at?: string | null
          payload_hash: string
          result?: Json | null
          revision?: number
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_id?: string | null
          attempt_count?: number
          attempt_token?: string | null
          consent_version?: string
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          import_batch_id?: string | null
          input_revision?: number
          kind?: string
          lease_expires_at?: string | null
          payload_hash?: string
          result?: Json | null
          revision?: number
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_jobs_user_activity_fkey"
            columns: ["user_id", "activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "ai_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_jobs_user_import_batch_fkey"
            columns: ["user_id", "import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      ai_suggestion_reviews: {
        Row: {
          activity_id: string
          activity_revision: number
          answered_at: string | null
          answers_hash: string | null
          applied_achievement_id: string | null
          applied_achievement_revision: number | null
          created_at: string
          id: string
          job_id: string
          questions_skipped_at: string | null
          revision: number
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_id: string
          activity_revision: number
          answered_at?: string | null
          answers_hash?: string | null
          applied_achievement_id?: string | null
          applied_achievement_revision?: number | null
          created_at?: string
          id?: string
          job_id: string
          questions_skipped_at?: string | null
          revision?: number
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_id?: string
          activity_revision?: number
          answered_at?: string | null
          answers_hash?: string | null
          applied_achievement_id?: string | null
          applied_achievement_revision?: number | null
          created_at?: string
          id?: string
          job_id?: string
          questions_skipped_at?: string | null
          revision?: number
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_suggestion_reviews_user_achievement_fkey"
            columns: ["user_id", "applied_achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "ai_suggestion_reviews_user_activity_fkey"
            columns: ["user_id", "activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "ai_suggestion_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_suggestion_reviews_user_job_fkey"
            columns: ["user_id", "job_id"]
            isOneToOne: true
            referencedRelation: "ai_jobs"
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
      cv_documents: {
        Row: {
          created_at: string
          id: string
          locale: string
          profile_ack_revision: number | null
          profile_snapshot: Json
          profile_source_revision: number
          revision: number
          section_order: Json
          summary_override: string | null
          template_key: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          locale: string
          profile_ack_revision?: number | null
          profile_snapshot: Json
          profile_source_revision: number
          revision?: number
          section_order: Json
          summary_override?: string | null
          template_key?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          locale?: string
          profile_ack_revision?: number | null
          profile_snapshot?: Json
          profile_source_revision?: number
          revision?: number
          section_order?: Json
          summary_override?: string | null
          template_key?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_exports: {
        Row: {
          attempt_count: number
          attempt_token: string | null
          byte_size: number | null
          created_at: string
          cv_id: string
          cv_revision: number
          error_code: string | null
          expires_at: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          object_key: string | null
          page_count: number | null
          purged_at: string | null
          revision: number
          snapshot: Json
          snapshot_purged_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          attempt_token?: string | null
          byte_size?: number | null
          created_at?: string
          cv_id: string
          cv_revision: number
          error_code?: string | null
          expires_at?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          lease_expires_at?: string | null
          object_key?: string | null
          page_count?: number | null
          purged_at?: string | null
          revision?: number
          snapshot: Json
          snapshot_purged_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          attempt_token?: string | null
          byte_size?: number | null
          created_at?: string
          cv_id?: string
          cv_revision?: number
          error_code?: string | null
          expires_at?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          lease_expires_at?: string | null
          object_key?: string | null
          page_count?: number | null
          purged_at?: string | null
          revision?: number
          snapshot?: Json
          snapshot_purged_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_exports_cv_fk"
            columns: ["user_id", "cv_id"]
            isOneToOne: false
            referencedRelation: "cv_documents"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "cv_exports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_items: {
        Row: {
          achievement_id: string | null
          acknowledged_revision: number | null
          certification_id: string | null
          created_at: string
          cv_id: string
          education_id: string | null
          experience_id: string | null
          id: string
          override_text: string | null
          position: number
          project_id: string | null
          revision: number
          section_key: string
          skill_id: string | null
          source_deleted: boolean
          source_revision: number
          source_snapshot: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          achievement_id?: string | null
          acknowledged_revision?: number | null
          certification_id?: string | null
          created_at?: string
          cv_id: string
          education_id?: string | null
          experience_id?: string | null
          id?: string
          override_text?: string | null
          position: number
          project_id?: string | null
          revision?: number
          section_key: string
          skill_id?: string | null
          source_deleted?: boolean
          source_revision: number
          source_snapshot: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          achievement_id?: string | null
          acknowledged_revision?: number | null
          certification_id?: string | null
          created_at?: string
          cv_id?: string
          education_id?: string | null
          experience_id?: string | null
          id?: string
          override_text?: string | null
          position?: number
          project_id?: string | null
          revision?: number
          section_key?: string
          skill_id?: string | null
          source_deleted?: boolean
          source_revision?: number
          source_snapshot?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_items_achievement_fk"
            columns: ["user_id", "achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "cv_items_certification_fk"
            columns: ["user_id", "certification_id"]
            isOneToOne: false
            referencedRelation: "certifications"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "cv_items_cv_fk"
            columns: ["user_id", "cv_id"]
            isOneToOne: false
            referencedRelation: "cv_documents"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "cv_items_education_fk"
            columns: ["user_id", "education_id"]
            isOneToOne: false
            referencedRelation: "education"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "cv_items_experience_fk"
            columns: ["user_id", "experience_id"]
            isOneToOne: false
            referencedRelation: "experiences"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "cv_items_project_fk"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "cv_items_skill_fk"
            columns: ["user_id", "skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "cv_items_user_id_fkey"
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
      import_batches: {
        Row: {
          bytes: number
          cancelled_at: string | null
          commit_result: Json | null
          committed_at: string | null
          created_at: string
          error_code: string | null
          expires_at: string | null
          extracted_text: string | null
          failed_at: string | null
          file_key: string | null
          filename: string
          id: string
          idempotency_key: string
          mime_type: string
          page_count: number | null
          payload_hash: string
          purged_at: string | null
          retry_count: number
          revision: number
          sha256: string
          stage: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bytes: number
          cancelled_at?: string | null
          commit_result?: Json | null
          committed_at?: string | null
          created_at?: string
          error_code?: string | null
          expires_at?: string | null
          extracted_text?: string | null
          failed_at?: string | null
          file_key?: string | null
          filename: string
          id?: string
          idempotency_key: string
          mime_type: string
          page_count?: number | null
          payload_hash: string
          purged_at?: string | null
          retry_count?: number
          revision?: number
          sha256: string
          stage?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bytes?: number
          cancelled_at?: string | null
          commit_result?: Json | null
          committed_at?: string | null
          created_at?: string
          error_code?: string | null
          expires_at?: string | null
          extracted_text?: string | null
          failed_at?: string | null
          file_key?: string | null
          filename?: string
          id?: string
          idempotency_key?: string
          mime_type?: string
          page_count?: number | null
          payload_hash?: string
          purged_at?: string | null
          retry_count?: number
          revision?: number
          sha256?: string
          stage?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_items: {
        Row: {
          action: string
          batch_id: string
          committed_id: string | null
          confirm_requested: boolean
          created_at: string
          entity_type: string
          id: string
          ordinal: number
          payload: Json | null
          purged_at: string | null
          revision: number
          source_excerpt: string | null
          target_id: string | null
          updated_at: string
          user_id: string
          validation_errors: Json
        }
        Insert: {
          action?: string
          batch_id: string
          committed_id?: string | null
          confirm_requested?: boolean
          created_at?: string
          entity_type: string
          id?: string
          ordinal: number
          payload?: Json | null
          purged_at?: string | null
          revision?: number
          source_excerpt?: string | null
          target_id?: string | null
          updated_at?: string
          user_id: string
          validation_errors?: Json
        }
        Update: {
          action?: string
          batch_id?: string
          committed_id?: string | null
          confirm_requested?: boolean
          created_at?: string
          entity_type?: string
          id?: string
          ordinal?: number
          payload?: Json | null
          purged_at?: string | null
          revision?: number
          source_excerpt?: string | null
          target_id?: string | null
          updated_at?: string
          user_id?: string
          validation_errors?: Json
        }
        Relationships: [
          {
            foreignKeyName: "import_items_user_batch_fkey"
            columns: ["user_id", "batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["user_id", "id"]
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
      advance_import_job: {
        Args: { p_attempt_token: string; p_job_id: string }
        Returns: boolean
      }
      answer_ai_questions: {
        Args: { p_answers: Json; p_expected_revision: number; p_job_id: string }
        Returns: {
          activity_revision: number
          job_id: string
          job_status: string
        }[]
      }
      apply_ai_suggestion: {
        Args: {
          p_expected_achievement_revision: number
          p_expected_activity_revision: number
          p_job_id: string
        }
        Returns: {
          achievement_id: string
          achievement_revision: number
          created: boolean
        }[]
      }
      begin_account_deletion: {
        Args: { p_user_id: string }
        Returns: {
          already_requested: boolean
          requested_at: string
        }[]
      }
      begin_import_batch: {
        Args: {
          p_bytes: number
          p_filename: string
          p_idempotency_key: string
          p_mime_type: string
          p_sha256: string
        }
        Returns: {
          batch_id: string
          duplicate_of_created_at: string
          duplicate_of_status: string
          file_key: string
          replayed: boolean
          revision: number
          stage: string
          status: string
        }[]
      }
      cancel_import_batch: {
        Args: { p_batch_id: string }
        Returns: {
          batch_id: string
          error_code: string
          revision: number
          stage: string
          status: string
        }[]
      }
      claim_account_deletion_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          attempt_token: string
          lease_expires_at: string
          requested_at: string
          user_id: string
        }[]
      }
      claim_ai_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          attempt_token: string
          id: string
          input_revision: number
          kind: string
          user_id: string
        }[]
      }
      claim_cv_export_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          attempt_token: string
          cv_revision: number
          id: string
          user_id: string
        }[]
      }
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
      claim_export_cleanup_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          attempt_token: string
          id: string
          lease_expires_at: string
          object_key: string
          user_id: string
        }[]
      }
      claim_import_cleanup_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          attempt_token: string
          id: string
          lease_expires_at: string
          object_key: string
          user_id: string
        }[]
      }
      claim_import_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          attempt_token: string
          batch_id: string
          expected_bytes: number
          id: string
          lease_expires_at: string
          mime_type: string
          object_key: string
          sha256: string
          user_id: string
        }[]
      }
      commit_import_batch: {
        Args: {
          p_batch_id: string
          p_expected_revision: number
          p_onboarding?: Json
        }
        Returns: Json
      }
      complete_ai_job: {
        Args: { p_attempt_token: string; p_job_id: string; p_result: Json }
        Returns: string
      }
      complete_cv_export: {
        Args: {
          p_attempt_token: string
          p_byte_size: number
          p_export_id: string
          p_object_key: string
          p_page_count: number
        }
        Returns: string
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
      complete_export_cleanup_job: {
        Args: { p_attempt_token: string; p_job_id: string }
        Returns: boolean
      }
      complete_import_ai_job: {
        Args: {
          p_attempt_token: string
          p_items: Json
          p_job_id: string
          p_summary: Json
        }
        Returns: string
      }
      complete_import_cleanup_job: {
        Args: { p_attempt_token: string; p_job_id: string }
        Returns: boolean
      }
      complete_import_parse: {
        Args: {
          p_attempt_token: string
          p_job_id: string
          p_page_count: number
          p_text: string
        }
        Returns: string
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
      dismiss_ai_suggestion: { Args: { p_job_id: string }; Returns: undefined }
      ensure_cv_document: {
        Args: never
        Returns: {
          created: boolean
          cv_id: string
          revision: number
        }[]
      }
      expire_abandoned_import_reviews: {
        Args: { p_idle_days?: number; p_limit?: number }
        Returns: number
      }
      expire_ai_job_leases: { Args: never; Returns: number }
      expire_cv_export_leases: { Args: never; Returns: number }
      expire_cv_exports: { Args: { p_limit?: number }; Returns: number }
      expire_evidence_uploads: { Args: { p_limit?: number }; Returns: number }
      expire_import_uploads: {
        Args: { p_limit?: number; p_min_age_seconds?: number }
        Returns: number
      }
      fail_ai_job: {
        Args: {
          p_attempt_token: string
          p_error_code: string
          p_job_id: string
        }
        Returns: boolean
      }
      fail_cv_export: {
        Args: {
          p_attempt_token: string
          p_error_code: string
          p_export_id: string
        }
        Returns: boolean
      }
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
      fail_export_cleanup_job: {
        Args: {
          p_attempt_token: string
          p_error_code: string
          p_job_id: string
        }
        Returns: boolean
      }
      fail_import_cleanup_job: {
        Args: {
          p_attempt_token: string
          p_error_code: string
          p_job_id: string
        }
        Returns: boolean
      }
      fail_import_job: {
        Args: {
          p_attempt_token: string
          p_error_code: string
          p_final: boolean
          p_job_id: string
          p_next_attempt_at: string
        }
        Returns: boolean
      }
      filter_achievements: {
        Args: { p_missing_ready_evidence?: boolean; p_skill_id?: string }
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
      filter_projects: {
        Args: { p_outcome_missing?: boolean }
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
      finalize_import_upload: {
        Args: { p_batch_id: string; p_user_id: string }
        Returns: {
          batch_id: string
          error_code: string
          revision: number
          stage: string
          status: string
        }[]
      }
      get_account_deletion_backlog: {
        Args: never
        Returns: {
          overdue: number
          pending: number
        }[]
      }
      get_account_deletion_preview: {
        Args: never
        Returns: {
          achievements: number
          activities: number
          cv_exports: number
          evidence_files: number
          has_cv: boolean
          import_batches: number
          projects: number
        }[]
      }
      get_ai_job_input: {
        Args: { p_attempt_token: string; p_job_id: string }
        Returns: {
          input_revision: number
          locale: string
          outcome: string
          raw_text: string
          role: string
          scope: string
        }[]
      }
      get_cv_export_download: { Args: { p_export_id: string }; Returns: string }
      get_cv_export_input: {
        Args: { p_attempt_token: string; p_export_id: string }
        Returns: {
          cv_revision: number
          snapshot: Json
        }[]
      }
      get_cv_export_readiness: {
        Args: never
        Returns: {
          blockers: Json
          cv_revision: number
          has_cv: boolean
          ready: boolean
        }[]
      }
      get_cv_freshness: {
        Args: never
        Returns: {
          item_id: string
          live_revision: number
          live_snapshot: Json
          state: string
          target: string
        }[]
      }
      get_cv_review_summary: {
        Args: never
        Returns: {
          available_count: number
          has_cv: boolean
          review_count: number
        }[]
      }
      get_dashboard_summary: {
        Args: never
        Returns: {
          active_project_count: number
          completed_missing_outcome_count: number
          confirmed_achievement_count: number
          demonstrated_skill_count: number
          has_career_records: boolean
          missing_evidence_count: number
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
      get_import_ai_job_input: {
        Args: { p_attempt_token: string; p_job_id: string }
        Returns: {
          text: string
        }[]
      }
      get_pilot_metrics: {
        Args: { p_as_of?: string }
        Returns: {
          achieved: number
          cohort_size: number
          eligible: number
          measure: string
          pending: number
          rate: number
          target: number
        }[]
      }
      list_demonstrated_skills: {
        Args: { p_limit?: number }
        Returns: {
          confirmed_achievement_count: number
          name: string
          skill_id: string
        }[]
      }
      list_evidence_files: {
        Args: { p_parent_id: string; p_parent_kind: string; p_user_id: string }
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
      mark_account_auth_deleted: {
        Args: { p_attempt_token: string; p_user_id: string }
        Returns: boolean
      }
      move_activity_evidence_to_achievement: {
        Args: {
          p_evidence_id: string
          p_expected_revision: number
          p_expected_target_revision: number
          p_target_achievement_id: string
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
      prune_account_deletion_receipts: {
        Args: { p_limit?: number }
        Returns: number
      }
      purge_account_data: {
        Args: { p_attempt_token: string; p_user_id: string }
        Returns: number
      }
      purge_expired_import_batches: {
        Args: { p_limit?: number }
        Returns: number
      }
      reconcile_orphan_evidence_objects: {
        Args: { p_limit?: number; p_min_age_seconds?: number }
        Returns: {
          job_id: string
          object_key: string
          user_id: string
        }[]
      }
      reconcile_orphan_export_objects: {
        Args: { p_limit?: number; p_min_age_seconds?: number }
        Returns: number
      }
      reconcile_orphan_import_objects: {
        Args: { p_limit?: number; p_min_age_seconds?: number }
        Returns: number
      }
      redact_cv_export_snapshots: {
        Args: { p_limit?: number }
        Returns: number
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
      remove_cv_item: {
        Args: {
          p_expected_revision: number
          p_item_id: string
          p_remove_children: boolean
        }
        Returns: {
          cv_revision: number
          removed_item_ids: string[]
        }[]
      }
      reorder_cv_section: {
        Args: {
          p_expected_revision: number
          p_item_ids: string[]
          p_section_key: string
        }
        Returns: number
      }
      request_ai_analysis: {
        Args: { p_activity_id: string; p_expected_revision: number }
        Returns: {
          attempt_count: number
          error_code: string
          input_revision: number
          job_id: string
          kind: string
          status: string
        }[]
      }
      request_cv_export: {
        Args: { p_expected_revision: number; p_idempotency_key: string }
        Returns: {
          cv_revision: number
          export_id: string
          reused: boolean
          status: string
        }[]
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
      resolve_cv_freshness: {
        Args: { p_expected_revision: number; p_resolutions: Json }
        Returns: {
          added_parent_item_ids: string[]
          cv_revision: number
        }[]
      }
      retry_account_deletion_job: {
        Args: {
          p_attempt_token: string
          p_error_code: string
          p_next_attempt_at: string
          p_user_id: string
        }
        Returns: boolean
      }
      retry_ai_job: {
        Args: { p_job_id: string }
        Returns: {
          attempt_count: number
          error_code: string
          input_revision: number
          job_id: string
          kind: string
          status: string
        }[]
      }
      retry_cv_export: {
        Args: { p_export_id: string }
        Returns: {
          attempt_count: number
          export_id: string
          status: string
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
      retry_export_cleanup_job: {
        Args: {
          p_attempt_token: string
          p_error_code: string
          p_job_id: string
          p_next_attempt_at: string
        }
        Returns: boolean
      }
      retry_import_batch: {
        Args: { p_batch_id: string }
        Returns: {
          batch_id: string
          error_code: string
          revision: number
          stage: string
          status: string
        }[]
      }
      retry_import_cleanup_job: {
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
      save_cv_edits: {
        Args: { p_edits: Json; p_expected_revision: number }
        Returns: number
      }
      select_cv_source: {
        Args: {
          p_expected_revision: number
          p_source_id: string
          p_source_type: string
        }
        Returns: {
          cv_revision: number
          item_ids: string[]
          parent_item_ids: string[]
        }[]
      }
      set_ai_consent: {
        Args: { p_consented: boolean; p_expected_revision: number }
        Returns: {
          ai_consent_at: string
          ai_consent_version: string
          revision: number
        }[]
      }
      set_pilot_participant: {
        Args: {
          p_consent_version: string
          p_enrolled: boolean
          p_user_id: string
        }
        Returns: {
          enrolled_at: string
          user_id: string
          withdrawn_at: string
        }[]
      }
      skip_ai_questions: { Args: { p_job_id: string }; Returns: undefined }
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
      update_cv_layout: {
        Args: {
          p_expected_revision: number
          p_locale: string
          p_section_order: Json
        }
        Returns: number
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
      update_import_item: {
        Args: {
          p_action: string
          p_confirm_requested: boolean
          p_expected_revision: number
          p_item_id: string
          p_payload_patch: Json
          p_target_id: string
        }
        Returns: {
          batch_revision: number
          item_id: string
          item_revision: number
        }[]
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
      validate_import_batch: {
        Args: { p_batch_id: string }
        Returns: {
          code: string
          existing_id: string
          field: string
          item_id: string
        }[]
      }
      verify_account_purges: { Args: { p_limit?: number }; Returns: number }
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

