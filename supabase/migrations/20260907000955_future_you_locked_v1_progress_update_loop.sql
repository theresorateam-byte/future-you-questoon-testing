-- Locked progress capture and adjustment decision ledger. Progress updates
-- are saved before adjustment; both records are append-only and remain
-- separate from the mutable future portion of the Live Plan.
create table if not exists public.future_you_progress_updates (
  id uuid primary key default gen_random_uuid(),
  client_update_id uuid not null,
  goal_id uuid not null references public.goals(id),
  user_id uuid not null references auth.users(id),
  live_plan_revision integer not null check (live_plan_revision > 0),
  today_step jsonb not null check (jsonb_typeof(today_step) = 'object'),
  visible_choices jsonb not null check (jsonb_typeof(visible_choices) = 'array'),
  selected_choice jsonb not null check (jsonb_typeof(selected_choice) = 'object'),
  normalized_state text not null check (normalized_state in ('completed', 'partly_completed', 'not_today')),
  reason_category text check (reason_category in ('time', 'capacity', 'access', 'emotion', 'external_difficulty')),
  reason_code text not null check (length(trim(reason_code)) > 0),
  variables jsonb not null default '[]'::jsonb check (jsonb_typeof(variables) = 'array'),
  optional_note text,
  canonical_evidence_id uuid not null unique references public.canonical_evidence(id),
  correction_of_id uuid references public.future_you_progress_updates(id),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (user_id, client_update_id),
  check (normalized_state = 'completed' or reason_category is not null),
  check (selected_choice->>'normalizedState' = normalized_state)
);

create table if not exists public.future_you_adjustment_decisions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id),
  user_id uuid not null references auth.users(id),
  progress_update_id uuid not null unique references public.future_you_progress_updates(id),
  progression_assessment_id uuid not null unique references public.progression_l3_assessments(id),
  outcome text not null check (outcome in ('continue', 'build', 'ease', 'switch')),
  prior_live_revision integer not null check (prior_live_revision > 0),
  resulting_live_revision integer not null check (resulting_live_revision = prior_live_revision + 1),
  live_plan_change text not null check (length(trim(live_plan_change)) > 0),
  validation_result jsonb not null check (jsonb_typeof(validation_result) = 'object'),
  live_plan_integrity_hash text not null check (length(trim(live_plan_integrity_hash)) >= 16),
  created_at timestamptz not null default now(),
  unique (goal_id, resulting_live_revision)
);

create index if not exists future_you_progress_updates_goal_occurred_idx on public.future_you_progress_updates(goal_id, occurred_at desc);
create index if not exists future_you_adjustment_decisions_goal_created_idx on public.future_you_adjustment_decisions(goal_id, created_at desc);

alter table public.future_you_progress_updates enable row level security;
alter table public.future_you_adjustment_decisions enable row level security;
grant select, insert on public.future_you_progress_updates to service_role;
grant select, insert on public.future_you_adjustment_decisions to service_role;

drop trigger if exists future_you_progress_updates_append_only on public.future_you_progress_updates;
create trigger future_you_progress_updates_append_only before update or delete on public.future_you_progress_updates
for each row execute function public.future_you_forbid_mutation();

drop trigger if exists future_you_adjustment_decisions_append_only on public.future_you_adjustment_decisions;
create trigger future_you_adjustment_decisions_append_only before update or delete on public.future_you_adjustment_decisions
for each row execute function public.future_you_forbid_mutation();

