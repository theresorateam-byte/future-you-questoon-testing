create or replace function public.future_you_record_locked_evidence(
  p_user_id uuid, p_goal_id uuid, p_source_kind text, p_content jsonb, p_occurred_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_evidence_id uuid;
begin
  if jsonb_typeof(p_content) <> 'object' then raise exception 'future_you_evidence_object_required'; end if;
  if p_source_kind not in ('today_step','progress_update','check_in','backfill','direct_user_evidence') then
    raise exception 'future_you_evidence_source_invalid';
  end if;
  if not exists (select 1 from public.original_action_plans where goal_id=p_goal_id and user_id=p_user_id and schema_version='locked-v1') then
    raise exception 'future_you_locked_plan_not_found';
  end if;
  insert into public.canonical_evidence (goal_id,user_id,source_kind,evidence_content,quality,context,occurred_at)
  values (p_goal_id,p_user_id,p_source_kind,p_content,jsonb_build_object('recorded_by','user'),jsonb_build_object('contract','locked-v1'),p_occurred_at)
  returning id into v_evidence_id;
  return v_evidence_id;
end;
$$;
revoke all on function public.future_you_record_locked_evidence(uuid,uuid,text,jsonb,timestamptz) from public;
revoke all on function public.future_you_record_locked_evidence(uuid,uuid,text,jsonb,timestamptz) from anon;
revoke all on function public.future_you_record_locked_evidence(uuid,uuid,text,jsonb,timestamptz) from authenticated;
grant execute on function public.future_you_record_locked_evidence(uuid,uuid,text,jsonb,timestamptz) to service_role;
