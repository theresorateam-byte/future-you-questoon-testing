-- Match the protected Edge Function's owner-scoped timeline reads. These are
-- deliberately composite: each matches a goal + user filter and its existing
-- recency ordering rather than adding broad single-column indexes.
create index if not exists canonical_evidence_goal_user_recorded_idx
  on public.canonical_evidence (goal_id, user_id, recorded_at desc);
create index if not exists evidence_applications_goal_user_created_idx
  on public.evidence_applications (goal_id, user_id, created_at desc);
create index if not exists progression_l3_assessments_goal_user_created_idx
  on public.progression_l3_assessments (goal_id, user_id, created_at desc);
create index if not exists future_you_progress_updates_goal_user_occurred_idx
  on public.future_you_progress_updates (goal_id, user_id, occurred_at desc);
create index if not exists future_you_adjustment_decisions_goal_user_created_idx
  on public.future_you_adjustment_decisions (goal_id, user_id, created_at desc);
create index if not exists intake_instances_goal_user_created_idx
  on public.intake_instances (goal_id, user_id, created_at desc);
create index if not exists change_path_links_goal_user_created_idx
  on public.change_path_links (goal_id, user_id, created_at desc);
create index if not exists intake_uncertainties_instance_user_created_idx
  on public.intake_uncertainties (intake_instance_id, user_id, created_at desc);
