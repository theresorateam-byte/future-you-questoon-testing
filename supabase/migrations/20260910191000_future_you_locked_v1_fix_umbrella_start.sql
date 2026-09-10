-- An umbrella entry deliberately starts without a resolved internal topic.
-- Keep the optional topic binding in a scalar so PostgreSQL never dereferences
-- the unassigned record used by the direct-topic branch.
create or replace function public.future_you_start_locked_intake(
  p_user_id uuid,
  p_goal_text text,
  p_topic_key text default null
)
returns table (goal_id uuid, intake_instance_id uuid, next_information_target jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal_id uuid;
  v_intake_instance_id uuid;
  v_goal_event_id uuid;
  v_topic record;
  v_topic_id uuid;
  v_contract record;
  v_required_scope_count integer;
  v_target jsonb := jsonb_build_object('key', 'goal_meaning', 'type', 'user_input', 'reason', 'Establish the specific change the user wants before selecting or validating a route.');
begin
  if p_user_id is null then raise exception 'future_you_user_required'; end if;
  p_goal_text := btrim(coalesce(p_goal_text, ''));
  if char_length(p_goal_text) < 3 or char_length(p_goal_text) > 1000 then raise exception 'future_you_goal_text_invalid'; end if;

  select count(*) into v_required_scope_count from public.future_you_contract_versions
    where status = 'locked' and scope in ('action_plan_master', 'intake_source', 'i1', 'i2', 'i3', 'level_1', 'level_2', 'level_3');
  if v_required_scope_count <> 8 then raise exception 'future_you_required_contracts_unavailable'; end if;

  if nullif(btrim(coalesce(p_topic_key, '')), '') is not null then
    select * into v_topic from public.future_you_contract_versions
      where scope = 'topic' and contract_key = btrim(p_topic_key) and status = 'locked' limit 1;
    if not found then raise exception 'future_you_topic_not_found'; end if;
    if coalesce((v_topic.manifest ->> 'user_facing_entry')::boolean, false) is false then raise exception 'future_you_topic_not_available_for_direct_start'; end if;
    v_topic_id := v_topic.id;
  end if;

  insert into public.goals (user_id, goal_text, state) values (p_user_id, p_goal_text, 'draft') returning id into v_goal_id;
  insert into public.intake_instances (user_id, goal_id, intake_kind, status, readiness, next_information_target, source_snapshot)
    values (p_user_id, v_goal_id, 'initial', 'collecting', jsonb_build_object('status', 'not_assessed'), v_target,
      jsonb_build_object('engine_version', 'future-you-locked-v1', 'selected_topic_key', nullif(btrim(coalesce(p_topic_key, '')), '')))
    returning id into v_intake_instance_id;
  insert into public.intake_events (intake_instance_id, user_id, event_kind, information_key, raw_value, source_kind)
    values (v_intake_instance_id, p_user_id, 'goal_statement', 'goal_statement', jsonb_build_object('text', p_goal_text), 'goal') returning id into v_goal_event_id;
  insert into public.intake_facts (intake_instance_id, user_id, fact_key, fact_value, status, stability, current_event_id, provenance)
    values (v_intake_instance_id, p_user_id, 'goal_statement', jsonb_build_object('text', p_goal_text), 'known', 'adaptive', v_goal_event_id, jsonb_build_array(v_goal_event_id));

  for v_contract in
    select id, scope from public.future_you_contract_versions where status = 'locked'
      and scope in ('action_plan_master', 'intake_source', 'i1', 'i2', 'i3', 'level_1', 'level_2', 'level_3')
    union all
    select id, scope from public.future_you_contract_versions where id = v_topic_id
  loop
    insert into public.goal_contract_bindings (goal_id, user_id, contract_version_id, binding_role)
      values (v_goal_id, p_user_id, v_contract.id, v_contract.scope) on conflict do nothing;
  end loop;
  return query select v_goal_id, v_intake_instance_id, v_target;
end;
$$;

revoke all on function public.future_you_start_locked_intake(uuid, text, text) from public;
grant execute on function public.future_you_start_locked_intake(uuid, text, text) to service_role;
