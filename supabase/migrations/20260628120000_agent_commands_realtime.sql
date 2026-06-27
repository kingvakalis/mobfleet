-- ════════════════════════════════════════════════════════════════════════════
-- agent_commands → Supabase Realtime publication  (Stage-1 phone-control latency)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds public.agent_commands to the `supabase_realtime` publication so the dashboard can subscribe
-- to postgres_changes (id-filtered) and learn the instant a command reaches a terminal status
-- (acked/failed/expired) — replacing the 1.5s status poll in watchCommand with near-instant UI
-- feedback for tap/Home/swipe/Launch/etc.
--
-- RLS still applies to realtime delivery: an operator only receives rows for commands in a team
-- they belong to (the same agent_commands SELECT policy that already gates getCommand/listCommands).
-- Only the operator (normal Supabase auth) subscribes — NOT the device-key agent — so there is no
-- anon/device-key realtime RLS concern here.
--
-- ADDITIVE + REVERSIBLE + idempotent, and a no-op for correctness: if this is NOT applied, the
-- watchCommand channel is simply inert and its fallback poll (unchanged, 1.5s) drives feedback —
-- so the frontend never regresses, it only gains speed once this is live.
--
-- Reverse: alter publication supabase_realtime drop table public.agent_commands;
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_commands'
  ) then
    alter publication supabase_realtime add table public.agent_commands;
  end if;
end $$;
