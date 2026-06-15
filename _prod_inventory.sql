-- One-off prod inventory (exact row counts + object lists). Read-only.
select json_build_object(
  'counts', json_build_object(
    'teams',           (select count(*) from public.teams),
    'team_members',    (select count(*) from public.team_members),
    'devices',         (select count(*) from public.devices),
    'automation_jobs', (select count(*) from public.automation_jobs)
  ),
  'tables',    (select coalesce(json_agg(tablename order by tablename), '[]')
                from pg_tables where schemaname = 'public'),
  'enums',     (select coalesce(json_agg(typname order by typname), '[]')
                from pg_type t join pg_namespace n on n.oid = t.typnamespace
                where n.nspname = 'public' and t.typtype = 'e'),
  'functions', (select coalesce(json_agg(p.proname order by p.proname), '[]')
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'))
) as state;
