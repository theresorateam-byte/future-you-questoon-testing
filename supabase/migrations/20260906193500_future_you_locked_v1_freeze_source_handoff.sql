-- Freeze the I3 Source handoff once. The Edge Function validates its shape and
-- fact citations; this RPC makes the resulting snapshot and its provenance
-- atomic and prevents a later caller from overwriting it.
create or replace function public.future_you_freeze_locked_source_handoff(
  p_user_id uuid,
  p_intake_instance_id uuid,
  p_source_handoff jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intake record;
  v_event_id uuid;
  v_blocking_count integer;
begin
  if jsonb_typeof(p_source_handoff) <> 'object' then
    raise exception 'future_you_source_handoff_object_required';
  end if;

  select id, goal_id, status, source_snapshot
    into v_intake
    from public.intake_instances
   where id = p_intake_instance_id
     and user_id = p_user_id
   for update;

  if not found then
    raise exception 'future_you_intake_not_available';
  end if;
  if v_intake.status <> 'deriving' then
    raise exception 'future_you_source_handoff_not_ready';
  end if;
  if v_intake.source_snapshot <> '{}'::jsonb then
    raise exception 'future_you_source_handoff_already_frozen';
  end if;

  select count(*)
    into v_blocking_count
    from public.intake_requirements
   where intake_instance_id = p_intake_instance_id
     and user_id = p_user_id
     and applicability = 'active'
     and priority in ('essential_now', 'conditional')
     and resolution not in ('satisfied', 'provisional', 'not_applicable');
  if v_blocking_count > 0 then
    raise exception 'future_you_source_handoff_has_blockers';
  end if;

  update public.intake_instances
     set source_snapshot = p_source_handoff,
         status = 'validated',
         completed_at = now(),
         updated_at = now()
   where id = p_intake_instance_id
     and user_id = p_user_id;

  insert into public.intake_events (
    intake_instance_id, user_id, event_kind, information_key, raw_value, source_kind
  ) values (
    p_intake_instance_id, p_user_id, 'system_handoff', 'source_handoff', p_source_handoff, 'system'
  ) returning id into v_event_id;

  insert into public.canonical_evidence (
    goal_id, user_id, source_kind, source_record_id, evidence_content, quality, context
  ) values (
    v_intake.goal_id, p_user_id, 'intake', v_event_id,
    jsonb_build_object('kind', 'source_handoff', 'snapshot', p_source_handoff),
    jsonb_build_object('validation', 'edge_validated'),
    jsonb_build_object('intake_instance_id', p_intake_instance_id)
  );

  return jsonb_build_object(
    'intake_instance_id', p_intake_instance_id,
    'goal_id', v_intake.goal_id,
    'status', 'validated',
    'handoff_event_id', v_event_id
  );
end;
$$;

revoke all on function public.future_you_freeze_locked_source_handoff(uuid, uuid, jsonb) from public;
revoke all on function public.future_you_freeze_locked_source_handoff(uuid, uuid, jsonb) from anon;
revoke all on function public.future_you_freeze_locked_source_handoff(uuid, uuid, jsonb) from authenticated;
grant execute on function public.future_you_freeze_locked_source_handoff(uuid, uuid, jsonb) to service_role;
