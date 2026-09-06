-- An approved Locked v1 plan begins as both the immutable Original Plan and
-- the current Live Plan. Later Live revisions are a separate, evidence-led
-- operation; they must never rewrite the Original Plan.
create or replace function public.future_you_approve_locked_initial_plan(
  p_user_id uuid,
  p_intake_instance_id uuid,
  p_plan jsonb,
  p_integrity_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intake record;
  v_original_id uuid;
  v_live_id uuid;
begin
  if jsonb_typeof(p_plan) <> 'object' or coalesce(length(trim(p_integrity_hash)), 0) < 16 then
    raise exception 'future_you_plan_payload_invalid';
  end if;
  select id, goal_id, status, source_snapshot into v_intake
    from public.intake_instances
   where id = p_intake_instance_id and user_id = p_user_id
   for update;
  if not found then raise exception 'future_you_intake_not_available'; end if;
  if v_intake.status <> 'validated' or v_intake.source_snapshot = '{}'::jsonb then
    raise exception 'future_you_initial_plan_not_ready';
  end if;
  if exists (select 1 from public.original_action_plans where goal_id = v_intake.goal_id) then
    raise exception 'future_you_original_plan_already_exists';
  end if;

  insert into public.original_action_plans (
    goal_id, user_id, plan, schema_version, prompt_version, engine_version, integrity_hash
  ) values (
    v_intake.goal_id, p_user_id, p_plan, 'locked-v1', 'source-derived-v1', 'future-you-locked-v1', p_integrity_hash
  ) returning id into v_original_id;

  insert into public.live_action_plans (
    goal_id, user_id, plan, revision, completed_checksum, source_event_id
  ) values (
    v_intake.goal_id, p_user_id, p_plan, 1, p_integrity_hash, null
  ) returning id into v_live_id;

  insert into public.progression_l3_states (
    goal_id, user_id, state, state_confidence, roles, unresolved, next_evidence_target, audit_status, revision
  ) values (
    v_intake.goal_id, p_user_id,
    coalesce(v_intake.source_snapshot->'l3InitialState', '{}'::jsonb),
    jsonb_build_object('source', 'frozen_i3', 'confidence', v_intake.source_snapshot #>> '{l3InitialState,confidence}'),
    jsonb_build_object('initial_mode', v_intake.source_snapshot->'initialMode'),
    '[]'::jsonb, null, jsonb_build_object('status', 'initial'), 1
  ) on conflict (goal_id) do nothing;

  return jsonb_build_object('goal_id', v_intake.goal_id, 'original_plan_id', v_original_id, 'live_plan_id', v_live_id, 'live_revision', 1);
end;
$$;

revoke all on function public.future_you_approve_locked_initial_plan(uuid, uuid, jsonb, text) from public;
revoke all on function public.future_you_approve_locked_initial_plan(uuid, uuid, jsonb, text) from anon;
revoke all on function public.future_you_approve_locked_initial_plan(uuid, uuid, jsonb, text) from authenticated;
grant execute on function public.future_you_approve_locked_initial_plan(uuid, uuid, jsonb, text) to service_role;
