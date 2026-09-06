create or replace function public.future_you_revise_locked_live_plan(
  p_user_id uuid, p_goal_id uuid, p_evidence_id uuid, p_expected_revision integer, p_plan jsonb, p_integrity_hash text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_live record; v_original_id uuid;
begin
  if jsonb_typeof(p_plan) <> 'object' or coalesce(length(trim(p_integrity_hash)),0) < 16 then raise exception 'future_you_plan_payload_invalid'; end if;
  select id into v_original_id from public.original_action_plans where goal_id=p_goal_id and user_id=p_user_id and schema_version='locked-v1';
  if v_original_id is null then raise exception 'future_you_locked_plan_not_found'; end if;
  if not exists (select 1 from public.canonical_evidence where id=p_evidence_id and goal_id=p_goal_id and user_id=p_user_id) then raise exception 'future_you_evidence_not_found'; end if;
  select id,revision into v_live from public.live_action_plans where goal_id=p_goal_id and user_id=p_user_id for update;
  if not found then raise exception 'future_you_live_plan_not_found'; end if;
  if v_live.revision <> p_expected_revision then raise exception 'future_you_live_plan_stale'; end if;
  update public.live_action_plans set plan=p_plan, revision=revision+1, completed_checksum=p_integrity_hash, source_event_id=p_evidence_id, updated_at=now() where id=v_live.id;
  insert into public.evidence_applications (canonical_evidence_id,goal_id,user_id,target_scope,target_key,application_type,rationale)
  values (p_evidence_id,p_goal_id,p_user_id,'action_plan','live_plan_revision_' || (v_live.revision+1),'supports','Evidence recorded before this Live Plan revision.');
  return jsonb_build_object('live_plan_id',v_live.id,'revision',v_live.revision+1,'original_plan_id',v_original_id);
end;
$$;
revoke all on function public.future_you_revise_locked_live_plan(uuid,uuid,uuid,integer,jsonb,text) from public;
revoke all on function public.future_you_revise_locked_live_plan(uuid,uuid,uuid,integer,jsonb,text) from anon;
revoke all on function public.future_you_revise_locked_live_plan(uuid,uuid,uuid,integer,jsonb,text) from authenticated;
grant execute on function public.future_you_revise_locked_live_plan(uuid,uuid,uuid,integer,jsonb,text) to service_role;
