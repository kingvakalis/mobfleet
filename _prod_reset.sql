-- One-off prod reset: drop the app's `public` objects so the consolidated
-- migrations can apply fresh. Excludes extension-owned objects (e.g. pgcrypto)
-- and leaves the `public` schema itself + its grants/default-privileges intact.
-- Verified safe before running: all target tables have 0 rows.
do $$
declare r record;
begin
  -- Tables first (cascade drops their indexes, policies, triggers, FKs).
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;

  -- Enum types (now free of dependents). Skip extension-owned types.
  for r in
    select t.typname
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
      and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
  loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;

  -- Functions (incl. the old-variant rls_auto_enable). Skip extension-owned
  -- functions (pgcrypto's gen_salt/crypt/etc.) — those cannot be dropped directly.
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;
