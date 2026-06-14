/**
 * Typed contract for the Supabase Postgres schema (see
 * supabase/migrations/20260614120000_init_phone_farm.sql). Shaped like
 * `supabase gen types typescript` output so `createClient<Database>()` gives
 * end-to-end typing on every query. Keep in sync with the migration.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type TeamRole = 'owner' | 'admin' | 'operator' | 'viewer'
export type DeviceStatusEnum = 'online' | 'offline' | 'error' | 'busy' | 'warming'
export type JobStatusEnum = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface Database {
  public: {
    Tables: {
      teams: {
        Row: { id: string; name: string; owner_user_id: string; created_at: string }
        Insert: { id?: string; name: string; owner_user_id: string; created_at?: string }
        Update: { id?: string; name?: string; owner_user_id?: string; created_at?: string }
        Relationships: []
      }
      team_members: {
        Row: {
          id: string
          team_id: string
          user_id: string
          role: TeamRole
          invited_at: string | null
          joined_at: string | null
        }
        Insert: {
          id?: string
          team_id: string
          user_id: string
          role?: TeamRole
          invited_at?: string | null
          joined_at?: string | null
        }
        Update: {
          id?: string
          team_id?: string
          user_id?: string
          role?: TeamRole
          invited_at?: string | null
          joined_at?: string | null
        }
        Relationships: [{ foreignKeyName: 'team_members_team_id_fkey'; columns: ['team_id']; referencedRelation: 'teams'; referencedColumns: ['id'] }]
      }
      devices: {
        Row: {
          id: string
          team_id: string
          name: string
          udid: string | null
          platform: string
          os_version: string | null
          status: DeviceStatusEnum
          ip_address: string | null
          wda_port: number | null
          last_heartbeat: string | null
          created_at: string
        }
        Insert: {
          id?: string
          team_id: string
          name: string
          udid?: string | null
          platform?: string
          os_version?: string | null
          status?: DeviceStatusEnum
          ip_address?: string | null
          wda_port?: number | null
          last_heartbeat?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          name?: string
          udid?: string | null
          platform?: string
          os_version?: string | null
          status?: DeviceStatusEnum
          ip_address?: string | null
          wda_port?: number | null
          last_heartbeat?: string | null
          created_at?: string
        }
        Relationships: [{ foreignKeyName: 'devices_team_id_fkey'; columns: ['team_id']; referencedRelation: 'teams'; referencedColumns: ['id'] }]
      }
      automation_jobs: {
        Row: {
          id: string
          team_id: string
          device_id: string | null
          type: string
          status: JobStatusEnum
          config: Json
          started_at: string | null
          finished_at: string | null
          error: string | null
          created_at: string
        }
        Insert: {
          id?: string
          team_id: string
          device_id?: string | null
          type: string
          status?: JobStatusEnum
          config?: Json
          started_at?: string | null
          finished_at?: string | null
          error?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          device_id?: string | null
          type?: string
          status?: JobStatusEnum
          config?: Json
          started_at?: string | null
          finished_at?: string | null
          error?: string | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: 'automation_jobs_team_id_fkey'; columns: ['team_id']; referencedRelation: 'teams'; referencedColumns: ['id'] },
          { foreignKeyName: 'automation_jobs_device_id_fkey'; columns: ['device_id']; referencedRelation: 'devices'; referencedColumns: ['id'] },
        ]
      }
    }
    Views: Record<never, never>
    Functions: Record<never, never>
    Enums: {
      team_role: TeamRole
      device_status: DeviceStatusEnum
      job_status: JobStatusEnum
    }
    CompositeTypes: Record<never, never>
  }
}

// Convenience row aliases.
export type TeamRow = Database['public']['Tables']['teams']['Row']
export type TeamMemberRow = Database['public']['Tables']['team_members']['Row']
export type DeviceRow = Database['public']['Tables']['devices']['Row']
export type DeviceInsert = Database['public']['Tables']['devices']['Insert']
export type DeviceUpdate = Database['public']['Tables']['devices']['Update']
export type AutomationJobRow = Database['public']['Tables']['automation_jobs']['Row']
export type AutomationJobInsert = Database['public']['Tables']['automation_jobs']['Insert']
