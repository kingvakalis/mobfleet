-- ════════════════════════════════════════════════════════════════════════════
-- device_screenshots → Supabase Realtime publication
-- ════════════════════════════════════════════════════════════════════════════
-- Adds public.device_screenshots to the `supabase_realtime` publication so the dashboard can
-- subscribe to postgres_changes and receive live frame updates for the selected device the instant
-- the agent uploads one (client-driven GO LIVE). RLS still applies to realtime delivery (members
-- only). ADDITIVE + REVERSIBLE + idempotent — and purely a no-op for correctness: if this is NOT
-- applied, the client subscription is simply inert and the GO LIVE fallback poll drives updates.
--
-- Reverse: alter publication supabase_realtime drop table public.device_screenshots;
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'device_screenshots'
  ) then
    alter publication supabase_realtime add table public.device_screenshots;
  end if;
end $$;
