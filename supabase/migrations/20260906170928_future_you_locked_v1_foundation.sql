-- Future You Locked v1 foundation.
-- This migration adds the new architecture beside the existing simulator.
-- It intentionally does not alter the old intake, plan, progress, or batch tables.

create table if not exists public.future_you_contract_versions (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in (
    'action_plan_master', 'intake_source', 'i1', 'i2', 'i3',
    'level_1', 'level_2', 'topic', 'routing'
  )),
  contract_key text not null,
  version text not null,
  status text not null default 'draft' check (status in ('draft', 'locked', 'retired')),
  manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest) = 'object'),
  source_url text,
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  retired_at timestamptz,
  unique (scope, contract_key, version)
);

create table if not exists public.goal_contract_bindings (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id),
  user_id uuid not null references auth.users(id),
  contract_version_id uuid not null references public.future_you_contract_versions(id),
  binding_role text not null check (binding_role in (
    'action_plan_master', 'intake_source', 'i1', 'i2', 'i3',
    'level_1', 'level_2', 'topic', 'routing'
  )),
  bound_at timestamptz not null default now(),
  unique (goal_id, contract_version_id, binding_role)
);

create table if not exists public.intake_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  goal_id uuid not null references public.goals(id),
  parent_intake_instance_id uuid references public.intake_instances(id),
  intake_kind text not null check (intake_kind in ('initial', 'change_path', 'reentry')),
  status text not null default 'collecting' check (status in (
    'collecting', 'ready', 'deriving', 'validated', 'approved',
    'prepare', 'stopped', 'abandoned', 'superseded'
  )),
  readiness jsonb not null default '{}'::jsonb check (jsonb_typeof(readiness) = 'object'),
  next_information_target jsonb,
  source_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(source_snapshot) = 'object'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intake_events (
  id uuid primary key default gen_random_uuid(),
  intake_instance_id uuid not null references public.intake_instances(id),
  user_id uuid not null references auth.users(id),
  event_kind text not null check (event_kind in (
    'goal_statement', 'answer', 'imported_profile', 'imported_history',
    'correction', 'requirement_reopened', 'system_handoff'
  )),
  information_key text not null,
  raw_value jsonb not null default '{}'::jsonb,
  source_kind text not null check (source_kind in (
    'goal', 'intake', 'profile', 'history', 'prior_future_you', 'system'
  )),
  supersedes_event_id uuid references public.intake_events(id),
  captured_at timestamptz not null default now()
);

create table if not exists public.intake_facts (
  id uuid primary key default gen_random_uuid(),
  intake_instance_id uuid not null references public.intake_instances(id),
  user_id uuid not null references auth.users(id),
  fact_key text not null,
  fact_value jsonb not null default '{}'::jsonb,
  status text not null check (status in (
    'known', 'partial', 'missing', 'contradictory', 'stale', 'not_applicable'
  )),
  stability text not null check (stability in ('stable', 'adaptive')),
  current_event_id uuid references public.intake_events(id),
  provenance jsonb not null default '[]'::jsonb check (jsonb_typeof(provenance) = 'array'),
  updated_at timestamptz not null default now(),
  unique (intake_instance_id, fact_key)
);

create table if not exists public.intake_requirements (
  id uuid primary key default gen_random_uuid(),
  intake_instance_id uuid not null references public.intake_instances(id),
  user_id uuid not null references auth.users(id),
  requirement_key text not null,
  priority text not null check (priority in (
    'essential_now', 'conditional', 'optional_optimization', 'learn_later'
  )),
  applicability text not null check (applicability in ('active', 'inactive', 'not_applicable')),
  resolution text not null check (resolution in (
    'satisfied', 'partial', 'missing', 'contradictory', 'provisional', 'not_applicable'
  )),
  activation_reason text,
  supporting_fact_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(supporting_fact_ids) = 'array'),
  updated_at timestamptz not null default now(),
  unique (intake_instance_id, requirement_key)
);

create table if not exists public.intake_uncertainties (
  id uuid primary key default gen_random_uuid(),
  intake_instance_id uuid not null references public.intake_instances(id),
  user_id uuid not null references auth.users(id),
  uncertainty_key text not null,
  uncertainty_kind text not null check (uncertainty_kind in ('contradiction', 'staleness', 'insufficient_information', 'causal_uncertainty')),
  status text not null default 'open' check (status in ('open', 'resolved', 'accepted_provisional')),
  related_event_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(related_event_ids) = 'array'),
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.route_candidate_evidence (
  id uuid primary key default gen_random_uuid(),
  intake_instance_id uuid not null references public.intake_instances(id),
  user_id uuid not null references auth.users(id),
  candidate_topic_key text not null,
  candidate_role text not null check (candidate_role in ('primary', 'secondary', 'tertiary', 'monitor')),
  evidence_event_id uuid references public.intake_events(id),
  rationale text not null,
  status text not null default 'candidate' check (status in ('candidate', 'selected', 'rejected', 'preserved_secondary')),
  created_at timestamptz not null default now()
);

