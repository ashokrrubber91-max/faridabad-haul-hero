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
      booking_documents: {
        Row: {
          booking_id: string
          created_at: string
          created_by: string | null
          document_type: string
          id: string
          storage_path: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          created_by?: string | null
          document_type: string
          id?: string
          storage_path: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          created_by?: string | null
          document_type?: string
          id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_documents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_stops: {
        Row: {
          address: string
          booking_id: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          kind: string
          latitude: number | null
          longitude: number | null
          place_id: string | null
          sequence: number
        }
        Insert: {
          address: string
          booking_id: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          kind: string
          latitude?: number | null
          longitude?: number | null
          place_id?: string | null
          sequence: number
        }
        Update: {
          address?: string
          booking_id?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          kind?: string
          latitude?: number | null
          longitude?: number | null
          place_id?: string | null
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_stops_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          business_account_id: string | null
          cancellation_reason: string | null
          cargo_value: number
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
          drop_lat: number | null
          drop_lng: number | null
          drop_otp: string | null
          drop_verified_at: string | null
          eway_bill_number: string | null
          fare: number
          gstin_id: string | null
          helper_count: number
          helper_fee: number
          id: string
          insurance_fee: number
          insurance_limit: number
          insurance_opted: boolean
          loading_started_at: string | null
          loading_stopped_at: string | null
          notes: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup_address: string
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_otp: string | null
          pickup_verified_at: string | null
          pod_photo_url: string | null
          pod_receipt_url: string | null
          pod_signature_url: string | null
          rating: number | null
          review: string | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["booking_status"]
          unloading_started_at: string | null
          unloading_stopped_at: string | null
          updated_at: string
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
        }
        Insert: {
          business_account_id?: string | null
          cancellation_reason?: string | null
          cargo_value?: number
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
          drop_lat?: number | null
          drop_lng?: number | null
          drop_otp?: string | null
          drop_verified_at?: string | null
          eway_bill_number?: string | null
          fare: number
          gstin_id?: string | null
          helper_count?: number
          helper_fee?: number
          id?: string
          insurance_fee?: number
          insurance_limit?: number
          insurance_opted?: boolean
          loading_started_at?: string | null
          loading_stopped_at?: string | null
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup_address: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_otp?: string | null
          pickup_verified_at?: string | null
          pod_photo_url?: string | null
          pod_receipt_url?: string | null
          pod_signature_url?: string | null
          rating?: number | null
          review?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          unloading_started_at?: string | null
          unloading_stopped_at?: string | null
          updated_at?: string
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
        }
        Update: {
          business_account_id?: string | null
          cancellation_reason?: string | null
          cargo_value?: number
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
          drop_lat?: number | null
          drop_lng?: number | null
          drop_otp?: string | null
          drop_verified_at?: string | null
          eway_bill_number?: string | null
          fare?: number
          gstin_id?: string | null
          helper_count?: number
          helper_fee?: number
          id?: string
          insurance_fee?: number
          insurance_limit?: number
          insurance_opted?: boolean
          loading_started_at?: string | null
          loading_stopped_at?: string | null
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup_address?: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_otp?: string | null
          pickup_verified_at?: string | null
          pod_photo_url?: string | null
          pod_receipt_url?: string | null
          pod_signature_url?: string | null
          rating?: number | null
          review?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          unloading_started_at?: string | null
          unloading_stopped_at?: string | null
          updated_at?: string
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
        }
        Relationships: []
      }
      broadcasts: {
        Row: {
          audience: string
          body: string
          channel: string
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string | null
          recipient_count: number
          sms_status: string
          title: string
        }
        Insert: {
          audience: string
          body: string
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          recipient_count?: number
          sms_status?: string
          title: string
        }
        Update: {
          audience?: string
          body?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          recipient_count?: number
          sms_status?: string
          title?: string
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
      customer_gstins: {
        Row: {
          business_address: string | null
          business_name: string
          created_at: string
          gstin: string
          id: string
          is_default: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          business_address?: string | null
          business_name: string
          created_at?: string
          gstin: string
          id?: string
          is_default?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          business_address?: string | null
          business_name?: string
          created_at?: string
          gstin?: string
          id?: string
          is_default?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      driver_bank_accounts: {
        Row: {
          account_holder: string
          account_number: string
          bank_name: string
          created_at: string
          driver_id: string
          id: string
          ifsc: string
          is_default: boolean
          updated_at: string
          upi_id: string | null
        }
        Insert: {
          account_holder: string
          account_number: string
          bank_name: string
          created_at?: string
          driver_id: string
          id?: string
          ifsc: string
          is_default?: boolean
          updated_at?: string
          upi_id?: string | null
        }
        Update: {
          account_holder?: string
          account_number?: string
          bank_name?: string
          created_at?: string
          driver_id?: string
          id?: string
          ifsc?: string
          is_default?: boolean
          updated_at?: string
          upi_id?: string | null
        }
        Relationships: []
      }
      driver_daily_passes: {
        Row: {
          amount: number
          created_at: string
          driver_id: string
          ends_at: string
          id: string
          provider_payment_id: string | null
          starts_at: string
          status: string
        }
        Insert: {
          amount?: number
          created_at?: string
          driver_id: string
          ends_at: string
          id?: string
          provider_payment_id?: string | null
          starts_at?: string
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          driver_id?: string
          ends_at?: string
          id?: string
          provider_payment_id?: string | null
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_daily_passes_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      driver_kyc: {
        Row: {
          city: string
          dl_back_url: string | null
          dl_front_url: string | null
          driver_id: string
          full_name: string
          id_proof_url: string | null
          insurance_url: string | null
          number_plate_url: string | null
          puc_url: string | null
          rc_url: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["kyc_status"]
          submitted_at: string
          updated_at: string
          vehicle_id: string
          vehicle_number: string | null
          vehicle_photo_url: string | null
        }
        Insert: {
          city?: string
          dl_back_url?: string | null
          dl_front_url?: string | null
          driver_id: string
          full_name: string
          id_proof_url?: string | null
          insurance_url?: string | null
          number_plate_url?: string | null
          puc_url?: string | null
          rc_url?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["kyc_status"]
          submitted_at?: string
          updated_at?: string
          vehicle_id: string
          vehicle_number?: string | null
          vehicle_photo_url?: string | null
        }
        Update: {
          city?: string
          dl_back_url?: string | null
          dl_front_url?: string | null
          driver_id?: string
          full_name?: string
          id_proof_url?: string | null
          insurance_url?: string | null
          number_plate_url?: string | null
          puc_url?: string | null
          rc_url?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["kyc_status"]
          submitted_at?: string
          updated_at?: string
          vehicle_id?: string
          vehicle_number?: string | null
          vehicle_photo_url?: string | null
        }
        Relationships: []
      }
      driver_locations: {
        Row: {
          accuracy_m: number | null
          driver_id: string
          heading_deg: number | null
          latitude: number
          longitude: number
          speed_mps: number | null
          updated_at: string
        }
        Insert: {
          accuracy_m?: number | null
          driver_id: string
          heading_deg?: number | null
          latitude: number
          longitude: number
          speed_mps?: number | null
          updated_at?: string
        }
        Update: {
          accuracy_m?: number | null
          driver_id?: string
          heading_deg?: number | null
          latitude?: number
          longitude?: number
          speed_mps?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_locations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_payouts: {
        Row: {
          amount: number
          bank_account_id: string | null
          created_at: string
          driver_id: string
          error: string | null
          id: string
          method: string
          provider: string
          provider_payout_id: string | null
          status: string
          updated_at: string
          upi_id: string | null
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          created_at?: string
          driver_id: string
          error?: string | null
          id?: string
          method?: string
          provider?: string
          provider_payout_id?: string | null
          status?: string
          updated_at?: string
          upi_id?: string | null
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          created_at?: string
          driver_id?: string
          error?: string | null
          id?: string
          method?: string
          provider?: string
          provider_payout_id?: string | null
          status?: string
          updated_at?: string
          upi_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_payouts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_accounts: {
        Row: {
          billing_cycle: string
          billing_email: string | null
          business_address: string | null
          business_name: string
          created_at: string
          credit_limit: number
          gstin: string | null
          id: string
          postpaid_enabled: boolean
          updated_at: string
          user_id: string
          verified: boolean
        }
        Insert: {
          billing_cycle?: string
          billing_email?: string | null
          business_address?: string | null
          business_name: string
          created_at?: string
          credit_limit?: number
          gstin?: string | null
          id?: string
          postpaid_enabled?: boolean
          updated_at?: string
          user_id: string
          verified?: boolean
        }
        Update: {
          billing_cycle?: string
          billing_email?: string | null
          business_address?: string | null
          business_name?: string
          created_at?: string
          credit_limit?: number
          gstin?: string | null
          id?: string
          postpaid_enabled?: boolean
          updated_at?: string
          user_id?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "merchant_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_billing_cycles: {
        Row: {
          created_at: string
          id: string
          invoice_url: string | null
          merchant_id: string
          period_end: string
          period_start: string
          status: string
          subtotal: number
          tax: number
          total: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_url?: string | null
          merchant_id: string
          period_end: string
          period_start: string
          status?: string
          subtotal?: number
          tax?: number
          total?: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_url?: string | null
          merchant_id?: string
          period_end?: string
          period_start?: string
          status?: string
          subtotal?: number
          tax?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "merchant_billing_cycles_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchant_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          broadcast_id: string | null
          created_at: string
          id: string
          kind: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          broadcast_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          broadcast_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          booking_id: string | null
          created_at: string
          currency: string
          customer_id: string
          error: string | null
          id: string
          method: string | null
          provider: string
          provider_order_id: string
          provider_payment_id: string | null
          provider_signature: string | null
          state: Database["public"]["Enums"]["payment_state"]
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id?: string | null
          created_at?: string
          currency?: string
          customer_id: string
          error?: string | null
          id?: string
          method?: string | null
          provider?: string
          provider_order_id: string
          provider_payment_id?: string | null
          provider_signature?: string | null
          state?: Database["public"]["Enums"]["payment_state"]
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          error?: string | null
          id?: string
          method?: string | null
          provider?: string
          provider_order_id?: string
          provider_payment_id?: string | null
          provider_signature?: string | null
          state?: Database["public"]["Enums"]["payment_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_mode: string
          created_at: string
          id: string
          is_online: boolean
          kyc_status: Database["public"]["Enums"]["kyc_status"]
          name: string
          phone: string
          referral_code: string | null
        }
        Insert: {
          active_mode?: string
          created_at?: string
          id: string
          is_online?: boolean
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          name: string
          phone: string
          referral_code?: string | null
        }
        Update: {
          active_mode?: string
          created_at?: string
          id?: string
          is_online?: boolean
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          name?: string
          phone?: string
          referral_code?: string | null
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          qualifying_booking_id: string | null
          referral_code: string
          referred_type: string
          referred_user_id: string
          referrer_id: string
          reward_amount: number
          rewarded_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          qualifying_booking_id?: string | null
          referral_code: string
          referred_type: string
          referred_user_id: string
          referrer_id: string
          reward_amount?: number
          rewarded_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          qualifying_booking_id?: string | null
          referral_code?: string
          referred_type?: string
          referred_user_id?: string
          referrer_id?: string
          reward_amount?: number
          rewarded_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_qualifying_booking_id_fkey"
            columns: ["qualifying_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      scheduled_dispatch_jobs: {
        Row: {
          booking_id: string
          created_at: string
          dispatch_at: string
          id: string
          last_error: string | null
          status: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          dispatch_at: string
          id?: string
          last_error?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          dispatch_at?: string
          id?: string
          last_error?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_dispatch_jobs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
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
      voice_booking_drafts: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          media_url: string | null
          parsed_data: Json
          public_token: string
          requester_phone: string | null
          source: string
          status: string
          transcript: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          media_url?: string | null
          parsed_data?: Json
          public_token?: string
          requester_phone?: string | null
          source?: string
          status?: string
          transcript?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          media_url?: string | null
          parsed_data?: Json
          public_token?: string
          requester_phone?: string | null
          source?: string
          status?: string
          transcript?: string | null
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
      withdrawal_requests: {
        Row: {
          amount: number
          created_at: string
          driver_id: string
          id: string
          method: string
          note: string | null
          status: Database["public"]["Enums"]["withdrawal_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          driver_id: string
          id?: string
          method?: string
          note?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          driver_id?: string
          id?: string
          method?: string
          note?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_set_driver_online: {
        Args: { _driver_id: string; _is_online: boolean }
        Returns: {
          active_mode: string
          created_at: string
          id: string
          is_online: boolean
          kyc_status: Database["public"]["Enums"]["kyc_status"]
          name: string
          phone: string
          referral_code: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      activate_driver_daily_pass: {
        Args: never
        Returns: {
          amount: number
          created_at: string
          driver_id: string
          ends_at: string
          id: string
          provider_payment_id: string | null
          starts_at: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_daily_passes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_send_broadcast: {
        Args: {
          _audience: string
          _body: string
          _idempotency_key?: string
          _title: string
        }
        Returns: {
          audience: string
          body: string
          channel: string
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string | null
          recipient_count: number
          sms_status: string
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "broadcasts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attach_delivery_signature: {
        Args: { _booking_id: string; _signature_path: string }
        Returns: boolean
      }
      attach_referral_to_new_user: {
        Args: {
          _referral_code: string
          _referred_type: string
          _referred_user_id: string
        }
        Returns: boolean
      }
      award_referral_reward: {
        Args: {
          _booking_id: string
          _referred_type: string
          _referred_user_id: string
        }
        Returns: boolean
      }
      credit_driver_wallet_topup: {
        Args: {
          _amount: number
          _driver_id: string
          _payment_id: string
          _provider_payment_id: string
        }
        Returns: Json
      }
      driver_daily_pass_active: {
        Args: { _driver_id: string }
        Returns: boolean
      }
      generate_unique_referral_code: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_kyc_approved: { Args: { _user_id: string }; Returns: boolean }
      merchant_monthly_statement: {
        Args: { _end: string; _merchant_id: string; _start: string }
        Returns: {
          bookings: number
          subtotal: number
          tax: number
          total: number
        }[]
      }
      process_scheduled_dispatch_jobs: { Args: never; Returns: number }
      reserve_driver_payout: {
        Args: {
          _amount: number
          _bank_account_id?: string
          _method: string
          _upi_id?: string
        }
        Returns: {
          amount: number
          bank_account_id: string | null
          created_at: string
          driver_id: string
          error: string | null
          id: string
          method: string
          provider: string
          provider_payout_id: string | null
          status: string
          updated_at: string
          upi_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "driver_payouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      schedule_booking_dispatch: {
        Args: { _booking_id: string; _scheduled_for: string }
        Returns: {
          booking_id: string
          created_at: string
          dispatch_at: string
          id: string
          last_error: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "scheduled_dispatch_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_my_active_mode: {
        Args: { _mode: string }
        Returns: {
          active_mode: string
          created_at: string
          id: string
          is_online: boolean
          kyc_status: Database["public"]["Enums"]["kyc_status"]
          name: string
          phone: string
          referral_code: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_my_online: {
        Args: { _is_online: boolean }
        Returns: {
          active_mode: string
          created_at: string
          id: string
          is_online: boolean
          kyc_status: Database["public"]["Enums"]["kyc_status"]
          name: string
          phone: string
          referral_code: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_daily_incentives: {
        Args: { _day?: string }
        Returns: {
          bonus: number
          driver_id: string
          rides: number
        }[]
      }
      settle_driver_payout: {
        Args: {
          _error?: string
          _payout_id: string
          _provider_payout_id?: string
          _status: string
        }
        Returns: {
          amount: number
          bank_account_id: string | null
          created_at: string
          driver_id: string
          error: string | null
          id: string
          method: string
          provider: string
          provider_payout_id: string | null
          status: string
          updated_at: string
          upi_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "driver_payouts"
          isOneToOne: true
          isSetofReturn: false
        }
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
      kyc_status: "not_submitted" | "pending" | "approved" | "rejected"
      payment_method: "cod" | "wallet" | "upi" | "card" | "netbanking"
      payment_state: "created" | "paid" | "failed" | "refunded"
      payment_status: "pending" | "paid" | "failed" | "refunded"
      sms_event: "accepted" | "started" | "completed"
      sms_recipient: "customer" | "driver"
      sms_status: "queued" | "sent" | "failed"
      vehicle_type: "tata_ace" | "pickup_8ft" | "tata_407"
      withdrawal_status: "requested" | "paid" | "rejected"
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
      kyc_status: ["not_submitted", "pending", "approved", "rejected"],
      payment_method: ["cod", "wallet", "upi", "card", "netbanking"],
      payment_state: ["created", "paid", "failed", "refunded"],
      payment_status: ["pending", "paid", "failed", "refunded"],
      sms_event: ["accepted", "started", "completed"],
      sms_recipient: ["customer", "driver"],
      sms_status: ["queued", "sent", "failed"],
      vehicle_type: ["tata_ace", "pickup_8ft", "tata_407"],
      withdrawal_status: ["requested", "paid", "rejected"],
    },
  },
} as const
