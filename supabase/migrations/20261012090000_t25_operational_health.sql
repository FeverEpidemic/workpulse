-- T25 operational health (T25 plan sections 2.2.8 and 3.1, decision 0031).
-- One service-role RPC that counts, without content, the queues an operator must watch: deletion, cleanup, retention
-- purge, stuck uploads, failed jobs and expired leases. `pnpm ops:check` reads it and compares each count with a
-- threshold. No new column or table; every count comes from columns that T05 to T23 already maintain.

begin;

-- p_now is the reference time (default now()). Every age is measured from it, so the report can be replayed for a past
-- or future instant in tests. Definitions:
--   account_deletion_overdue  same rule as get_account_deletion_backlog: not completed and requested over 24 hours ago.
--   storage_cleanup_failed    cleanup jobs in status failed.
--   storage_cleanup_overdue   cleanup jobs still queued or running 24 hours after they were created.
--   import_purge_overdue      terminal import batches (failed, cancelled, committed) not purged 24 hours after the
--                             terminal timestamp; PRD Data minimization requires purge within 24 hours.
--   export_purge_overdue      succeeded exports not purged 24 hours after they finished.
--   evidence_stuck            files still uploading or scanning one hour after their last change.
--   jobs_failed_24h           AI jobs, exports and import batches that failed in the 24 hours up to p_now.
--   jobs_expired_lease        running jobs whose lease ran out more than 10 minutes ago (AI, export, import, evidence
--                             scan, cleanup and account deletion).
create or replace function public.get_operational_health(p_now timestamptz default pg_catalog.now())
returns table (metric text, value integer)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  with clock as (select coalesce(p_now, pg_catalog.now()) as ref)
  select m.metric, m.value
  from clock
  cross join lateral (values
    (1, 'account_deletion_overdue', (
      select count(*)::integer from internal.account_deletions as receipt
      where receipt.status <> 'completed' and receipt.requested_at <= clock.ref - interval '24 hours'
    )),
    (2, 'storage_cleanup_failed', (
      select count(*)::integer from internal.storage_jobs as job
      where job.status = 'failed'
    )),
    (3, 'storage_cleanup_overdue', (
      select count(*)::integer from internal.storage_jobs as job
      where job.status in ('queued', 'running') and job.created_at <= clock.ref - interval '24 hours'
    )),
    (4, 'import_purge_overdue', (
      select count(*)::integer from public.import_batches as batch
      where batch.status in ('failed', 'cancelled', 'committed') and batch.purged_at is null
        and coalesce(batch.failed_at, batch.cancelled_at, batch.committed_at) <= clock.ref - interval '24 hours'
    )),
    (5, 'export_purge_overdue', (
      select count(*)::integer from public.cv_exports as export
      where export.status = 'succeeded' and export.purged_at is null and export.finished_at <= clock.ref - interval '24 hours'
    )),
    (6, 'evidence_stuck', (
      select count(*)::integer from public.evidence_files as file
      where file.status in ('uploading', 'scanning') and file.updated_at <= clock.ref - interval '1 hour'
    )),
    (7, 'jobs_failed_24h', (
      select count(*)::integer from public.ai_jobs as job
      where job.status = 'failed' and job.finished_at > clock.ref - interval '24 hours' and job.finished_at <= clock.ref
    ) + (
      select count(*)::integer from public.cv_exports as export
      where export.status = 'failed' and export.finished_at > clock.ref - interval '24 hours' and export.finished_at <= clock.ref
    ) + (
      select count(*)::integer from public.import_batches as batch
      where batch.status = 'failed' and batch.failed_at > clock.ref - interval '24 hours' and batch.failed_at <= clock.ref
    )),
    (8, 'jobs_expired_lease', (
      select count(*)::integer from public.ai_jobs as job
      where job.status = 'running' and job.lease_expires_at <= clock.ref - interval '10 minutes'
    ) + (
      select count(*)::integer from public.cv_exports as export
      where export.status = 'running' and export.lease_expires_at <= clock.ref - interval '10 minutes'
    ) + (
      select count(*)::integer from internal.import_jobs as job
      where job.status = 'running' and job.lease_expires_at <= clock.ref - interval '10 minutes'
    ) + (
      select count(*)::integer from internal.evidence_scan_jobs as job
      where job.status = 'running' and job.lease_expires_at <= clock.ref - interval '10 minutes'
    ) + (
      select count(*)::integer from internal.storage_jobs as job
      where job.status = 'running' and job.lease_expires_at <= clock.ref - interval '10 minutes'
    ) + (
      select count(*)::integer from internal.account_deletions as receipt
      where receipt.status = 'running' and receipt.lease_expires_at <= clock.ref - interval '10 minutes'
    ))
  ) as m(ord, metric, value)
  order by m.ord
$$;

revoke all on function public.get_operational_health(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.get_operational_health(timestamptz) to service_role;

comment on function public.get_operational_health(timestamptz) is
  'T25: service role only. Eight content-free counts (deletion, cleanup, purge, stuck uploads, failed jobs, expired leases) measured at p_now; read by ops:check.';

commit;
