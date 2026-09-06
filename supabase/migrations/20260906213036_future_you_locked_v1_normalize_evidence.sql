create or replace function public.future_you_record_locked_evidence_v2(
  p_user_id uuid, p_goal_id uuid, p_source_kind text, p_content jsonb, p_quality jsonb, p_context jsonb, p_occurred_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_evidence_id uuid;
begin
  if jsonb_typeof(p_content) <> 'object' or jsonb_object_length(p_content)=0 then raise exception 'future_you_evidence_content_required'; end if;
  if jsonb_typeof(p_quality) <> 'object' or jsonb_typeof(p_context) <> 'object' then raise exception 'future_you_evidence_metadata_object_required'; end if;
  if p_source_kind not in ('today_step','progress_update','check_in','backfill','direct_user_evidence') then raise exception 'future_you_evidence_source_invalid'; end if;
  if not exists (select 1 from public.original_action_plans where goal_id=p_goal_id and user_id=p_user_id and schema_version='locked-v1') then raise exception 'future_you_locked_plan_not_found'; end if;
  insert into public.canonical_evidence (goal_id,user_id,source_kind,evidence_content,quality,context,occurred_at)
  values (p_goal_id,p_user_id,p_source_kind,p_content,p_quality,p_context,p_occurred_at) returning id into v_evidence_id;
  return v_evidence_id;
end;
$$;
revoke all on function public.future_you_record_locked_evidence_v2(uuid,uuid,text,jsonb,jsonb,jsonb,timestamptz) from public;
revoke all on function public.future_you_record_locked_evidence_v2(uuid,uuid,text,jsonb,jsonb,jsonb,timestamptz) from anon;
revoke all on function public.future_you_record_locked_evidence_v2(uuid,uuid,text,jsonb,jsonb,jsonb,timestamptz) from authenticated;
grant execute on function public.future_you_record_locked_evidence_v2(uuid,uuid,text,jsonb,jsonb,jsonb,timestamptz) to service_role;
