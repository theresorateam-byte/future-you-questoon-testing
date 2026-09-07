-- A Change Path is only completed by the same atomic decision that rewrites
-- the uncompleted Live Plan. It cannot replace an Original Plan or be marked
-- committed independently of a valid evidence-citing adjustment.
create or replace function public.future_you_revise_locked_live_plan_v3(
  p_user_id uuid, p_goal_id uuid, p_progress_update_id uuid, p_assessment_id uuid,
  p_expected_revision integer, p_plan jsonb, p_integrity_hash text, p_completed_checksum text,
  p_live_plan_change text, p_validation_result jsonb, p_change_path_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $future_you_revise_plan_v3$
declare
  v_live record;
  v_update record;
  v_assessment record;
  v_change_path record;
  v_outcome text;
  v_decision_id uuid;
begin
  if jsonb_typeof(p_plan) <> 'object' or jsonb_typeof(p_validation_result) <> 'object'
    or coalesce(length(trim(p_integrity_hash)),0) < 16 or coalesce(length(trim(p_completed_checksum)),0) < 16
    or coalesce(length(trim(p_live_plan_change)),0) = 0 then raise exception 'future_you_plan_payload_invalid'; end if;

  select * into v_update from public.future_you_progress_updates where id=p_progress_update_id and goal_id=p_goal_id and user_id=p_user_id;
  if not found then raise exception 'future_you_progress_update_not_found'; end if;
  select * into v_assessment from public.progression_l3_assessments where id=p_assessment_id and goal_id=p_goal_id and user_id=p_user_id;
  if not found then raise exception 'future_you_progression_assessment_not_found'; end if;
  if not exists (select 1 from public.progression_l3_states where goal_id=p_goal_id and user_id=p_user_id and revision=v_assessment.resulting_revision) then
    raise exception 'future_you_progression_assessment_stale';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_assessment.assessment->'evidenceReferences') ref
    where ref->>'evidenceId'=v_update.canonical_evidence_id::text
  ) then raise exception 'future_you_progress_update_not_assessed'; end if;
  v_outcome := v_assessment.assessment #>> '{planRecommendation,outcome}';
  if v_outcome is null or v_outcome <> p_plan->>'adjustmentOutcome' then raise exception 'future_you_adjustment_outcome_mismatch'; end if;
  if (p_validation_result #>> '{safeAndRealistic,status}') is distinct from 'pass'
    or (p_validation_result #>> '{protectedOutcome,status}') is distinct from 'pass'
    or (p_validation_result #>> '{guardrails,status}') is distinct from 'pass'
    or (p_validation_result #>> '{planFit,status}') is distinct from 'pass'
    or (p_validation_result #>> '{expertFit,status}') is distinct from 'pass'
  then raise exception 'future_you_plan_validation_failed'; end if;

  if p_change_path_id is not null then
    select * into v_change_path from public.change_path_links
      where id=p_change_path_id and goal_id=p_goal_id and user_id=p_user_id and status in ('open','validated') for update;
    if not found then raise exception 'future_you_change_path_not_available'; end if;
    if not exists (
      select 1 from public.intake_instances
      where id=v_change_path.reentry_intake_instance_id and goal_id=p_goal_id and user_id=p_user_id
        and intake_kind='change_path' and status='validated'
    ) then raise exception 'future_you_change_path_source_not_validated'; end if;
  end if;

  select id,revision,plan into v_live from public.live_action_plans where goal_id=p_goal_id and user_id=p_user_id for update;
  if not found then raise exception 'future_you_live_plan_not_found'; end if;
  if v_live.revision <> p_expected_revision or v_update.live_plan_revision <> p_expected_revision then raise exception 'future_you_live_plan_stale'; end if;
  if coalesce(v_live.plan->'completedPortion','[]'::jsonb) <> coalesce(p_plan->'completedPortion','[]'::jsonb) then
    raise exception 'future_you_completed_history_changed';
  end if;
  if exists (select 1 from public.future_you_adjustment_decisions where progress_update_id=p_progress_update_id) then
    raise exception 'future_you_progress_update_already_decided';
  end if;

  update public.live_action_plans set plan=p_plan,revision=revision+1,completed_checksum=p_completed_checksum,
    source_event_id=v_update.canonical_evidence_id,updated_at=now() where id=v_live.id;
  insert into public.future_you_adjustment_decisions(
    goal_id,user_id,progress_update_id,progression_assessment_id,outcome,prior_live_revision,resulting_live_revision,live_plan_change,validation_result,live_plan_integrity_hash
  ) values(p_goal_id,p_user_id,p_progress_update_id,p_assessment_id,v_outcome,v_live.revision,v_live.revision+1,p_live_plan_change,p_validation_result,p_integrity_hash)
  returning id into v_decision_id;
  insert into public.evidence_applications(canonical_evidence_id,goal_id,user_id,target_scope,target_key,application_type,rationale)
  values(v_update.canonical_evidence_id,p_goal_id,p_user_id,'action_plan','live_plan_revision_'||(v_live.revision+1),'supports',p_live_plan_change)
  on conflict (canonical_evidence_id,target_scope,target_key,application_type) do nothing;
  if p_change_path_id is not null then
    update public.change_path_links set status='committed',completed_at=now() where id=p_change_path_id;
  end if;
  return jsonb_build_object('decision_id',v_decision_id,'live_plan_id',v_live.id,'revision',v_live.revision+1,'outcome',v_outcome,'change_path_id',p_change_path_id);
end;
$future_you_revise_plan_v3$;

revoke all on function public.future_you_revise_locked_live_plan_v3(uuid,uuid,uuid,uuid,integer,jsonb,text,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.future_you_revise_locked_live_plan_v3(uuid,uuid,uuid,uuid,integer,jsonb,text,text,text,jsonb,uuid) to service_role;
revoke execute on function public.future_you_revise_locked_live_plan_v2(uuid,uuid,uuid,uuid,integer,jsonb,text,text,text,jsonb) from service_role;
