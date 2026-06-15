-- ════════════════════════════════════════════════════════════════════════════
-- onboarding_responses — first-run discovery answers
-- ════════════════════════════════════════════════════════════════════════════
-- Captured by the post-signup onboarding wizard (workspace creators only). One
-- row per completion. Private to the user who wrote it: a user may insert/read/
-- update only their OWN rows (user_id = auth.uid()). Array answers (obstacles,
-- conversion_reasons) are stored as text[].
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.onboarding_responses (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade default auth.uid(),
  team_id            uuid references public.teams (id) on delete set null,
  full_name          text,
  company_name       text,
  goal               text,
  obstacles          text[] not null default '{}',
  past_experience    text,
  scale              text,
  referral_source    text,
  conversion_reasons text[] not null default '{}',
  completed_at       timestamptz not null default now()
);

create index if not exists idx_onboarding_user on public.onboarding_responses (user_id);

alter table public.onboarding_responses enable row level security;

-- A user owns their onboarding answers — they may read/write only their own, and
-- may only attach a team_id they actually belong to (no probing arbitrary teams).
create policy onboarding_select on public.onboarding_responses
  for select using (user_id = auth.uid());
create policy onboarding_insert on public.onboarding_responses
  for insert with check (user_id = auth.uid() and (team_id is null or public.is_team_member(team_id)));
create policy onboarding_update on public.onboarding_responses
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and (team_id is null or public.is_team_member(team_id)));

grant select, insert, update on public.onboarding_responses to authenticated;
