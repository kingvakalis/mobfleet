-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: onboarding "create workspace" failed with 42501 (RLS) on the data plane.
--
-- provisionTeam() does `insert(teams).select().single()`, which PostgREST executes
-- as `INSERT ... RETURNING *`. RETURNING re-checks the SELECT policy against the new
-- row. The old teams_select policy required `is_team_member(id)` — but the
-- owner-bootstrap AFTER trigger (trg_team_created → handle_new_team) only creates the
-- owner's team_members row AFTER the insert, so at RETURNING-check time the membership
-- does not exist yet → is_team_member(new id) = false → "new row violates row-level
-- security policy for table teams". (A plain INSERT without RETURNING succeeds, and the
-- team is visible on a later SELECT once the trigger has run — which is why the row was
-- created but the call still errored.)
--
-- Fix: an owner can always read their OWN team. The freshly-inserted row satisfies
-- `owner_user_id = auth.uid()` immediately, so RETURNING succeeds. No security loss:
-- you can only ever see a team you already own. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select using (public.is_team_member(id) or owner_user_id = auth.uid());
