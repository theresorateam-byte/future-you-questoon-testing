-- Every Level 3 interpretation is permanent and evidence-cited. The current
-- state remains a materialized view for the app, while this ledger explains
-- how it changed without rewriting history or directly touching the plan.
create table if not exists public.progression_l3_assessments (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id),
  user_id uuid not null references auth.users(id),
  topic_contract_version_id uuid not null references public.future_you_contract_versions(id),
  assessment jsonb not null check (jsonb_typeof(assessment) = 'object'),
  prior_revision integer not null check (prior_revision > 0),
  resulting_revision integer not null check (resulting_revision > prior_revision),
  created_at timestamptz not null default now()
);
create index if not exists progression_l3_assessments_goal_created_idx on public.progression_l3_assessments(goal_id, created_at desc);
alter table public.progression_l3_assessments enable row level security;

drop trigger if exists progression_l3_assessments_append_only on public.progression_l3_assessments;
create trigger progression_l3_assessments_append_only
before update or delete on public.progression_l3_assessments
for each row execute function public.future_you_forbid_mutation();
