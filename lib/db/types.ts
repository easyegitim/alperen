/**
 * GEÇİCİ EL YAZIMI AYNA — migration 0010_v2_core.sql (+ 0011, 0012; Sprint 2: 0013_v2_plan_doctor, 0014_v2_tryon) sütun ve tabloları, `supabase gen types typescript`
 * biçiminde (Row / Insert / Update / Relationships; Functions Args / Returns). Bu dosya tam Database tipi DEĞİLDİR:
 * yalnız v2 sözleşmesi için sütun adlarını tip düzeyinde sabitler (CONTRACTS_V2.md §5). 0010 uygulandıktan sonra
 * `pnpm db:types` bu dosyayı üretilen tam tiple ÜZERİNE YAZAR; o zamana kadar yalnız tip olarak içe aktarılır
 * (`import type`), hiçbir Supabase istemcisine generic olarak verilmez.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** profiles'a 0010 (ve 0011 referral_code) ile eklenen sütunlar (0001/0006/0008 sütunları üretilen dosyada gelir). */
export type ProfilesV2Columns = {
  Row: {
    /** 0011: DV-XXXX-XXXX; yalnız service role yazar. */
    referral_code: string | null;
    age_band: "under_18" | "18_24" | "25_34" | "35_49" | "50_plus" | null;
    /** generated always as (age_band = 'under_18') stored */
    under_18: boolean | null;
    presentation: "male" | "female" | "unspecified" | null;
    face_shape_override: "oval" | "round" | "square" | "long" | "heart" | "diamond" | null;
    /** 0013: QuestionnaireV2 (lib/questionnaireV2.ts); yalnız planı etkiler; service role yazar. */
    questionnaire_v2: Json | null;
    questionnaire_v2_at: string | null;
    /** 0013: beden algısı taraması sonucu (KB §6.4); risk → doktor katmanı kapalı. */
    body_image_screen_result: "ok" | "risk" | null;
    body_image_screened_at: string | null;
  };
  Insert: {
    referral_code?: string | null;
    age_band?: "under_18" | "18_24" | "25_34" | "35_49" | "50_plus" | null;
    under_18?: never;
    presentation?: "male" | "female" | "unspecified" | null;
    face_shape_override?: "oval" | "round" | "square" | "long" | "heart" | "diamond" | null;
    questionnaire_v2?: Json | null;
    questionnaire_v2_at?: string | null;
    body_image_screen_result?: "ok" | "risk" | null;
    body_image_screened_at?: string | null;
  };
  Update: {
    referral_code?: string | null;
    age_band?: "under_18" | "18_24" | "25_34" | "35_49" | "50_plus" | null;
    under_18?: never;
    presentation?: "male" | "female" | "unspecified" | null;
    face_shape_override?: "oval" | "round" | "square" | "long" | "heart" | "diamond" | null;
    questionnaire_v2?: Json | null;
    questionnaire_v2_at?: string | null;
    body_image_screen_result?: "ok" | "risk" | null;
    body_image_screened_at?: string | null;
  };
};

/** coach_reports'a 0013 ile eklenen sütunlar. plan_v2 = PlanV2 (lib/coach/planTypes.ts); doktor adımı içermez. */
export type CoachReportsV2Columns = {
  Row: { plan_v2: Json | null; plan_version: string | null; report_version: string | null };
  Insert: { plan_v2?: Json | null; plan_version?: string | null; report_version?: string | null };
  Update: { plan_v2?: Json | null; plan_version?: string | null; report_version?: string | null };
};

export type TryonMode = "style" | "combo" | "glow_up";
export type TryonEventStatus = "pending" | "success" | "failed" | "identity_drift" | "qc_failed";

/** tryon_events'e 0014 ile eklenen sütunlar; status kümesine qc_failed eklendi. qc görsel/maske/landmark içermez. */
export type TryonEventsV2Columns = {
  Row: {
    status: TryonEventStatus;
    mode: TryonMode;
    presets: Json;
    weight: number;
    analysis_id: string | null;
    plan_step_ids: Json;
    qc: Json | null;
    regen_count: number;
    flagged_broken: boolean;
    flagged_at: string | null;
  };
  Insert: {
    status?: TryonEventStatus;
    mode?: TryonMode;
    presets?: Json;
    weight?: number;
    analysis_id?: string | null;
    plan_step_ids?: Json;
    qc?: Json | null;
    regen_count?: number;
    flagged_broken?: boolean;
    flagged_at?: string | null;
  };
  Update: TryonEventsV2Columns["Insert"];
};

export type DoctorRecommendationStatus = "draft" | "physician_reviewed" | "delivered" | "rejected";

/** analyses'e 0010 ile eklenen sütunlar; status kümesi genişledi. */
export type AnalysesV2Columns = {
  Row: {
    status: "device_only" | "queued" | "running" | "processing" | "completed" | "failed";
    sections_ready: Json;
    set_key: string | null;
    device_result: Json | null;
    score_range: Json | null;
    /** numeric(5,2) → PostgREST metin ("61.50") döndürebilir; present.ts sayıya çevirir. */
    percentile: number | null;
    runs: Json | null;
  };
  Insert: {
    status?: "device_only" | "queued" | "running" | "processing" | "completed" | "failed";
    sections_ready?: Json;
    set_key?: string | null;
    device_result?: Json | null;
    score_range?: Json | null;
    percentile?: number | null;
    runs?: Json | null;
  };
  Update: AnalysesV2Columns["Insert"];
};

