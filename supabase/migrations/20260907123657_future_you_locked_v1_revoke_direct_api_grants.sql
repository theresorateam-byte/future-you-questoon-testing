-- Future You is deliberately a server-controlled workflow. Browser clients
-- invoke the authenticated Edge Function; they do not read or mutate these
-- sensitive ledgers through the Data API. Keep service_role access intact for
-- that protected backend while closing inherited API-role grants.
revoke all privileges on table
  public.intake_instances,
  public.intake_facts,
  public.intake_requirements,
  public.intake_uncertainties,
  public.intake_events,
  public.route_candidate_evidence,
  public.change_path_links,
  public.original_action_plans,
  public.live_action_plans,
  public.canonical_evidence,
  public.evidence_applications,
  public.progression_l3_states,
  public.progression_l3_assessments,
  public.future_you_progress_updates,
  public.future_you_adjustment_decisions,
  public.goal_contract_bindings
from anon, authenticated;