create table if not exists public.canonical_evidence (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id),
  user_id uuid not null references auth.users(id),
  source_kind text not null check (source_kind in (
    'intake', 'today_step', 'progress_update', 'check_in', 'backfill', 'profile', 'history', 'direct_user_evidence'
  )),
  source_record_id uuid,
  evidence_content jsonb not null check (jsonb_typeof(evidence_content) = 'object'),
  quality jsonb not null default '{}'::jsonb check (jsonb_typeof(quality) = 'object'),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  occurred_at timestamptz,
  recorded_at timestamptz not null default now(),
  correction_of_id uuid references public.canonical_evidence(id)
);

create table if not exists public.evidence_applications (
  id uuid primary key default gen_random_uuid(),
  canonical_evidence_id uuid not null references public.canonical_evidence(id),
  goal_id uuid not null references public.goals(id),
  user_id uuid not null references auth.users(id),
  target_scope text not null check (target_scope in ('level_1', 'topic', 'routing', 'level_3', 'action_plan')),
  target_key text not null,
  application_type text not null check (application_type in ('supports', 'limits', 'contradicts', 'requires_follow_up')),
  rationale text not null,
  created_at timestamptz not null default now(),
  unique (canonical_evidence_id, target_scope, target_key, application_type)
);

create table if not exists public.progression_l3_states (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null unique references public.goals(id),
  user_id uuid not null references auth.users(id),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  state_confidence jsonb not null default '{}'::jsonb check (jsonb_typeof(state_confidence) = 'object'),
  roles jsonb not null default '{}'::jsonb check (jsonb_typeof(roles) = 'object'),
  unresolved jsonb not null default '[]'::jsonb check (jsonb_typeof(unresolved) = 'array'),
  next_evidence_target jsonb,
  audit_status jsonb not null default '{}'::jsonb check (jsonb_typeof(audit_status) = 'object'),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.change_path_links (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id),
  user_id uuid not null references auth.users(id),
  prior_intake_instance_id uuid references public.intake_instances(id),
  reentry_intake_instance_id uuid not null unique references public.intake_instances(id),
  requested_change jsonb not null default '{}'::jsonb check (jsonb_typeof(requested_change) = 'object'),
  status text not null default 'open' check (status in ('open', 'validated', 'committed', 'abandoned', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists intake_instances_goal_created_idx on public.intake_instances(goal_id, created_at desc);
create index if not exists intake_events_instance_captured_idx on public.intake_events(intake_instance_id, captured_at);
create index if not exists canonical_evidence_goal_recorded_idx on public.canonical_evidence(goal_id, recorded_at);
create index if not exists evidence_applications_goal_target_idx on public.evidence_applications(goal_id, target_scope, target_key);
create index if not exists goal_contract_bindings_goal_idx on public.goal_contract_bindings(goal_id);

create or replace function public.future_you_forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'future_you_append_only_record';
end;
$$;

drop trigger if exists intake_events_append_only on public.intake_events;
create trigger intake_events_append_only
before update or delete on public.intake_events
for each row execute function public.future_you_forbid_mutation();

drop trigger if exists canonical_evidence_append_only on public.canonical_evidence;
create trigger canonical_evidence_append_only
before update or delete on public.canonical_evidence
for each row execute function public.future_you_forbid_mutation();

drop trigger if exists evidence_applications_append_only on public.evidence_applications;
create trigger evidence_applications_append_only
before update or delete on public.evidence_applications
for each row execute function public.future_you_forbid_mutation();

drop trigger if exists goal_contract_bindings_append_only on public.goal_contract_bindings;
create trigger goal_contract_bindings_append_only
before update or delete on public.goal_contract_bindings
for each row execute function public.future_you_forbid_mutation();

alter table public.future_you_contract_versions enable row level security;
alter table public.goal_contract_bindings enable row level security;
alter table public.intake_instances enable row level security;
alter table public.intake_events enable row level security;
alter table public.intake_facts enable row level security;
alter table public.intake_requirements enable row level security;
alter table public.intake_uncertainties enable row level security;
alter table public.route_candidate_evidence enable row level security;
alter table public.canonical_evidence enable row level security;
alter table public.evidence_applications enable row level security;
alter table public.progression_l3_states enable row level security;
alter table public.change_path_links enable row level security;

-- The simulator currently writes through authenticated Edge Functions, not direct client table writes.
-- RLS therefore starts closed. Read/write policies will be added only with the consumer/API surface that needs them.
