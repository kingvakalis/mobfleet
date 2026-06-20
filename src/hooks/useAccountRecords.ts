import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { AccountRecordRow, AccountRecordInsert } from '@/lib/database.types'

// Metadata-only account records (supabase-mode). The account_records table has NO password /
// recovery / cookie / token / 2FA-seed columns by design — this hook only ever reads/writes
// the metadata fields. Per-instance realtime channel suffix (see useDevices.ts).
let acctChannelSeq = 0
const byCreatedDesc = (a: AccountRecordRow, b: AccountRecordRow) => b.created_at.localeCompare(a.created_at)

export type NewAccount = Omit<AccountRecordInsert, 'team_id'>

export function useAccountRecords(teamId: string | null) {
  const [accounts, setAccounts] = useState<AccountRecordRow[]>([])
  const [loading, setLoading] = useState<boolean>(Boolean(teamId))
  const [error, setError] = useState<string | null>(null)
  const chanId = useRef(0)
  if (chanId.current === 0) chanId.current = ++acctChannelSeq

  const upsert = useCallback((row: AccountRecordRow) => {
    setAccounts((prev) => (prev.some((a) => a.id === row.id) ? prev.map((a) => (a.id === row.id ? row : a)) : [row, ...prev]).sort(byCreatedDesc))
  }, [])
  const removeLocal = useCallback((id: string) => setAccounts((prev) => prev.filter((a) => a.id !== id)), [])

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!supabase || !teamId) { if (isActive()) { setAccounts([]); setLoading(false) } return }
    if (isActive()) { setLoading(true); setError(null) }
    const { data, error: err } = await supabase.from('account_records').select('*').eq('team_id', teamId).order('created_at', { ascending: false })
    if (!isActive()) return
    if (err) setError(err.message)
    setAccounts((data as AccountRecordRow[]) ?? [])
    setLoading(false)
  }, [teamId])

  useEffect(() => { let active = true; void load(() => active); return () => { active = false } }, [load])

  useEffect(() => {
    if (!supabase || !teamId) return
    const sb = supabase
    const ch: RealtimeChannel = sb
      .channel(`account_records:${teamId}:${chanId.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'account_records', filter: `team_id=eq.${teamId}` }, (payload) => {
        if (payload.eventType === 'DELETE') removeLocal((payload.old as { id: string }).id)
        else upsert(payload.new as AccountRecordRow)
      })
      .subscribe()
    return () => { void sb.removeChannel(ch) }
  }, [teamId, upsert, removeLocal])

  const create = useCallback(async (input: NewAccount) => {
    if (!supabase || !teamId) return { error: 'No active team' }
    const { data, error: err } = await supabase.from('account_records').insert({ ...input, team_id: teamId }).select().single()
    if (err) return { error: err.message }
    upsert(data as AccountRecordRow)
    return {}
  }, [teamId, upsert])

  const update = useCallback(async (id: string, patch: Partial<NewAccount>) => {
    if (!supabase) return { error: 'Not configured' }
    const { data, error: err } = await supabase.from('account_records').update(patch).eq('id', id).select().single()
    if (err) return { error: err.message }
    upsert(data as AccountRecordRow)
    return {}
  }, [upsert])

  const remove = useCallback(async (id: string) => {
    if (!supabase) return { error: 'Not configured' }
    const { error: err } = await supabase.from('account_records').delete().eq('id', id)
    if (err) return { error: err.message }
    removeLocal(id)
    return {}
  }, [removeLocal])

  /** Bulk import metadata rows; usernames already present (non-blank) are reported as duplicates. */
  const importRows = useCallback(async (rows: NewAccount[]) => {
    if (!supabase || !teamId) return { added: 0, duplicates: [] as string[], error: 'No active team' }
    const existing = new Set(accounts.map((a) => a.username.toLowerCase()).filter(Boolean))
    const fresh: AccountRecordInsert[] = []
    const duplicates: string[] = []
    for (const r of rows) {
      const u = (r.username ?? '').toLowerCase()
      if (u && existing.has(u)) { duplicates.push(r.username ?? ''); continue }
      if (u) existing.add(u)
      fresh.push({ ...r, team_id: teamId })
    }
    if (fresh.length) {
      const { error: err } = await supabase.from('account_records').insert(fresh)
      if (err) return { added: 0, duplicates, error: err.message }
    }
    await load()
    return { added: fresh.length, duplicates }
  }, [teamId, accounts, load])

  return { accounts, loading, error, create, update, remove, importRows, refresh: load }
}
