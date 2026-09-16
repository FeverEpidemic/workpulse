-- T03 updates the onboarding boundary before the application consumes it.
-- The profile remains provisional until the user chooses a real display name.

drop function public.complete_onboarding(text, integer);

create function public.complete_onboarding(
  p_display_name text,
  p_locale text,
  p_timezone text,
  p_expected_revision integer
)
returns setof public.profiles
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
     or not internal.lock_profile_revision(v_user_id, p_expected_revision) then
    return;
  end if;

  if not internal.is_real_display_name(p_display_name) then
    raise exception using
      errcode = '22023',
      message = 'INVALID_DISPLAY_NAME';
  end if;

  if p_locale is null or p_locale not in ('en', 'id') then
    raise exception using
      errcode = '22023',
      message = 'INVALID_LOCALE';
  end if;

  if not internal.is_valid_timezone(p_timezone) then
    raise exception using
      errcode = '22023',
      message = 'INVALID_TIMEZONE';
  end if;

  return query
  update public.profiles
  set display_name = btrim(p_display_name),
      locale = p_locale,
      timezone = p_timezone,
      onboarding_completed_at = coalesce(onboarding_completed_at, now())
  where id = v_user_id
    and revision = p_expected_revision
  returning *;
end;
$$;

revoke all on function public.complete_onboarding(text, text, text, integer)
  from public, anon;
grant execute on function public.complete_onboarding(text, text, text, integer)
  to authenticated;

comment on function public.complete_onboarding(text, text, text, integer) is
  'Atomically completes onboarding after validating the owner, expected revision, display name, locale, and PostgreSQL timezone catalog entry.';
