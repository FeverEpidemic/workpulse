begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- T25 release catalog guards (PRD R01 and Privacy, release scenario 6, T25 plan section 1.3).
-- Every rule reads the catalog, so a table, function or bucket added after T25 is covered without editing this file.
-- Each rule is proven able to fail: a violating object is created inside a subtransaction that is rolled back,
-- and the rule must report it.

-- 1. The rules ------------------------------------------------------------------

create or replace function pg_temp.release_violations()
returns table (rule text, object text)
language sql
stable
as $$
  -- Every public table has row level security.
  select 'rls_missing'::text, format('public.%I', c.relname)
  from pg_catalog.pg_class as c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
  union all
  -- Every public table that carries a user_id column (and profiles, keyed by id) has the account write guard.
  select 'guard_missing', format('public.%I', c.relname)
  from pg_catalog.pg_class as c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and (c.relname = 'profiles' or exists (
      select 1 from pg_catalog.pg_attribute as a
      where a.attrelid = c.oid and a.attname = 'user_id' and a.attnum > 0 and not a.attisdropped))
    and not exists (
      select 1 from pg_catalog.pg_trigger as t
      where t.tgrelid = c.oid and t.tgname = 'zz_guard_account_writable' and not t.tgisinternal)
  union all
  -- anon holds no privilege, table or column level, on any relation of public or internal.
  select 'anon_table_privilege', format('%s.%I', c.relnamespace::regnamespace, c.relname)
  from pg_catalog.pg_class as c
  where c.relnamespace in ('public'::regnamespace, 'internal'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
  union all
  -- No API role holds a privilege on a table of the internal schema; only security definer functions reach it.
  select 'internal_table_privilege', format('internal.%I -> %s', c.relname, r.rolname)
  from pg_catalog.pg_class as c
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
  where c.relnamespace = 'internal'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_any_column_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
  union all
  -- Every security definer function of public or internal pins its search_path.
  select 'secdef_search_path', format('%s.%s(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid))
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname in ('public', 'internal') and p.prokind in ('f', 'p') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg where cfg like 'search_path=%')
    and not exists (select 1 from pg_catalog.pg_depend as d where d.objid = p.oid and d.deptype = 'e')
  union all
  -- anon cannot execute any function of public. The allowlist is empty on purpose: v0.1 has no anonymous RPC, and sign-in
  -- goes through the Auth service. A function added here needs a one line reason in this list.
  select 'anon_function', format('public.%s(%s)', p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid))
  from pg_catalog.pg_proc as p
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and not exists (select 1 from pg_catalog.pg_depend as d where d.objid = p.oid and d.deptype = 'e')
    and p.proname <> all (array[]::text[])
  union all
  -- The helper functions of internal are reachable only if anon may use the schema.
  select 'internal_schema_usage', 'internal'
  where has_schema_privilege('anon', 'internal', 'USAGE')
  union all
  -- The private bucket and any other bucket are never public.
  select 'public_bucket', b.id
  from storage.buckets as b
  where b.public
$$;

-- Runs setup statements in a subtransaction, counts the violations of one rule, and rolls the setup back.
create or replace function pg_temp.probe(p_setup text[], p_rule text)
returns boolean
language plpgsql
as $$
declare
  v_before integer;
  v_after integer := 0;
  v_statement text;
begin
  select count(*)::integer into v_before from pg_temp.release_violations() as v where v.rule = p_rule;
  begin
    foreach v_statement in array p_setup loop
      execute v_statement;
    end loop;
    select count(*)::integer into v_after from pg_temp.release_violations() as v where v.rule = p_rule;
    raise exception 'probe rollback' using errcode = 'P0T25';
  exception when sqlstate 'P0T25' then
    null;
  end;
  return v_after > v_before;
end
$$;

-- 2. The real catalog satisfies every rule --------------------------------------

select is_empty($$select * from pg_temp.release_violations() where rule = 'rls_missing'$$,
  'every public table has row level security');
select is_empty($$select * from pg_temp.release_violations() where rule = 'guard_missing'$$,
  'every public table with a user_id column, and profiles, has the zz_guard_account_writable trigger');
select is_empty($$select * from pg_temp.release_violations() where rule = 'anon_table_privilege'$$,
  'anon has no privilege on any relation of public or internal');
select is_empty($$select * from pg_temp.release_violations() where rule = 'internal_table_privilege'$$,
  'no API role has a privilege on any table of internal');
select is_empty($$select * from pg_temp.release_violations() where rule = 'secdef_search_path'$$,
  'every security definer function of public and internal sets its search_path');
