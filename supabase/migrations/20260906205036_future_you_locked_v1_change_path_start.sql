-- A Change Path never replaces the original intake or Original Plan. It opens
-- a linked re-entry intake with the requested change recorded as an event.
create or replace function public.future_you_start_locked_change_path(
  p_user_id uuid, p_goal_id uuid, p_requested_change jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prior_intake_id uuid; v_reentry_id uuid; v_link_id uuid;
begin
  if jsonb_typeof(p_requested_change) <> 'object' then raise exception 'future_you_change_request_object_required'; end if;
  if not exists (select 1 from public.original_action_plans where goal_id=p_goal_id and user_id=p_user_id and schema_version='locked-v1') then raise exception 'future_you_locked_plan_not_found'; end if;
  select id into v_prior_intake_id from public.intake_instances where goal_id=p_goal_id and user_id=p_user_id and status in ('validated','approved') order by created_at desc limit 1;
  if v_prior_intake_id is null then raise exception 'future_you_prior_intake_not_found'; end if;
  insert into public.intake_instances (user_id,goal_id,parent_intake_instance_id,intake_kind,status,readiness,next_information_target)
  values (p_user_id,p_goal_id,v_prior_intake_id,'change_path','collecting',jsonb_build_object('requested_change',p_requested_change),jsonb_build_object('key','change_path_reason','type','user_input','reason','Understand what changed before rewriting future plan content.')) returning id into v_reentry_id;
  insert into public.change_path_links (goal_id,user_id,prior_intake_instance_id,reentry_intake_instance_id,requested_change,status)
  values (p_goal_id,p_user_id,v_prior_intake_id,v_reentry_id,p_requested_change,'open') returning id into v_link_id;
  insert into public.intake_events (intake_instance_id,user_id,event_kind,information_key,raw_value,source_kind)
  values (v_reentry_id,p_user_id,'answer','change_path_reason',p_requested_change,'intake');
  return jsonb_build_object('intake_instance_id',v_reentry_id,'change_path_link_id',v_link_id,'prior_intake_instance_id',v_prior_intake_id);
end;
$$;
revoke all on function public.future_you_start_locked_change_path(uuid,uuid,jsonb) from public;
revoke all on function public.future_you_start_locked_change_path(uuid,uuid,jsonb) from anon;
revoke all on function public.future_you_start_locked_change_path(uuid,uuid,jsonb) from authenticated;
grant execute on function public.future_you_start_locked_change_path(uuid,uuid,jsonb) to service_role;
