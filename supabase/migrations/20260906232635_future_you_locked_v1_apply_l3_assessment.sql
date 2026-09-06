-- Application is atomic: the append-only interpretation, materialized live
-- state, and evidence links either all succeed or none do.
create or replace function public.future_you_apply_locked_progression_assessment(
  p_user_id uuid, p_goal_id uuid, p_expected_revision integer, p_assessment jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $future_you_apply_l3$
declare
  v_state public.progression_l3_states%rowtype;
  v_topic_contract_id uuid;
  v_new_revision integer;
  v_assessment_id uuid;
begin
  if jsonb_typeof(p_assessment) <> 'object' or jsonb_typeof(jsonb_extract_path(p_assessment,'evidenceReferences')) <> 'array' then
    raise exception 'future_you_assessment_payload_invalid';
  end if;
  select * into v_state from public.progression_l3_states
    where goal_id=p_goal_id and user_id=p_user_id for update;
  if not found then raise exception 'future_you_l3_state_not_found'; end if;
  if v_state.revision <> p_expected_revision then raise exception 'future_you_l3_revision_conflict'; end if;
  select gcb.contract_version_id into v_topic_contract_id
    from public.goal_contract_bindings gcb
    join public.future_you_contract_versions cv on cv.id=gcb.contract_version_id
    where gcb.goal_id=p_goal_id and gcb.user_id=p_user_id and gcb.binding_role='topic'
      and cv.scope='topic' and cv.status='locked'
    limit 1;
  if v_topic_contract_id is null then raise exception 'future_you_locked_topic_binding_not_found'; end if;
  if exists (
    select 1 from jsonb_array_elements(jsonb_extract_path(p_assessment,'evidenceReferences')) as ref(value)
    where not exists (
      select 1 from public.canonical_evidence ce
      where ce.id=jsonb_extract_path_text(ref.value,'evidenceId')::uuid and ce.goal_id=p_goal_id and ce.user_id=p_user_id
    )
  ) then raise exception 'future_you_assessment_evidence_not_found'; end if;

  v_new_revision := v_state.revision + 1;
  insert into public.progression_l3_assessments(goal_id,user_id,topic_contract_version_id,assessment,prior_revision,resulting_revision)
  values(p_goal_id,p_user_id,v_topic_contract_id,p_assessment,v_state.revision,v_new_revision)
  returning id into v_assessment_id;
  update public.progression_l3_states set
    state=coalesce(jsonb_extract_path(p_assessment,'currentState'),'{}'::jsonb),
    state_confidence=coalesce(jsonb_extract_path(p_assessment,'stateConfidence'),'{}'::jsonb),
    roles=jsonb_build_object('entries',coalesce(jsonb_extract_path(p_assessment,'roles'),'[]'::jsonb)),
    unresolved=coalesce(jsonb_extract_path(p_assessment,'unresolved'),'[]'::jsonb),
    next_evidence_target=coalesce(jsonb_extract_path(p_assessment,'nextEvidenceTarget'),'{}'::jsonb),
    audit_status=jsonb_build_object('status','evidence_assessed','assessment_id',v_assessment_id,'plan_recommendation',coalesce(jsonb_extract_path(p_assessment,'planRecommendation'),'null'::jsonb)),
    revision=v_new_revision, updated_at=now()
  where id=v_state.id;
  insert into public.evidence_applications(canonical_evidence_id,goal_id,user_id,target_scope,target_key,application_type,rationale)
  select jsonb_extract_path_text(ref.value,'evidenceId')::uuid,p_goal_id,p_user_id,'level_3',jsonb_extract_path_text(p_assessment,'topicKey'),jsonb_extract_path_text(ref.value,'applicationType'),jsonb_extract_path_text(ref.value,'rationale')
    from jsonb_array_elements(jsonb_extract_path(p_assessment,'evidenceReferences')) as ref(value)
  on conflict (canonical_evidence_id,target_scope,target_key,application_type) do nothing;
  return jsonb_build_object('assessment_id',v_assessment_id,'prior_revision',v_state.revision,'resulting_revision',v_new_revision);
end;
$future_you_apply_l3$;
revoke all on function public.future_you_apply_locked_progression_assessment(uuid,uuid,integer,jsonb) from public;
revoke all on function public.future_you_apply_locked_progression_assessment(uuid,uuid,integer,jsonb) from anon;
revoke all on function public.future_you_apply_locked_progression_assessment(uuid,uuid,integer,jsonb) from authenticated;
grant execute on function public.future_you_apply_locked_progression_assessment(uuid,uuid,integer,jsonb) to service_role;
