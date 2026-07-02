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
      app_params: {
        Row: {
          description: string
          key: string
          updated_at: string
          updated_by: string | null
          value_bool: boolean | null
          value_num: number | null
          value_text: string | null
        }
        Insert: {
          description: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value_bool?: boolean | null
          value_num?: number | null
          value_text?: string | null
        }
        Update: {
          description?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value_bool?: boolean | null
          value_num?: number | null
          value_text?: string | null
        }
        Relationships: []
      }
      appointments: {
        Row: {
          created_at: string
          created_by: string
          doctor_id: string | null
          duration_min: number
          id: string
          notes: string | null
          patient_id: string | null
          patient_name: string
          patient_phone: string | null
          starts_at: string
          status: string
          study_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          doctor_id?: string | null
          duration_min?: number
          id?: string
          notes?: string | null
          patient_id?: string | null
          patient_name: string
          patient_phone?: string | null
          starts_at: string
          status?: string
          study_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          doctor_id?: string | null
          duration_min?: number
          id?: string
          notes?: string | null
          patient_id?: string | null
          patient_name?: string
          patient_phone?: string | null
          starts_at?: string
          status?: string
          study_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          data: Json | null
          id: number
          record_id: string | null
          table_name: string
          timestamp: string
          user_id: string | null
        }
        Insert: {
          action: string
          data?: Json | null
          id?: number
          record_id?: string | null
          table_name: string
          timestamp?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          data?: Json | null
          id?: number
          record_id?: string | null
          table_name?: string
          timestamp?: string
          user_id?: string | null
        }
        Relationships: []
      }
      bank_deposits: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          deposit_date: string
          id: string
          receipt_url: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          deposit_date: string
          id?: string
          receipt_url?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          deposit_date?: string
          id?: string
          receipt_url?: string | null
          reference?: string | null
        }
        Relationships: []
      }
      cashbox: {
        Row: {
          balance: number
          created_at: string
          created_by: string
          description: string
          expense: number
          id: string
          income: number
        }
        Insert: {
          balance?: number
          created_at?: string
          created_by: string
          description: string
          expense?: number
          id?: string
          income?: number
        }
        Update: {
          balance?: number
          created_at?: string
          created_by?: string
          description?: string
          expense?: number
          id?: string
          income?: number
        }
        Relationships: []
      }
      commissions: {
        Row: {
          commission_amount: number
          created_at: string
          doctor_id: string
          id: string
          patient_study_id: string
          percentage: number
        }
        Insert: {
          commission_amount: number
          created_at?: string
          doctor_id: string
          id?: string
          patient_study_id: string
          percentage: number
        }
        Update: {
          commission_amount?: number
          created_at?: string
          doctor_id?: string
          id?: string
          patient_study_id?: string
          percentage?: number
        }
        Relationships: [
          {
            foreignKeyName: "commissions_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_patient_study_id_fkey"
            columns: ["patient_study_id"]
            isOneToOne: false
            referencedRelation: "patient_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          agreement_discount_pct: number
          bank_account: string | null
          clinic_address: string | null
          created_at: string
          created_by: string
          default_commission_pct: number
          email: string | null
          full_name: string
          id: string
          phone: string | null
          status: boolean
          use_percentage: boolean
        }
        Insert: {
          agreement_discount_pct?: number
          bank_account?: string | null
          clinic_address?: string | null
          created_at?: string
          created_by: string
          default_commission_pct?: number
          email?: string | null
          full_name: string
          id?: string
          phone?: string | null
          status?: boolean
          use_percentage?: boolean
        }
        Update: {
          agreement_discount_pct?: number
          bank_account?: string | null
          clinic_address?: string | null
          created_at?: string
          created_by?: string
          default_commission_pct?: number
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          status?: boolean
          use_percentage?: boolean
        }
        Relationships: []
      }
      notification_recipients: {
        Row: {
          created_at: string
          id: string
          notification_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notification_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notification_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_recipients_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          sender_id: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          sender_id: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sender_id?: string
          title?: string
        }
        Relationships: []
      }
      patient_studies: {
        Row: {
          amount_paid: number
          clinic_name: string | null
          created_at: string
          created_by: string
          delivered_at: string | null
          delivered_by: string | null
          delivery_date: string | null
          discount: number
          doctor_id: string | null
          has_report: boolean
          id: string
          invoice_number: string | null
          invoice_surcharge: number
          is_voucher: boolean
          patient_id: string
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          price: number
          study_id: string
          with_invoice: boolean
        }
        Insert: {
          amount_paid?: number
          clinic_name?: string | null
          created_at?: string
          created_by: string
          delivered_at?: string | null
          delivered_by?: string | null
          delivery_date?: string | null
          discount?: number
          doctor_id?: string | null
          has_report?: boolean
          id?: string
          invoice_number?: string | null
          invoice_surcharge?: number
          is_voucher?: boolean
          patient_id: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          price?: number
          study_id: string
          with_invoice?: boolean
        }
        Update: {
          amount_paid?: number
          clinic_name?: string | null
          created_at?: string
          created_by?: string
          delivered_at?: string | null
          delivered_by?: string | null
          delivery_date?: string | null
          discount?: number
          doctor_id?: string | null
          has_report?: boolean
          id?: string
          invoice_number?: string | null
          invoice_surcharge?: number
          is_voucher?: boolean
          patient_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          price?: number
          study_id?: string
          with_invoice?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "patient_studies_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_studies_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_studies_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          birth_date: string | null
          created_at: string
          created_by: string
          doctor_id: string
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          status: boolean
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          created_by: string
          doctor_id: string
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          status?: boolean
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          created_by?: string
          doctor_id?: string
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          status?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "patients_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string
          created_at: string
          description: string
          key: string
        }
        Insert: {
          category?: string
          created_at?: string
          description: string
          key: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          key?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          approved: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          username: string
        }
        Insert: {
          active?: boolean
          approved?: boolean
          created_at?: string
          email: string
          full_name: string
          id: string
          username: string
        }
        Update: {
          active?: boolean
          approved?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          username?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          permission_key?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      studies: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          fixed_commission: number
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          fixed_commission?: number
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          fixed_commission?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      study_prices: {
        Row: {
          created_at: string
          effective_date: string
          id: string
          is_active: boolean
          price_with_report: number
          price_without_report: number
          study_id: string
        }
        Insert: {
          created_at?: string
          effective_date?: string
          id?: string
          is_active?: boolean
          price_with_report: number
          price_without_report: number
          study_id: string
        }
        Update: {
          created_at?: string
          effective_date?: string
          id?: string
          is_active?: boolean
          price_with_report?: number
          price_without_report?: number
          study_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_prices_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      third_party_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          payment_date: string
          provider_name: string
          receipt_url: string | null
          service_date: string
          service_type: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          payment_date: string
          provider_name: string
          receipt_url?: string | null
          service_date: string
          service_type: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          payment_date?: string
          provider_name?: string
          receipt_url?: string | null
          service_date?: string
          service_type?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_permission: {
        Args: { _key: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      log_audit_event: {
        Args: {
          _action: string
          _data: Json
          _record_id: string
          _table_name: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "ADMIN"
        | "RECEPCION"
        | "CAJA"
        | "CONTABILIDAD"
        | "DOCTOR"
        | "AUDITOR"
        | "SUBADMIN"
      payment_method: "cash" | "qr" | "card"
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
    Enums: {
      app_role: [
        "ADMIN",
        "RECEPCION",
        "CAJA",
        "CONTABILIDAD",
        "DOCTOR",
        "AUDITOR",
        "SUBADMIN",
      ],
      payment_method: ["cash", "qr", "card"],
    },
  },
} as const
