/**
 * Product-controlled Level 2 configuration. These are not AI prompts: they
 * lock the construct names that an assessment is allowed to write. A topic is
 * added here only after its complete locked progression document is mapped.
 */
type TopicConfig = {
  model: string;
  routes: Record<string, { units: string[]; numberedStates: boolean }>;
};

export const TOPIC_PROGRESSION_CONFIGS: Record<string, TopicConfig> = {
  become_more_confident: {
    model: "confidence_context_dimension_v1",
    routes: {
      confidence: {
        units: ["stable_self_worth", "capability_belief", "confident_action", "confidence_recovery"],
        numberedStates: true,
      },
    },
  },
  build_self_trust: {
    model: "self_trust_dimensions_v1",
    routes: {
      self_trust: {
        units: ["self_knowledge", "self_authority", "judgment_calibration", "self_reliability", "adaptation_recovery"],
        numberedStates: true,
      },
    },
  },
  manage_my_time_better: {
    model: "time_architecture_v1",
    routes: {
      time_management: {
        units: ["time_capacity_awareness", "priority_scope_control", "planning_allocation", "capture_externalization", "time_protection_efficiency", "adaptation_recovery"],
        numberedStates: true,
      },
    },
  },
  stop_putting_things_off: {
    model: "unnecessary_delay_v1",
    routes: {
      procrastination: {
        units: ["delay_recognition_causal_clarity", "startability", "barrier_resolution", "persistence_reentry", "sustainable_follow_through"],
        numberedStates: true,
      },
    },
  },
  communicate_better: {
    model: "communication_dimensions_v1",
    routes: {
      communication: {
        units: ["expression", "clarity", "listening_understanding", "regulation", "judgment"],
        numberedStates: true,
      },
    },
  },
  set_better_boundaries: {
    model: "boundary_dimensions_v1",
    routes: {
      boundaries: {
        units: ["boundary_awareness", "boundary_judgment", "boundary_implementation", "boundary_follow_through", "boundary_reciprocity"],
        numberedStates: true,
      },
    },
  },
  get_my_home_organized: {
    model: "home_organization_v1",
    routes: {
      home_organization: {
        units: ["environmental_function", "placement_access", "household_systems", "maintenance_recovery", "restorative_fit", "adaptability"],
        numberedStates: true,
      },
    },
  },
  build_routines_that_work: {
    model: "routine_structure_v1",
    routes: {
      routines: {
        units: ["routine_fit", "cue_structure", "repeatability", "recovery", "flexibility_adaptability", "routine_portfolio_fit"],
        numberedStates: true,
      },
    },
  },
  build_stronger_relationships: {
    model: "relationship_dimensions_v1",
    routes: {
      relationship: {
        units: ["understanding", "responsiveness", "connection", "trust_reliability", "mutuality", "difference_repair", "growth_adaptation"],
        numberedStates: true,
      },
    },
  },
  feel_more_like_myself: {
    model: "state_and_identity_disconnection_v2",
    routes: {
      state_disconnection: {
        units: ["constraint_release", "pattern_movement", "momentum_ownership", "state_recovery"],
        numberedStates: false,
      },
      identity_disconnection: {
        units: ["self_recognition", "valued_self_expression", "engagement", "self_directed_space", "present_day_fit", "identity_reconnection_adaptation"],
        numberedStates: true,
      },
      mixed: {
        units: ["constraint_release", "pattern_movement", "momentum_ownership", "state_recovery", "self_recognition", "valued_self_expression", "engagement", "self_directed_space", "present_day_fit", "identity_reconnection_adaptation"],
        numberedStates: false,
      },
    },
  },
};

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;

/** Returns errors only for topics whose full Level 2 schema is mapped above. */
export function validateControlledTopicState(topicKey: string, currentState: RecordValue) {
  const config = TOPIC_PROGRESSION_CONFIGS[topicKey];
  if (!config) return [];
  const errors: string[] = [];
  if (currentState.model !== config.model) errors.push(`Use the locked state model '${config.model}'.`);
  const route = typeof currentState.route === "string" ? currentState.route : "";
  const routeConfig = config.routes[route];
  if (!routeConfig) return [...errors, "Choose a locked route for this topic."];
  if (topicKey === "become_more_confident" && (typeof currentState.contextKey !== "string" || currentState.contextKey.trim().length === 0)) {
    errors.push("Confidence state must name the relevant context; confidence does not transfer globally by default.");
  }
  const units = object(currentState.units);
  if (!units || Object.keys(units).length === 0) return [...errors, "Provide one or more controlled progression units."];
  for (const [key, value] of Object.entries(units)) {
    if (!routeConfig.units.includes(key)) {
      errors.push(`'${key}' is not a valid unit for the selected route.`);
      continue;
    }
    const unit = object(value);
    if (!unit) {
      errors.push(`'${key}' must be an evidence-backed unit object.`);
      continue;
    }
    if (routeConfig.numberedStates && (!Number.isInteger(unit.level) || Number(unit.level) < 1 || Number(unit.level) > 5)) {
      errors.push(`'${key}' requires its locked internal state from 1 to 5.`);
    }
  }
  return errors;
}
