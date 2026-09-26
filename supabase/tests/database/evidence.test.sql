begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_table('evidence_files','Evidence metadata exists');
select ok((select relrowsecurity from pg_class where oid='public.evidence_files'::regclass),'Evidence RLS enabled');
select ok(not has_table_privilege('authenticated','public.evidence_files','UPDATE'),'Client cannot bypass lifecycle');
select ok(not has_function_privilege('authenticated','public.reserve_evidence_upload(uuid,text,uuid,text,text,bigint,uuid,integer)','EXECUTE'),'Reservation requires server boundary');
select ok(not exists(select 1 from pg_constraint where conrelid='internal.storage_jobs'::regclass and contype='f'),'Cleanup survives owner deletion');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('b1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t10-pgtap-a@workpulse.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
('b1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t10-pgtap-b@workpulse.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into projects(id,user_id,title) values
('b1000000-0000-4000-8000-000000000011','b1000000-0000-4000-8000-000000000001','A'),
('b1000000-0000-4000-8000-000000000012','b1000000-0000-4000-8000-000000000002','B');
create temp table t10_file as select * from reserve_evidence_upload('b1000000-0000-4000-8000-000000000001','project','b1000000-0000-4000-8000-000000000011','fixture.pdf','application/pdf',20,'b1000000-0000-4000-8000-000000000021',1);
select is((select revision from t10_file),1,'Initial evidence revision');
select ok((select reservation_expires_at between now()+interval '14 minutes' and now()+interval '16 minutes' from t10_file),'Reservation lasts 15 minutes');
select throws_ok(format('update evidence_files set project_id=%L where id=%L','b1000000-0000-4000-8000-000000000012',(select id from t10_file)),'23503',null,'Composite FK rejects foreign parent');
select throws_ok(format('update evidence_files set project_id=null where id=%L',(select id from t10_file)),'23514',null,'Exactly one parent required');
select throws_ok(format('update evidence_files set status=%L where id=%L','ready',(select id from t10_file)),'23514',null,'Ready requires verified fields');
create temp table t10_scan as select * from finalize_evidence_upload('b1000000-0000-4000-8000-000000000001',(select id from t10_file),1,20,'application/pdf',repeat('a',64));
select is((select status from t10_scan),'scanning','Finalize persists scanning');
update internal.evidence_scan_jobs set next_attempt_at=now()-interval '1 day' where id=(select scan_job_id from t10_scan);
create temp table t10_claim as select * from claim_evidence_scan_jobs(1);
select is((select id from t10_claim),(select scan_job_id from t10_scan),'Worker claims fixture job');
select ok(not complete_evidence_scan_job((select id from t10_claim),gen_random_uuid(),'clean',null),'Foreign attempt token rejected');
update internal.evidence_scan_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=(select id from t10_claim);
select ok(not complete_evidence_scan_job((select id from t10_claim),(select attempt_token from t10_claim),'clean',null),'Expired attempt cannot complete');
create temp table t10_reclaim as select * from claim_evidence_scan_jobs(1);
select isnt((select attempt_token from t10_reclaim),(select attempt_token from t10_claim),'Reclaim replaces token');
select ok(not complete_evidence_scan_job((select id from t10_claim),(select attempt_token from t10_claim),'clean',null),'Late worker cannot overwrite reclaimed attempt');
select ok(complete_evidence_scan_job((select id from t10_reclaim),(select attempt_token from t10_reclaim),'clean',null),'Current lease completes');
select is((select status from evidence_files where id=(select id from t10_file)),'ready','Current clean result marks ready');

delete from projects where id='b1000000-0000-4000-8000-000000000011';
select is((select count(*) from evidence_files where id=(select id from t10_file)),0::bigint,'Parent delete removes canonical evidence');
select ok(exists(select 1 from internal.storage_jobs where evidence_id=(select id from t10_file) and status='queued' and evidence_original_name='fixture.pdf'),'Parent deletion retains cleanup receipt');
delete from auth.users where id='b1000000-0000-4000-8000-000000000001';
select ok(exists(select 1 from internal.storage_jobs where evidence_id=(select id from t10_file)),'Receipt survives account deletion');
update internal.storage_jobs set next_attempt_at=now()-interval '1 day' where evidence_id=(select id from t10_file);
select internal.enqueue_storage_delete('b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001/import/b1000000-0000-4000-8000-000000000099');
update internal.storage_jobs set next_attempt_at=now()-interval '2 days' where object_key='b1000000-0000-4000-8000-000000000001/import/b1000000-0000-4000-8000-000000000099';
create temp table t10_cleanup as select * from claim_evidence_cleanup_jobs(1);
select is((select object_key from t10_cleanup),(select object_key from t10_file),'Evidence worker skips earlier import cleanup');
select is((select status from internal.storage_jobs where object_key='b1000000-0000-4000-8000-000000000001/import/b1000000-0000-4000-8000-000000000099'),'queued','Import cleanup remains untouched');
select ok(not complete_evidence_cleanup_job((select id from t10_cleanup),gen_random_uuid()),'Cleanup rejects stale token');
select ok(complete_evidence_cleanup_job((select id from t10_cleanup),(select attempt_token from t10_cleanup)),'Cleanup completes current lease after worker verification');
select ok((select evidence_original_name is null from internal.storage_jobs where id=(select id from t10_cleanup)),'Completed cleanup scrubs retained filename');
insert into storage.objects(bucket_id,name,created_at,updated_at,metadata)
values ('workpulse-private','b1000000-0000-4000-8000-000000000001/evidence/b1000000-0000-4000-8000-000000000098',now()-interval '2 hours',now(),'{"size":20,"mimetype":"application/pdf"}');
create temp table t10_orphan as select * from reconcile_orphan_evidence_objects(3600,100);
select ok(exists(select 1 from t10_orphan where object_key='b1000000-0000-4000-8000-000000000001/evidence/b1000000-0000-4000-8000-000000000098'),'Aged orphan queues durable deletion');
select is((select count(*) from reconcile_orphan_evidence_objects(3600,100) where object_key='b1000000-0000-4000-8000-000000000001/evidence/b1000000-0000-4000-8000-000000000098'),0::bigint,'Repeated reconciliation does not duplicate active receipt');

insert into public.activities (id,user_id,raw_text,occurred_on,capture_mode)
values ('b1000000-0000-4000-8000-000000000031','b1000000-0000-4000-8000-000000000002','T11 source Activity','2026-09-25','note');
insert into public.achievements (id,user_id,activity_id,origin,source_excerpt,source_activity_revision)
values ('b1000000-0000-4000-8000-000000000041','b1000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000031','activity','T11 source Activity',1);
create temp table t11_activity_file as
select * from reserve_evidence_upload('b1000000-0000-4000-8000-000000000002','activity','b1000000-0000-4000-8000-000000000031','activity.pdf','application/pdf',20,'b1000000-0000-4000-8000-000000000051',1);
create temp table t11_achievement_file as
select * from reserve_evidence_upload('b1000000-0000-4000-8000-000000000002','achievement','b1000000-0000-4000-8000-000000000041','achievement.pdf','application/pdf',20,'b1000000-0000-4000-8000-000000000052',1);
select is((select count(*) from list_evidence_files('b1000000-0000-4000-8000-000000000002','activity','b1000000-0000-4000-8000-000000000031')),1::bigint,'T11 list returns the exact direct Activity children');
select is((select count(*) from list_evidence_files('b1000000-0000-4000-8000-000000000001','activity','b1000000-0000-4000-8000-000000000031')),0::bigint,'T11 list hides a foreign owner parent');
select is((select count(*) from list_evidence_files('b1000000-0000-4000-8000-000000000002','achievement','b1000000-0000-4000-8000-000000000041')),1::bigint,'T11 list returns the exact direct Achievement children');
update public.evidence_files set status='deleting',reserved_until=null,error_code='PARENT_DELETED' where id=(select id from t11_activity_file);
select is((select count(*) from list_evidence_files('b1000000-0000-4000-8000-000000000002','activity','b1000000-0000-4000-8000-000000000031')),1::bigint,'T11 list includes direct evidence in deleting state');
delete from public.activities where id='b1000000-0000-4000-8000-000000000031';
select is((select count(*) from public.evidence_files where id=(select id from t11_activity_file)),0::bigint,'Activity deletion removes canonical evidence');
select ok(exists(select 1 from internal.storage_jobs where evidence_id=(select id from t11_activity_file) and status='queued'),'Activity deletion preserves an evidence cleanup receipt');
delete from public.achievements where id='b1000000-0000-4000-8000-000000000041';
select is((select count(*) from public.evidence_files where id=(select id from t11_achievement_file)),0::bigint,'Achievement deletion removes canonical evidence');
select ok(exists(select 1 from internal.storage_jobs where evidence_id=(select id from t11_achievement_file) and status='queued'),'Achievement deletion preserves an evidence cleanup receipt');
select * from finish();
rollback;
