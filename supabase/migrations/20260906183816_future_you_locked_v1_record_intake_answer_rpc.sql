create or replace function public.future_you_record_locked_intake_answer(
  p_user_id uuid, p_intake_instance_id uuid, p_information_key text, p_raw_value jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event_id uuid; v_next jsonb; v_current jsonb;
begin
  select next_information_target into v_current from public.intake_instances
  where id = p_intake_instance_id and user_id = p_user_id and status = 'collecting' for update;
  if not found then raise exception 'future_you_intake_not_available'; end if;
  if v_current ->> 'key' <> p_information_key then raise exception 'future_you_answer_not_for_current_target'; end if;
  if jsonb_typeof(p_raw_value) <> 'object' then raise exception 'future_you_answer_object_required'; end if;
  insert into public.intake_events (intake_instance_id,user_id,event_kind,information_key,raw_value,source_kind)
  values (p_intake_instance_id,p_user_id,'answer',p_information_key,p_raw_value,'intake') returning id into v_event_id;
  insert into public.intake_facts (intake_instance_id,user_id,fact_key,fact_value,status,stability,current_event_id,provenance)
  values (p_intake_instance_id,p_user_id,p_information_key,p_raw_value,'known','adaptive',v_event_id,jsonb_build_array(v_event_id))
  on conflict (intake_instance_id,fact_key) do update set fact_value=excluded.fact_value,status='known',current_event_id=excluded.current_event_id,provenance=public.intake_facts.provenance || jsonb_build_array(v_event_id),updated_at=now();
  update public.intake_requirements set resolution='satisfied', updated_at=now()
  where intake_instance_id=p_intake_instance_id and requirement_key=p_information_key and applicability='active';
  select target into v_next from public.intake_requirements where intake_instance_id=p_intake_instance_id and applicability='active' and resolution='missing' and priority='essential_now' order by id limit 1;
  update public.intake_instances set next_information_target=v_next, status=case when v_next is null then 'deriving' else 'collecting' end, updated_at=now() where id=p_intake_instance_id;
  return jsonb_build_object('event_id',v_event_id,'next_target',v_next,'status',case when v_next is null then 'deriving' else 'collecting' end);
end; $$;
revoke all on function public.future_you_record_locked_intake_answer(uuid,uuid,text,jsonb) from anon, authenticated, public;
grant execute on function public.future_you_record_locked_intake_answer(uuid,uuid,text,jsonb) to service_role;
