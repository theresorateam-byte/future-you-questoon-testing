-- Level 3 is a required locked contract and must be bindable to each goal.
-- This extends the existing closed vocabulary; it does not grant API access.
alter table public.goal_contract_bindings
  drop constraint goal_contract_bindings_binding_role_check;

alter table public.goal_contract_bindings
  add constraint goal_contract_bindings_binding_role_check
  check (binding_role = any (array[
    'action_plan_master',
    'intake_source',
    'i1',
    'i2',
    'i3',
    'level_1',
    'level_2',
    'level_3',
    'topic',
    'routing'
  ]));
