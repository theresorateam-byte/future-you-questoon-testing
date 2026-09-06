/**
 * Locked I2 requirements by approved topic. These are internal information
 * targets, not user-facing questions. The selector uses only requirements that
 * are activated for the current person's route and context.
 */
export type TopicRequirementSeed = {
  key: string;
  priority: "essential_now" | "conditional" | "optional_optimization" | "learn_later";
  decisionArea: "direction" | "reality" | "safety" | "feasibility" | "capacity" | "routing";
};

const essential = (key: string, decisionArea: TopicRequirementSeed["decisionArea"]): TopicRequirementSeed => ({ key, decisionArea, priority: "essential_now" });

export const TOPIC_REQUIREMENT_SEEDS: Record<string, TopicRequirementSeed[]> = {
  build_stronger_relationships: [
    essential("relationship_context", "reality"), essential("desired_direction", "direction"), essential("current_relationship_pattern", "reality"), essential("relationship_dimension", "routing"), essential("agency_and_other_autonomy", "routing"), essential("relationship_safety_viability", "safety"), essential("relationship_opportunity", "feasibility"),
  ],
  communicate_better: [
    essential("communication_context", "reality"), essential("desired_communication_result", "direction"), essential("communication_pattern", "reality"), essential("communication_dimension", "routing"), essential("communication_appropriateness", "routing"), essential("agency_and_other_response", "routing"), essential("communication_safety_power", "safety"), essential("communication_opportunity", "feasibility"),
  ],
  set_better_boundaries: [
    essential("boundary_context", "reality"), essential("boundary_need_or_limit", "direction"), essential("current_boundary_line", "reality"), essential("boundary_breakdown_location", "routing"), essential("boundary_control_test", "routing"), essential("boundary_safety_power", "safety"), essential("external_requirement", "feasibility"), essential("boundary_feasibility_capacity", "capacity"),
  ],
  become_more_confident: [
    essential("confidence_context", "reality"), essential("desired_confident_behavior", "direction"), essential("confidence_pattern", "reality"), essential("skill_preparation_status", "feasibility"), essential("confidence_opportunity", "feasibility"), essential("confidence_or_self_trust_route", "routing"), essential("confidence_stakes", "reality"), essential("confidence_safety_power", "safety"),
  ],
  build_self_trust: [
    essential("decision_context", "reality"), essential("decision_authority", "routing"), essential("knowable_information_and_expertise", "feasibility"), essential("decision_stakes_reversibility", "reality"), essential("feasible_options_capacity", "capacity"), essential("pressure_source", "routing"), essential("self_trust_breakdown", "routing"), essential("outside_input_role", "routing"),
  ],
  manage_my_time_better: [
    essential("time_problem_context", "reality"), essential("available_time_capacity", "capacity"), essential("fixed_commitments", "feasibility"), essential("workload_scope", "capacity"), essential("time_breakdown", "routing"), essential("time_opportunity", "feasibility"), essential("time_or_procrastination_route", "routing"), essential("time_reality_constraints", "feasibility"),
  ],
  stop_putting_things_off: [
    essential("intended_action", "direction"), essential("genuine_intention", "reality"), essential("realistic_opportunity", "feasibility"), essential("opportunity_behavior", "reality"), essential("postponement_reasonableness", "routing"), essential("blocker_family", "routing"), essential("delay_impact", "reality"), essential("procrastination_first_target", "routing"),
  ],
  get_my_home_organized: [
    essential("home_context", "reality"), essential("home_desired_function", "direction"), essential("home_current_friction", "reality"), essential("home_dimension", "routing"), essential("home_current_setup", "reality"), essential("shared_household_control", "routing"), essential("housing_access_constraints", "feasibility"), essential("home_maintenance_capacity", "capacity"), essential("home_cross_goal_route", "routing"), essential("home_safety_reality", "safety"),
  ],
  build_routines_that_work: [
    essential("routine_target", "direction"), essential("routine_function", "direction"), essential("routine_dose_window", "feasibility"), essential("routine_current_pattern", "reality"), essential("routine_time_energy_access_fit", "capacity"), essential("routine_cue_structure", "reality"), essential("routine_after_disruption", "reality"), essential("routine_dimension", "routing"), essential("routine_cross_goal_route", "routing"), essential("routine_safety_reality", "safety"),
  ],
  feel_more_like_myself: [
    essential("valued_self_qualities", "direction"), essential("current_disconnection", "reality"), essential("disconnection_context_breadth", "reality"), essential("disconnection_pattern", "reality"), essential("state_or_identity_route", "routing"), essential("other_goal_dominant_route", "routing"), essential("self_directed_capacity", "capacity"), essential("identity_safety_gate", "safety"),
  ],
};

export function requirementsForTopic(topicKey: string) {
  return TOPIC_REQUIREMENT_SEEDS[topicKey] ?? [];
}
