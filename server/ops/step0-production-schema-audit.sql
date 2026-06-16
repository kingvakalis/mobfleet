-- Phase 3B/Step 0: PRODUCTION schema-reconciliation audit -- STRICTLY READ-ONLY.
--
-- Run this in the Railway Postgres service console (psql). It opens ONE
-- REPEATABLE READ READ ONLY transaction, reads only system catalogs +
-- information_schema (+ exact row counts via the built-in query_to_xml, which
-- executes only SELECTs), and ROLLBACKs. It performs NO writes, DDL, temp
-- tables, functions, views, role/privilege changes, or migrations.
--
-- It returns ONE row / ONE column ("step0_audit_json") -- a single deterministic
-- JSON document. Copy only that JSON value and paste it back.
--
-- _prisma_migrations is read SAFELY: existence is checked with to_regclass and its
-- rows are fetched through a guarded dynamic SELECT (string passed to query_to_xml),
-- so the script never errors when that table is absent.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH
meta AS (
  SELECT current_database() AS current_database,
         current_user       AS current_user,
         current_setting('transaction_read_only') AS transaction_read_only,
         current_setting('server_version')        AS server_version
),
owners AS (
  SELECT
    (SELECT pg_get_userbyid(d.datdba) FROM pg_database d WHERE d.datname = current_database()) AS database_owner,
    (SELECT pg_get_userbyid(n.nspowner) FROM pg_namespace n WHERE n.nspname = 'public')        AS public_schema_owner
),
tbls AS (
  SELECT c.oid, n.nspname, c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname = 'public'
),
row_counts AS (
  SELECT coalesce(json_object_agg(relname, cnt ORDER BY relname), '{}'::json) AS j
  FROM (
    SELECT t.relname,
      (xpath('//*[local-name()="c"]/text()',
             query_to_xml(format('SELECT count(*) AS c FROM %I.%I', t.nspname, t.relname),
                          false, false, '')))[1]::text::bigint AS cnt
    FROM tbls t
  ) s
),
table_owners AS (
  SELECT coalesce(json_agg(json_build_object('table', c.relname, 'owner', pg_get_userbyid(c.relowner))
                           ORDER BY c.relname), '[]'::json) AS j
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname = 'public'
),
cols AS (
  SELECT coalesce(json_agg(json_build_object(
           'table', table_name, 'position', ordinal_position, 'column', column_name,
           'data_type', data_type, 'udt_name', udt_name, 'is_nullable', is_nullable,
           'column_default', column_default) ORDER BY table_name, ordinal_position), '[]'::json) AS j
  FROM information_schema.columns WHERE table_schema = 'public'
),
constraints_all AS (
  SELECT coalesce(json_agg(json_build_object(
           'table', conrelid::regclass::text, 'name', conname,
           'type', CASE contype WHEN 'p' THEN 'primary_key' WHEN 'u' THEN 'unique'
                                WHEN 'f' THEN 'foreign_key' WHEN 'c' THEN 'check' ELSE contype::text END,
           'definition', pg_get_constraintdef(oid))
           ORDER BY conrelid::regclass::text, conname), '[]'::json) AS j
  FROM pg_constraint WHERE connamespace = 'public'::regnamespace
),
indexes_all AS (
  SELECT coalesce(json_agg(json_build_object('table', tablename, 'name', indexname, 'definition', indexdef)
                           ORDER BY tablename, indexname), '[]'::json) AS j
  FROM pg_indexes WHERE schemaname = 'public'
),
sequences_all AS (
  SELECT coalesce(json_agg(sequence_name ORDER BY sequence_name), '[]'::json) AS j
  FROM information_schema.sequences WHERE sequence_schema = 'public'
),
triggers_all AS (
  SELECT coalesce(json_agg(json_build_object('table', event_object_table, 'name', trigger_name,
           'timing', action_timing, 'event', event_manipulation)
           ORDER BY event_object_table, trigger_name, event_manipulation), '[]'::json) AS j
  FROM information_schema.triggers WHERE trigger_schema = 'public'
),
extensions_all AS (
  SELECT coalesce(json_agg(json_build_object('name', extname, 'version', extversion) ORDER BY extname), '[]'::json) AS j
  FROM pg_extension
),
roles_all AS (
  SELECT coalesce(json_agg(json_build_object(
           'role', r.rolname, 'superuser', r.rolsuper, 'createdb', r.rolcreatedb,
           'createrole', r.rolcreaterole, 'login', r.rolcanlogin, 'bypassrls', r.rolbypassrls,
           'inherit', r.rolinherit,
           'create_on_public', has_schema_privilege(r.oid, 'public', 'CREATE'),
           'usage_on_public',  has_schema_privilege(r.oid, 'public', 'USAGE'),
           'create_on_database', has_database_privilege(r.oid, current_database(), 'CREATE'))
           ORDER BY r.rolname), '[]'::json) AS j
  FROM pg_roles r WHERE r.rolname NOT LIKE 'pg\_%'
),
grants_all AS (
  SELECT coalesce(json_agg(g ORDER BY (g->>'grantee')), '[]'::json) AS j
  FROM (
    SELECT json_build_object('grantee', grantee, 'tables', count(*),
             'privileges', string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type)) AS g
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
    GROUP BY grantee
  ) s
),
invite_fk AS (
  SELECT coalesce(json_agg(json_build_object('name', conname, 'definition', pg_get_constraintdef(oid))
                           ORDER BY conname), '[]'::json) AS j
  FROM pg_constraint
  WHERE contype = 'f' AND conrelid = to_regclass('public."Invite"')
),
pm AS (
  SELECT to_regclass('public._prisma_migrations') AS oid
),
pm_rows AS (
  SELECT CASE WHEN (SELECT oid FROM pm) IS NOT NULL THEN
    (xpath('//*[local-name()="j"]/text()',
       query_to_xml(
         'SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.started_at), ''[]''::json) AS j FROM (SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count FROM public."_prisma_migrations") t',
         true, false, '')))[1]::text::json
    ELSE NULL END AS rows
),
expected(name) AS (
  VALUES ('Team'),('User'),('Membership'),('AuditLog'),('Invite'),('Device'),('Job'),('Proxy'),
         ('Automation'),('DevicePairingToken'),('DeviceApiKey'),('AgentCommand'),
         ('TeamEmailSettings'),('DeviceSession'),('MigrationRecord')
),
unexpected_tables AS (
  SELECT coalesce(json_agg(relname ORDER BY relname), '[]'::json) AS j
  FROM tbls
  WHERE relname NOT IN (SELECT name FROM expected) AND relname <> '_prisma_migrations'
),
missing_expected_tables AS (
  SELECT coalesce(json_agg(name ORDER BY name), '[]'::json) AS j
  FROM expected WHERE name NOT IN (SELECT relname FROM tbls)
),
other_objects AS (
  SELECT json_build_object(
    'non_system_schemas',
      (SELECT coalesce(json_agg(nspname ORDER BY nspname), '[]'::json) FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'),
    'views',
      (SELECT coalesce(json_agg(table_name ORDER BY table_name), '[]'::json)
       FROM information_schema.views WHERE table_schema = 'public'),
    'materialized_views',
      (SELECT coalesce(json_agg(matviewname ORDER BY matviewname), '[]'::json)
       FROM pg_matviews WHERE schemaname = 'public')
  ) AS j
)
SELECT jsonb_pretty(jsonb_build_object(
  'audit', 'step0_production_schema_audit',
  'meta', (SELECT row_to_json(meta) FROM meta),
  'owners', (SELECT row_to_json(owners) FROM owners),
  'tables', (SELECT coalesce(json_agg(relname ORDER BY relname), '[]'::json) FROM tbls),
  'row_counts', (SELECT j FROM row_counts),
  'table_owners', (SELECT j FROM table_owners),
  'prisma_migrations', jsonb_build_object(
      'exists', ((SELECT oid FROM pm) IS NOT NULL),
      'rows', (SELECT rows FROM pm_rows)),
  'columns', (SELECT j FROM cols),
  'constraints', (SELECT j FROM constraints_all),
  'indexes', (SELECT j FROM indexes_all),
  'sequences', (SELECT j FROM sequences_all),
  'triggers', (SELECT j FROM triggers_all),
  'extensions', (SELECT j FROM extensions_all),
  'roles', (SELECT j FROM roles_all),
  'table_grants_by_grantee', (SELECT j FROM grants_all),
  'invite_fk', (SELECT j FROM invite_fk),
  'unexpected_tables', (SELECT j FROM unexpected_tables),
  'missing_expected_tables', (SELECT j FROM missing_expected_tables),
  'other_objects', (SELECT j FROM other_objects)
)) AS step0_audit_json;

ROLLBACK;