export type DatabaseV2Mirror = {
  public: {
    Tables: {
      analysis_sets: {
        Row: {
          set_key: string;
          user_id: string;
          scores: Json;
          model: string;
          prompt_version: string;
          calibration_version: string;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          set_key: string;
          user_id: string;
          scores: Json;
          model: string;
          prompt_version: string;
          calibration_version: string;
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          set_key?: string;
          user_id?: string;
          scores?: Json;
          model?: string;
          prompt_version?: string;
          calibration_version?: string;
          created_at?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      offers: {
        Row: {
          user_id: string;
          started_at: string;
          expires_at: string;
          promo_product: "one_time_report" | "weekly" | "monthly" | "yearly";
          regular_product: "one_time_report" | "weekly" | "monthly" | "yearly";
        };
        Insert: {
          user_id: string;
          started_at?: string;
          expires_at: string;
          promo_product: "one_time_report" | "weekly" | "monthly" | "yearly";
          regular_product: "one_time_report" | "weekly" | "monthly" | "yearly";
        };
        Update: {
          user_id?: string;
          started_at?: string;
          expires_at?: string;
          promo_product?: "one_time_report" | "weekly" | "monthly" | "yearly";
          regular_product?: "one_time_report" | "weekly" | "monthly" | "yearly";
        };
        Relationships: [];
      };
      referrals: {
        Row: {
          id: string;
          code: string;
          referrer_id: string;
          referee_id: string;
          photo_submitted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          referrer_id: string;
          referee_id: string;
          photo_submitted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          referrer_id?: string;
          referee_id?: string;
          photo_submitted_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      purchases: {
        Row: {
          id: string;
          user_id: string;
          product: "one_time_report" | "weekly" | "monthly" | "yearly";
          analysis_id: string | null;
          provider: string;
          status: "pending" | "paid" | "refunded" | "failed";
          created_at: string;
          consumed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          product: "one_time_report" | "weekly" | "monthly" | "yearly";
          analysis_id?: string | null;
          provider: string;
          status: "pending" | "paid" | "refunded" | "failed";
          created_at?: string;
          consumed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          product?: "one_time_report" | "weekly" | "monthly" | "yearly";
          analysis_id?: string | null;
          provider?: string;
          status?: "pending" | "paid" | "refunded" | "failed";
          created_at?: string;
          consumed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchases_analysis_id_fkey";
            columns: ["analysis_id"];
            isOneToOne: true;
            referencedRelation: "analyses";
            referencedColumns: ["id"];
          },
        ];
      };
      doctor_recommendations: {
        Row: {
          id: string;
          user_id: string;
          analysis_id: string;
          report_id: string | null;
          status: DoctorRecommendationStatus;
          ai_items: Json;
          ai_model: string;
          ai_prompt_version: string;
          physician_items: Json | null;
          physician_id: string | null;
          physician_notes: string | null;
          reviewed_at: string | null;
          delivered_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          analysis_id: string;
          report_id?: string | null;
          status?: DoctorRecommendationStatus;
          ai_items?: Json;
          ai_model: string;
          ai_prompt_version: string;
          physician_items?: Json | null;
          physician_id?: string | null;
          physician_notes?: string | null;
          reviewed_at?: string | null;
          delivered_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          analysis_id?: string;
          report_id?: string | null;
          status?: DoctorRecommendationStatus;
          ai_items?: Json;
          ai_model?: string;
          ai_prompt_version?: string;
          physician_items?: Json | null;
          physician_id?: string | null;
          physician_notes?: string | null;
          reviewed_at?: string | null;
          delivered_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "doctor_recommendations_analysis_id_fkey";
            columns: ["analysis_id"];
            isOneToOne: false;
            referencedRelation: "analyses";
            referencedColumns: ["id"];
          },
        ];
      };
      product_links: {
        Row: {
          id: string;
          ref_id: string;
          kind: "product" | "expert" | "source";
          label: string;
          url: string;
          merchant: string | null;
          is_ad: boolean;
          commercial_model: "none" | "listing_fee";
          active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          ref_id: string;
          kind: "product" | "expert" | "source";
          label: string;
          url: string;
          merchant?: string | null;
          is_ad?: boolean;
          commercial_model?: "none" | "listing_fee";
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          ref_id?: string;
          kind?: "product" | "expert" | "source";
          label?: string;
          url?: string;
          merchant?: string | null;
          is_ad?: boolean;
          commercial_model?: "none" | "listing_fee";
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      product_link_clicks: {
        Row: { id: string; link_id: string; user_id: string | null; created_at: string };
        Insert: { id?: string; link_id: string; user_id?: string | null; created_at?: string };
        Update: { id?: string; link_id?: string; user_id?: string | null; created_at?: string };
        Relationships: [
          {
            foreignKeyName: "product_link_clicks_link_id_fkey";
            columns: ["link_id"];
            isOneToOne: false;
            referencedRelation: "product_links";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      reserve_analysis: {
        Args: { p_user: string; p_client_request_id: string; p_limit: number; p_since: string; p_status?: string };
        Returns: string;
      };
      promote_analysis: {
        Args: { p_user: string; p_analysis_id: string; p_limit: number; p_since: string };
        Returns: boolean;
      };
      purge_expired_analysis_sets: { Args: Record<PropertyKey, never>; Returns: number };
      /** 0014: eski 6 parametreli çağrı aynen çalışır; p_weight kota ağırlığı (pending+success toplamı ≤ p_limit). */
      reserve_tryon: {
        Args: {
          p_user: string;
          p_client_request_id: string;
          p_preset: string;
          p_model: string;
          p_limit: number;
          p_since: string;
          p_mode?: TryonMode;
          p_presets?: Json | null;
          p_weight?: number;
          p_analysis_id?: string | null;
        };
        Returns: string;
      };
      flag_tryon_broken: { Args: { p_user: string; p_event: string }; Returns: boolean };
      deliver_doctor_recommendation: { Args: { p_id: string; p_user: string }; Returns: boolean };
    };
  };
};