create or replace function public.future_you_record_locked_progress_update(
  p_user_id uuid, p_goal_id uuid, p_client_update_id uuid, p_expected_live_revision integer,
  p_today_step jsonb, p_visible_choices jsonb, p_selected_choice jsonb,
  p_normalized_state text, p_reason_category text, p_reason_code text,
  p_variables jsonb, p_optional_note text, p_occurred_at timestamptz,
  p_correction_of_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $future_you_record_update$
declare
  v_existing record;
  v_evidence_id uuid;
  v_update_id uuid;
  v_live_revision integer;
  v_correction_evidence_id uuid;
begin
  select id,goal_id,canonical_evidence_id into v_existing from public.future_you_progress_updates
    where user_id=p_user_id and client_update_id=p_client_update_id;
  if found then
    if v_existing.goal_id <> p_goal_id then raise exception 'future_you_client_update_id_conflict'; end if;
    return jsonb_build_object('progress_update_id',v_existing.id,'evidence_id',v_existing.canonical_evidence_id,'idempotent_replay',true);
  end if;
  if jsonb_typeof(p_today_step) <> 'object' or jsonb_typeof(p_visible_choices) <> 'array' or jsonb_typeof(p_selected_choice) <> 'object'
    or jsonb_typeof(p_variables) <> 'array' then raise exception 'future_you_progress_update_payload_invalid'; end if;
  if p_normalized_state not in ('completed','partly_completed','not_today')
    or (p_normalized_state <> 'completed' and p_reason_category is null)
    or (p_reason_category is not null and p_reason_category not in ('time','capacity','access','emotion','external_difficulty'))
    or coalesce(length(trim(p_reason_code)),0)=0 then raise exception 'future_you_progress_update_payload_invalid'; end if;
  if not exists (select 1 from public.original_action_plans where goal_id=p_goal_id and user_id=p_user_id and schema_version='locked-v1') then
    raise exception 'future_you_locked_plan_not_found';
  end if;
  select revision into v_live_revision from public.live_action_plans where goal_id=p_goal_id and user_id=p_user_id;
  if v_live_revision is null then raise exception 'future_you_live_plan_not_found'; end if;
  if v_live_revision <> p_expected_live_revision then raise exception 'future_you_live_plan_stale'; end if;
  if p_correction_of_id is not null then
    select canonical_evidence_id into v_correction_evidence_id from public.future_you_progress_updates
      where id=p_correction_of_id and goal_id=p_goal_id and user_id=p_user_id;
    if v_correction_evidence_id is null then raise exception 'future_you_progress_update_correction_not_found'; end if;
  end if;

  insert into public.canonical_evidence(goal_id,user_id,source_kind,evidence_content,quality,context,occurred_at,correction_of_id)
  values(p_goal_id,p_user_id,'progress_update',jsonb_build_object(
    'visibleChoice',p_selected_choice,'normalizedState',p_normalized_state,
    'reasonCategory',p_reason_category,'reasonCode',p_reason_code,'variables',p_variables,'optionalNote',p_optional_note
  ),jsonb_build_object('kind','direct_user_report'),jsonb_build_object('todayStep',p_today_step,'livePlanRevision',p_expected_live_revision),p_occurred_at,v_correction_evidence_id)
  returning id into v_evidence_id;

  insert into public.future_you_progress_updates(
    client_update_id,goal_id,user_id,live_plan_revision,today_step,visible_choices,selected_choice,
    normalized_state,reason_category,reason_code,variables,optional_note,canonical_evidence_id,correction_of_id,occurred_at
  ) values(
    p_client_update_id,p_goal_id,p_user_id,p_expected_live_revision,p_today_step,p_visible_choices,p_selected_choice,
    p_normalized_state,p_reason_category,p_reason_code,p_variables,p_optional_note,v_evidence_id,p_correction_of_id,p_occurred_at
  ) returning id into v_update_id;
  return jsonb_build_object('progress_update_id',v_update_id,'evidence_id',v_evidence_id,'idempotent_replay',false);
end;
$future_you_record_update$;

revoke all on function public.future_you_record_locked_progress_update(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,text,text,text,jsonb,text,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.future_you_record_locked_progress_update(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,text,text,text,jsonb,text,timestamptz,uuid) to service_role;

create or replace function public.future_you_revise_locked_live_plan_v2(
  p_user_id uuid, p_goal_id uuid, p_progress_update_id uuid, p_assessment_id uuid,
  p_expected_revision integer, p_plan jsonb, p_integrity_hash text, p_completed_checksum text,
  p_live_plan_change text, p_validation_result jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $future_you_revise_plan_v2$
declare
  v_live record;
  v_update record;
  v_assessment record;
  v_outcome text;
  v_decision_id uuid;
begin
  if jsonb_typeof(p_plan) <> 'object' or jsonb_typeof(p_validation_result) <> 'object'
    or coalesce(length(trim(p_integrity_hash)),0)<16 or coalesce(length(trim(p_completed_checksum)),0)<16
    or coalesce(length(trim(p_live_plan_change)),0)=0 then raise exception 'future_you_plan_payload_invalid'; end if;
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
  return jsonb_build_object('decision_id',v_decision_id,'live_plan_id',v_live.id,'revision',v_live.revision+1,'outcome',v_outcome);
end;
$future_you_revise_plan_v2$;

revoke all on function public.future_you_revise_locked_live_plan_v2(uuid,uuid,uuid,uuid,integer,jsonb,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.future_you_revise_locked_live_plan_v2(uuid,uuid,uuid,uuid,integer,jsonb,text,text,text,jsonb) to service_role;

-- Retire the earlier evidence-only revision path now that the adjustment
-- contract requires a saved Progress Update and applied L3 assessment.
revoke execute on function public.future_you_revise_locked_live_plan(uuid,uuid,uuid,integer,jsonb,text) from service_role;
