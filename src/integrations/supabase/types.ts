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
      bookings: {
        Row: {
          coins_redeemed: number
          commission_amount: number
          commission_rate: number
          coupon_code: string | null
          coupon_discount: number
          created_at: string
          customer_id: string
          distance_km: number
          driver_id: string | null
          driver_net_earning: number
          drop_address: string
          drop_otp: string | null
          drop_verified_at: string | null
          fare: number
          id: string
          notes: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup_address: string
          pickup_otp: string | null
          pickup_verified_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
        }
        Insert: {
          coins_redeemed?: number
          commission_amount?: number
          commission_rate?: number
          coupon_code?: string | null
          coupon_discount?: number
          created_at?: string
          customer_id: string
          distance_km: number
          driver_id?: string | null
          driver_net_earning?: number
          drop_address: string
          drop_otp?: string | null
          drop_verified_at?: string | null
          fare: number
          id?: string
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup_address: string
          pickup_otp?: string | null
          pickup_verified_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
        }
        Update: {
          coins_redeemed?: number
          commission_amount?: number
          commission_rate?: number
          coupon_code?: string | null
          coupon_discount?: number
          created_at?: string
          customer_id?: string
          distance_km?: number
          driver_id?: string | null
          driver_net_earning?: number
          drop_address?: string
          drop_otp?: string | null
          drop_verified_at?: string | null
          fare?: number
          id?: string
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup_address?: string
          pickup_otp?: string | null
          pickup_verified_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
        }
        Relationships: []
      }
      coupons: {
        Row: {
          active: boolean
          code: string
          created_at: string
          expires_at: string | null
          id: string
          kind: Database["public"]["Enums"]["coupon_kind"]
          max_discount: number | null
          max_uses: number | null
          min_fare: number
          uses: number
          value: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["coupon_kind"]
          max_discount?: number | null
          max_uses?: number | null
          min_fare?: number
          uses?: number
          value: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["coupon_kind"]
          max_discount?: number | null
          max_uses?: number | null
          min_fare?: number
          uses?: number
          value?: number
        }
        Relationships: []
      }
      driver_incentive_config: {
        Row: {
          active: boolean
          bonus_amount: number
          created_at: string
          id: string
          label: string
          rides_required: number
        }
        Insert: {
          active?: boolean
          bonus_amount: number
          created_at?: string
          id?: string
          label: string
          rides_required: number
        }
        Update: {
          active?: boolean
          bonus_amount?: number
          created_at?: string
          id?: string
          label?: string
          rides_required?: number
        }
        Relationships: []
      }
      driver_incentive_earnings: {
        Row: {
          bonus_amount: number
          created_at: string
          credited_at: string | null
          driver_id: string
          earned_on: string
          id: string
          rides_completed: number
        }
        Insert: {
          bonus_amount: number
          created_at?: string
          credited_at?: string | null
          driver_id: string
          earned_on: string
          id?: string
          rides_completed: number
        }
        Update: {
          bonus_amount?: number
          created_at?: string
          credited_at?: string | null
          driver_id?: string
          earned_on?: string
          id?: string
          rides_completed?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_mode: string
          created_at: string
          id: string
          is_online: boolean
          name: string
          phone: string
        }
        Insert: {
          active_mode?: string
          created_at?: string
          id: string
          is_online?: boolean
          name: string
          phone: string
        }
        Update: {
          active_mode?: string
          created_at?: string
          id?: string
          is_online?: boolean
          name?: string
          phone?: string
        }
        Relationships: []
      }
      saved_addresses: {
        Row: {
          address: string
          alias: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["address_kind"]
          latitude: number | null
          longitude: number | null
          place_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          alias?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["address_kind"]
          latitude?: number | null
          longitude?: number | null
          place_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          alias?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["address_kind"]
          latitude?: number | null
          longitude?: number | null
          place_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sms_logs: {
        Row: {
          body: string
          booking_id: string
          created_at: string
          error: string | null
          event: Database["public"]["Enums"]["sms_event"]
          id: string
          phone: string
          provider_sid: string | null
          recipient: Database["public"]["Enums"]["sms_recipient"]
          recipient_user_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["sms_status"]
          updated_at: string
        }
        Insert: {
          body: string
          booking_id: string
          created_at?: string
          error?: string | null
          event: Database["public"]["Enums"]["sms_event"]
          id?: string
          phone: string
          provider_sid?: string | null
          recipient: Database["public"]["Enums"]["sms_recipient"]
          recipient_user_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["sms_status"]
          updated_at?: string
        }
        Update: {
          body?: string
          booking_id?: string
          created_at?: string
          error?: string | null
          event?: Database["public"]["Enums"]["sms_event"]
          id?: string
          phone?: string
          provider_sid?: string | null
          recipient?: Database["public"]["Enums"]["sms_recipient"]
          recipient_user_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["sms_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_accounts: {
        Row: {
          cash_balance: number
          coins_balance: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cash_balance?: number
          coins_balance?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          cash_balance?: number
          coins_balance?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          booking_id: string | null
          created_at: string
          delta: number
          id: string
          reason: string
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          delta: number
          id?: string
          reason: string
          user_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          delta?: number
          id?: string
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      settle_daily_incentives: {
        Args: { _day?: string }
        Returns: {
          bonus: number
          driver_id: string
          rides: number
        }[]
      }
      validate_coupon: {
        Args: { _code: string; _fare: number }
        Returns: {
          code: string
          discount: number
          message: string
        }[]
      }
    }
    Enums: {
      address_kind: "home" | "shop" | "other"
      app_role: "customer" | "driver" | "admin"
      booking_status:
        | "pending"
        | "accepted"
        | "in_progress"
        | "completed"
        | "cancelled"
      coupon_kind: "flat" | "percent"
      payment_method: "cod" | "wallet" | "upi" | "card" | "netbanking"
      payment_status: "pending" | "paid" | "failed" | "refunded"
      sms_event: "accepted" | "started" | "completed"
      sms_recipient: "customer" | "driver"
      sms_status: "queued" | "sent" | "failed"
      vehicle_type: "tata_ace" | "pickup_8ft" | "tata_407"
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
      address_kind: ["home", "shop", "other"],
      app_role: ["customer", "driver", "admin"],
      booking_status: [
        "pending",
        "accepted",
        "in_progress",
        "completed",
        "cancelled",
      ],
      coupon_kind: ["flat", "percent"],
      payment_method: ["cod", "wallet", "upi", "card", "netbanking"],
      payment_status: ["pending", "paid", "failed", "refunded"],
      sms_event: ["accepted", "started", "completed"],
      sms_recipient: ["customer", "driver"],
      sms_status: ["queued", "sent", "failed"],
      vehicle_type: ["tata_ace", "pickup_8ft", "tata_407"],
    },
  },
} as const