select is_empty($$select * from pg_temp.release_violations() where rule = 'anon_function'$$,
  'anon cannot execute any function of public');
select is_empty($$select * from pg_temp.release_violations() where rule = 'internal_schema_usage'$$,
  'anon has no USAGE on the internal schema');
select is_empty($$select * from pg_temp.release_violations() where rule = 'public_bucket'$$,
  'no storage bucket is public');

-- The rules above would also pass on an empty catalog; these bounds show they look at the real schema.
select cmp_ok(
  (select count(*)::integer from pg_catalog.pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')),
  '>=', 18, 'the catalog scan sees at least the 18 public tables of T25');
select cmp_ok(
  (select count(*)::integer from pg_catalog.pg_class where relnamespace = 'internal'::regnamespace and relkind in ('r', 'p')),
  '>=', 9, 'the catalog scan sees at least the 9 internal tables of T25');
select cmp_ok(
  (select count(*)::integer from pg_catalog.pg_proc
    where pronamespace in ('public'::regnamespace, 'internal'::regnamespace) and prosecdef),
  '>=', 100, 'the catalog scan sees the security definer functions');
select cmp_ok((select count(*)::integer from storage.buckets), '>=', 1, 'the catalog scan sees the private bucket');

-- 3. Every rule can fail ---------------------------------------------------------

select ok(
  pg_temp.probe(array['create table public.zz_t25_probe (id integer)'], 'rls_missing'),
  'rls_missing reports a public table created without row level security');
select ok(
  pg_temp.probe(array[
    'create table public.zz_t25_probe (id integer, user_id uuid)',
    'alter table public.zz_t25_probe enable row level security'], 'guard_missing'),
  'guard_missing reports a table with a user_id column and no write guard');
select ok(
  pg_temp.probe(array[
    'create table public.zz_t25_probe (id integer)',
    'grant select on public.zz_t25_probe to anon'], 'anon_table_privilege'),
  'anon_table_privilege reports a table granted to anon');
select ok(
  pg_temp.probe(array[
    'create table public.zz_t25_probe (id integer, secret text)',
    'grant select (secret) on public.zz_t25_probe to anon'], 'anon_table_privilege'),
  'anon_table_privilege reports a column level grant to anon');
select ok(
  pg_temp.probe(array[
    'create table internal.zz_t25_probe (id integer)',
    'grant select on internal.zz_t25_probe to authenticated'], 'internal_table_privilege'),
  'internal_table_privilege reports an internal table granted to authenticated');
select ok(
  pg_temp.probe(array[
    'create table internal.zz_t25_probe (id integer)',
    'grant select on internal.zz_t25_probe to service_role'], 'internal_table_privilege'),
  'internal_table_privilege reports an internal table granted to service_role');
select ok(
  pg_temp.probe(array[
    $f$create function public.zz_t25_probe() returns integer language sql security definer as 'select 1'$f$],
    'secdef_search_path'),
  'secdef_search_path reports a security definer function without search_path');
select ok(
  pg_temp.probe(array[
    $f$create function internal.zz_t25_probe() returns integer language sql security definer as 'select 1'$f$],
    'secdef_search_path'),
  'secdef_search_path reports an internal security definer function without search_path');
select ok(
  pg_temp.probe(array[
    $f$create function public.zz_t25_probe() returns integer language sql set search_path = pg_catalog as 'select 1'$f$,
    'grant execute on function public.zz_t25_probe() to anon'], 'anon_function'),
  'anon_function reports a public function executable by anon');
select ok(
  pg_temp.probe(array['grant usage on schema internal to anon'], 'internal_schema_usage'),
  'internal_schema_usage reports USAGE on internal granted to anon');
select ok(
  pg_temp.probe(array['update storage.buckets set public = true'], 'public_bucket'),
  'public_bucket reports a public bucket');

-- A setup that creates no violation is not reported, so the probe is not trivially true.
select ok(
  not pg_temp.probe(array['select 1'], 'rls_missing') and not pg_temp.probe(array['select 1'], 'public_bucket'),
  'a harmless setup is not reported as a violation');

-- A clean probe leaves nothing behind.
select is_empty($$select * from pg_temp.release_violations()$$, 'the probes rolled back and the catalog is still clean');
select ok(
  to_regclass('public.zz_t25_probe') is null and to_regclass('internal.zz_t25_probe') is null
  and to_regprocedure('public.zz_t25_probe()') is null and to_regprocedure('internal.zz_t25_probe()') is null,
  'no probe object survives');

select * from finish();
rollback;
