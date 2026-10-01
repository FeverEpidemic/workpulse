-- T19 gate review F2 (decision 0025). Forward-only.
-- internal.cv_profile_overrides_valid is only called by the cv_documents check constraint and by
-- public.save_cv_edits (security definer), both as the table owner. Like every other internal CV helper (T18),
-- it is not executable by API roles; the default PUBLIC grant is removed as well.

revoke all on function internal.cv_profile_overrides_valid(jsonb) from public, anon, authenticated, service_role;
