-- Goal intent is already captured in the immutable goal-statement event. Do not
-- re-ask it as the next interaction; request the distinct I1 intended direction.
create or replace function public.future_you_refine_initial_intake_target()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.intake_kind = 'initial'
    and new.status = 'collecting'
    and new.next_information_target ->> 'key' = 'goal_meaning' then
    new.next_information_target := jsonb_build_object(
      'key', 'i1_a2_desired_direction',
      'type', 'user_input',
      'reason', 'The goal statement establishes intent. Confirm the direction and outcome the user wants before route or readiness decisions.'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists future_you_refine_initial_intake_target_before_insert on public.intake_instances;
create trigger future_you_refine_initial_intake_target_before_insert
before insert on public.intake_instances
for each row execute function public.future_you_refine_initial_intake_target();
