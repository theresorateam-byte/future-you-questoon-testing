alter table public.intake_requirements
  add column if not exists target jsonb not null default '{}'::jsonb
  check (jsonb_typeof(target) = 'object');

create or replace function public.future_you_seed_locked_requirements(
  p_user_id uuid,
  p_intake_instance_id uuid,
  p_requirements jsonb
)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_inserted integer;
begin
  if jsonb_typeof(p_requirements) <> 'array' then raise exception 'future_you_requirements_array_required'; end if;
  if not exists (select 1 from public.intake_instances where id = p_intake_instance_id and user_id = p_user_id and status = 'collecting') then raise exception 'future_you_intake_not_available'; end if;
  insert into public.intake_requirements (intake_instance_id, user_id, requirement_key, priority, applicability, resolution, activation_reason, target)
  select p_intake_instance_id, p_user_id, r.requirement_key, r.priority, 'active', 'missing', concat('Locked I2 requirement; decision area: ', r.decision_area), coalesce(r.target, '{}'::jsonb)
  from jsonb_to_recordset(p_requirements) as r(requirement_key text, priority text, decision_area text, target jsonb)
  where r.requirement_key is not null and r.priority in ('essential_now', 'conditional', 'optional_optimization', 'learn_later')
  on conflict (intake_instance_id, requirement_key) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.future_you_seed_locked_requirements(uuid, uuid, jsonb) from anon, authenticated, public;
grant execute on function public.future_you_seed_locked_requirements(uuid, uuid, jsonb) to service_role;
