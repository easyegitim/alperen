/**
 * GEÇİCİ EL YAZIMI AYNA — migration 0010_v2_core.sql'in yeni sütun ve tabloları, `supabase gen types typescript`
 * biçiminde (Row / Insert / Update / Relationships; Functions Args / Returns). Bu dosya tam Database tipi DEĞİLDİR:
 * yalnız v2 sözleşmesi için sütun adlarını tip düzeyinde sabitler (CONTRACTS_V2.md §5). 0010 uygulandıktan sonra
 * `pnpm db:types` bu dosyayı üretilen tam tiple ÜZERİNE YAZAR; o zamana kadar yalnız tip olarak içe aktarılır
 * (`import type`), hiçbir Supabase istemcisine generic olarak verilmez.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** profiles'a 0010 ile eklenen sütunlar (0001/0006/0008 sütunları üretilen dosyada gelir). */
export type ProfilesV2Columns = {
  Row: {
    age_band: "under_18" | "18_24" | "25_34" | "35_49" | "50_plus" | null;
    /** generated always as (age_band = 'under_18') stored */
    under_18: boolean | null;
    presentation: "male" | "female" | "unspecified" | null;
    face_shape_override: "oval" | "round" | "square" | "long" | "heart" | "diamond" | null;
  };
  Insert: {
    age_band?: "under_18" | "18_24" | "25_34" | "35_49" | "50_plus" | null;
    under_18?: never;
    presentation?: "male" | "female" | "unspecified" | null;
    face_shape_override?: "oval" | "round" | "square" | "long" | "heart" | "diamond" | null;
  };
  Update: {
    age_band?: "under_18" | "18_24" | "25_34" | "35_49" | "50_plus" | null;
    under_18?: never;
    presentation?: "male" | "female" | "unspecified" | null;
    face_shape_override?: "oval" | "round" | "square" | "long" | "heart" | "diamond" | null;
  };
};

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
        };
        Insert: {
          id?: string;
          user_id: string;
          product: "one_time_report" | "weekly" | "monthly" | "yearly";
          analysis_id?: string | null;
          provider: string;
          status: "pending" | "paid" | "refunded" | "failed";
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          product?: "one_time_report" | "weekly" | "monthly" | "yearly";
          analysis_id?: string | null;
          provider?: string;
          status?: "pending" | "paid" | "refunded" | "failed";
          created_at?: string;
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
    };
  };
};
