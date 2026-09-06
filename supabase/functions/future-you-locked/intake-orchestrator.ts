/**
 * I1 target metadata for the Locked v1 intake orchestrator.
 *
 * These are information needs, not screens or fixed questions. I2 decides
 * which needs apply to a selected topic; I3 records whether each need is
 * already known, needs clarification, is boundedly provisional, or can wait.
 */
export const TARGET_CATALOG_VERSION = "i1-locked-v1.1";

export type RequirementPriority =
  | "essential_now"
  | "conditional"
  | "optional_optimization"
  | "learn_later";

export type RequirementResolution =
  | "satisfied"
  | "partial"
  | "missing"
  | "contradictory"
  | "provisional"
  | "not_applicable";

export type IntakeRequirement = {
  requirement_key: string;
  priority: RequirementPriority;
  applicability: "active" | "inactive" | "not_applicable";
  resolution: RequirementResolution;
};

export type IntakeTarget = {
  key: string;
  factKey: string;
  decisionArea: "direction" | "reality" | "safety" | "feasibility" | "capacity" | "routing";
  sensitivity: "ordinary" | "minimize";
  requiredSpecificity: "brief" | "contextual" | "concrete";
};

export const I1_TARGETS: Record<string, IntakeTarget> = {
  i1_a2_desired_direction: {
    key: "i1_a2_desired_direction",
    factKey: "desired_direction",
    decisionArea: "direction",
    sensitivity: "ordinary",
    requiredSpecificity: "brief",
  },
  i1_a3_current_starting_position: {
    key: "i1_a3_current_starting_position",
    factKey: "current_starting_position",
    decisionArea: "reality",
    sensitivity: "ordinary",
    requiredSpecificity: "concrete",
  },
  i1_a5_relevant_scope_context: {
    key: "i1_a5_relevant_scope_context",
    factKey: "relevant_scope_context",
    decisionArea: "reality",
    sensitivity: "ordinary",
    requiredSpecificity: "contextual",
  },
  i1_a6_timing_cadence_deadline: {
    key: "i1_a6_timing_cadence_deadline",
    factKey: "timing_cadence_deadline",
    decisionArea: "feasibility",
    sensitivity: "ordinary",
    requiredSpecificity: "concrete",
  },
  i1_a8_non_negotiable_conditions: {
    key: "i1_a8_non_negotiable_conditions",
    factKey: "non_negotiable_conditions",
    decisionArea: "feasibility",
    sensitivity: "ordinary",
    requiredSpecificity: "contextual",
  },
  i1_b1_current_pattern: {
    key: "i1_b1_current_pattern",
    factKey: "current_pattern",
    decisionArea: "reality",
    sensitivity: "ordinary",
    requiredSpecificity: "concrete",
  },
  i1_b3_opportunity: {
    key: "i1_b3_opportunity",
    factKey: "opportunity",
    decisionArea: "feasibility",
    sensitivity: "ordinary",
    requiredSpecificity: "contextual",
  },
  i1_b4_constraint_barrier: {
    key: "i1_b4_constraint_barrier",
    factKey: "constraint_barrier",
    decisionArea: "feasibility",
    sensitivity: "ordinary",
    requiredSpecificity: "contextual",
  },
  i1_b5_prerequisite_skill_gap: {
    key: "i1_b5_prerequisite_skill_gap",
    factKey: "prerequisite_skill_gap",
    decisionArea: "feasibility",
    sensitivity: "ordinary",
    requiredSpecificity: "contextual",
  },
  i1_b6_control_agency: {
    key: "i1_b6_control_agency",
    factKey: "control_agency",
    decisionArea: "routing",
    sensitivity: "ordinary",
    requiredSpecificity: "contextual",
  },
  i1_b7_prior_attempts: {
    key: "i1_b7_prior_attempts",
    factKey: "prior_attempts",
    decisionArea: "reality",
    sensitivity: "ordinary",
    requiredSpecificity: "contextual",
  },
  i1_b8_existing_strengths: {
    key: "i1_b8_existing_strengths",
    factKey: "existing_strengths",
    decisionArea: "reality",
    sensitivity: "ordinary",
    requiredSpecificity: "contextual",
  },
  i1_b9_route_discriminator: {
    key: "i1_b9_route_discriminator",
    factKey: "route_discriminator",
    decisionArea: "routing",
    sensitivity: "ordinary",
    requiredSpecificity: "concrete",
  },
  i1_c1_safety_gate_facts: {
    key: "i1_c1_safety_gate_facts",
    factKey: "safety_gate_facts",
    decisionArea: "safety",
    sensitivity: "minimize",
    requiredSpecificity: "brief",
  },
  i1_c2_feasibility_access: {
    key: "i1_c2_feasibility_access",
    factKey: "feasibility_access",
    decisionArea: "feasibility",
    sensitivity: "ordinary",
    requiredSpecificity: "contextual",
  },
  i1_c3_available_time: {
    key: "i1_c3_available_time",
    factKey: "available_time",
    decisionArea: "capacity",
    sensitivity: "ordinary",
    requiredSpecificity: "concrete",
  },
  i1_c4_current_load: {
    key: "i1_c4_current_load",
    factKey: "current_load",
    decisionArea: "capacity",
    sensitivity: "ordinary",
    requiredSpecificity: "contextual",
  },
  i1_c5_capacity: {
    key: "i1_c5_capacity",
    factKey: "current_capacity",
    decisionArea: "capacity",
    sensitivity: "ordinary",
    requiredSpecificity: "contextual",
  },
};

const priorityRank: Record<RequirementPriority, number> = {
  essential_now: 0,
  conditional: 1,
  optional_optimization: 2,
  learn_later: 3,
};

/** Returns one information need, never a question or a screen format. */
export function chooseNextIntakeTarget(requirements: IntakeRequirement[]) {
  const candidates = requirements
    .filter((requirement) => requirement.applicability === "active")
    .filter((requirement) => ["missing", "partial", "contradictory"].includes(requirement.resolution))
    .filter((requirement) => requirement.priority !== "optional_optimization" && requirement.priority !== "learn_later")
    .map((requirement) => ({ requirement, target: I1_TARGETS[requirement.requirement_key] }))
    .filter((candidate): candidate is { requirement: IntakeRequirement; target: IntakeTarget } => Boolean(candidate.target))
    .sort((a, b) => priorityRank[a.requirement.priority] - priorityRank[b.requirement.priority]);

  const selected = candidates[0];
  if (!selected) return null;
  return {
    key: selected.target.key,
    requirementKey: selected.requirement.requirement_key,
    decisionArea: selected.target.decisionArea,
    requiredSpecificity: selected.target.requiredSpecificity,
    sensitivity: selected.target.sensitivity,
  };
}
