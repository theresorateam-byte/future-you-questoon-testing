// supabase/functions/future-you-engine/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  LIVE_SEMANTIC_INTAKE_VERSION,
  MAX_INTAKE_INPUT_TOKENS,
  MAX_INTAKE_OUTPUT_TOKENS,
  addIntakeUsage,
  assessSimulatedAnswerQuality,
  assertLiveInputTokenCeiling,
  buildEvidenceItems,
  intakeCapForLevel,
  liveIntakeInstructions,
  liveIntakeTurnSchema,
  validateAndBuildLiveResult
} from "./intake-dynamic.ts";

// supabase/functions/future-you-engine/schemas.ts
var stringArray = {
  type: "array",
  items: { type: "string" }
};
var generatedBatchGoalsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["goals"],
  properties: {
    goals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["goal", "category", "bucket", "difficulty"],
        properties: {
          goal: { type: "string" },
          category: {
            type: "string",
            enum: [
              "health_movement",
              "food_nourishment",
              "sleep_rest",
              "home_environment",
              "work_career",
              "learning_creativity",
              "money_stability",
              "relationships_communication",
              "emotional_state",
              "life_admin_responsibilities"
            ]
          },
          bucket: { type: "string", enum: ["finish", "rhythm", "shift"] },
          difficulty: { type: "string", enum: ["ordinary", "ambiguous", "conflicting", "unrealistic", "constraint_heavy", "edge_case"] }
        }
      }
    }
  }
};
var todayStep = {
  type: "object",
  additionalProperties: false,
  required: ["action", "amount", "anchor", "minimum_version", "success_marker", "why", "how", "note"],
  properties: {
    action: { type: "string" },
    amount: { type: "string" },
    anchor: { type: "string" },
    minimum_version: { type: "string" },
    success_marker: { type: "string" },
    why: { type: "string" },
    how: { type: "string" },
    note: { type: ["string", "null"] }
  }
};
var planPreviewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "goal",
    "safety_realism",
    "bucket_tag",
    "expert_logic",
    "goal_gap",
    "capacity",
    "path_mode",
    "milestones",
    "plan_days",
    "success_markers",
    "risk_constraints",
    "todays_step",
    "preview",
    "evidence_summary"
  ],
  properties: {
    goal: {
      type: "object",
      additionalProperties: false,
      required: ["goal_text", "operational_meaning", "protected_intended_result"],
      properties: {
        goal_text: { type: "string" },
        operational_meaning: { type: "string" },
        protected_intended_result: { type: "string" }
      }
    },
    safety_realism: {
      type: "object",
      additionalProperties: false,
      required: ["status", "boundaries", "constraints", "prepare_conditions"],
      properties: {
        status: { type: "string", enum: ["pass", "prepare"] },
        boundaries: stringArray,
        constraints: stringArray,
        prepare_conditions: stringArray
      }
    },
    bucket_tag: {
      type: "object",
      additionalProperties: false,
      required: ["bucket", "tag", "rationale"],
      properties: {
        bucket: { type: "string", enum: ["finish", "rhythm", "shift"] },
        tag: {
          type: "string",
          enum: [
            "health_movement",
            "food_nourishment",
            "sleep_rest",
            "home_environment",
            "work_career",
            "learning_creativity",
            "money_stability",
            "relationships_communication",
            "emotional_state",
            "life_admin_responsibilities"
          ]
        },
        rationale: { type: "string" }
      }
    },
    expert_logic: {
      type: "object",
      additionalProperties: false,
      required: ["domain_assumptions", "normal_variation", "hard_boundaries"],
      properties: {
        domain_assumptions: stringArray,
        normal_variation: stringArray,
        hard_boundaries: stringArray
      }
    },
    goal_gap: {
      type: "object",
      additionalProperties: false,
      required: ["areas", "total", "narrative"],
      properties: {
        areas: {
          type: "array",
          minItems: 5,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "score", "evidence"],
            properties: {
              name: { type: "string" },
              score: { type: "integer", minimum: 0, maximum: 3 },
              evidence: { type: "string" }
            }
          }
        },
        total: { type: "integer", minimum: 0, maximum: 15 },
        narrative: { type: "string" }
      }
    },
    capacity: {
      type: "object",
      additionalProperties: false,
      required: ["usable_time", "access", "pressure", "constraints", "pacing_preference", "cross_goal_load"],
      properties: {
        usable_time: { type: "string" },
        access: stringArray,
        pressure: { type: "string" },
        constraints: stringArray,
        pacing_preference: { type: "string" },
        cross_goal_load: { type: "string" }
      }
    },
    path_mode: { type: "string", enum: ["tiny_start", "steady_build", "challenge"] },
    milestones: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["order", "title", "evidence"],
        properties: {
          order: { type: "integer", minimum: 1 },
          title: { type: "string" },
          evidence: { type: "string" }
        }
      }
    },
    plan_days: {
      type: "array",
      minItems: 30,
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day", "action", "amount", "anchor", "minimum_version", "success_marker"],
        properties: {
          day: { type: "integer", minimum: 1, maximum: 30 },
          action: { type: "string" },
          amount: { type: "string" },
          anchor: { type: "string" },
          minimum_version: { type: "string" },
          success_marker: { type: "string" }
        }
      }
    },
    success_markers: stringArray,
    risk_constraints: {
      type: "object",
      additionalProperties: false,
      required: ["consequences", "what_cannot_change", "safety_boundaries"],
      properties: {
        consequences: stringArray,
        what_cannot_change: stringArray,
        safety_boundaries: stringArray
      }
    },
    todays_step: todayStep,
    preview: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "today", "near_term"],
      properties: {
        headline: { type: "string" },
        today: { type: "string" },
        near_term: stringArray
      }
    },
    evidence_summary: {
      type: "object",
      additionalProperties: false,
      required: ["plan_basis", "constraints_used", "validation_notes"],
      properties: {
        plan_basis: stringArray,
        constraints_used: stringArray,
        validation_notes: stringArray
      }
    }
  }
};
var batchAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["executive_summary", "priority_order", "cluster_reviews"],
  properties: {
    executive_summary: { type: "string" },
    priority_order: {
      type: "array",
      items: { type: "string" }
    },
    cluster_reviews: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cluster_id", "likely_root_cause", "recommendation", "confidence", "needs_critical_review"],
        properties: {
          cluster_id: { type: "string" },
          likely_root_cause: { type: "string" },
          recommendation: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          needs_critical_review: { type: "boolean" }
        }
      }
    }
  }
};

// supabase/functions/future-you-engine/routing.ts
var TAG_KEYWORDS = {
  health_movement: ["gym", "exercise", "workout", "walk", "running", "run", "strength", "fitness", "movement", "sport"],
  food_nourishment: ["eat", "food", "meal", "cook", "grocery", "nutrition", "snack", "diet"],
  sleep_rest: ["sleep", "bed", "go to bed", "bedtime", "wake up", "rest", "insomnia", "night"],
  home_environment: ["home", "room", "closet", "declutter", "clean", "organize", "apartment", "house"],
  work_career: ["job", "career", "work", "promotion", "resume", "interview", "business", "client", "project"],
  learning_creativity: ["learn", "study", "course", "class", "read", "write", "paint", "music", "creative", "practice"],
  money_stability: ["save", "saving", "money", "debt", "budget", "pay off", "income", "deposit", "financial", "$"],
  relationships_communication: ["relationship", "partner", "spouse", "friend", "family", "coworker", "communicate", "boundary"],
  emotional_state: ["overwhelmed", "anxious", "stress", "anger", "calm", "confidence", "resentment", "emotion", "feel"],
  life_admin_responsibilities: ["application", "appointment", "paperwork", "document", "license", "renew", "insurance", "admin", "errand", "submit"]
};
var BUCKET_KEYWORDS = {
  finish: ["finish", "complete", "submit", "save", "pay off", "get a job", "earn", "reach", "organize", "declutter", "launch"],
  rhythm: ["start", "keep", "regular", "daily", "weekly", "habit", "routine", "exercise", "sleep", "cook", "practice", "consistently"],
  shift: ["become", "feel", "stop", "improve", "communicate", "handle", "manage", "set boundaries", "be more", "be less"]
};
function score(text, words2) {
  return words2.reduce((total, word) => total + (text.includes(word) ? word.includes(" ") ? 2 : 1 : 0), 0);
}
function rank(scores) {
  return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}
function confidence(top, second) {
  if (top <= 0) return 0.2;
  return Math.max(0.35, Math.min(0.98, (top + 1) / (top + second + 2)));
}
function classifyGoalLocally(goalText) {
  const text = goalText.toLowerCase();
  const tagScores = Object.fromEntries(Object.keys(TAG_KEYWORDS).map((tag2) => [tag2, score(text, TAG_KEYWORDS[tag2])]));
  const bucketScores = Object.fromEntries(Object.keys(BUCKET_KEYWORDS).map((bucket2) => [bucket2, score(text, BUCKET_KEYWORDS[bucket2])]));
  const [bestTag, secondTag] = rank(tagScores);
  const [bestBucket, secondBucket] = rank(bucketScores);
  const tag = bestTag[1] > 0 ? bestTag[0] : "life_admin_responsibilities";
  let bucket = bestBucket[1] > 0 ? bestBucket[0] : "finish";
  if (tag === "money_stability" && ["save", "pay off", "reach", "debt"].some((word) => text.includes(word))) bucket = "finish";
  if (["health_movement", "food_nourishment", "sleep_rest"].includes(tag) && !["finish", "complete", "lose", "reach"].some((word) => text.includes(word))) bucket = "rhythm";
  const tagConfidence = confidence(bestTag[1], secondTag?.[1] ?? 0);
  const bucketConfidence = confidence(bucketScores[bucket], secondBucket?.[1] ?? 0);
  return { bucket, bucket_confidence: bucketConfidence, tag, tag_confidence: tagConfidence, routing_question_needed: bestTag[1] < 1 || tagConfidence < 0.52 || bucketConfidence < 0.48 };
}
function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}
function validateAnswerForControl(control, options, answer) {
  const value = answer.value;
  const allowed = new Set((options ?? []).map((item) => String(item.id)));
  const selected = Array.isArray(value) ? value.map(String) : typeof value === "string" || typeof value === "number" ? [String(value)] : [];
  if (control === "multi_select" && !Array.isArray(value)) return "Select every answer that applies.";
  if (control === "single_select" && (Array.isArray(value) || selected.length !== 1)) return "Choose one answer.";
  if (["single_select", "multi_select"].includes(control) && selected.some((id) => !allowed.has(id))) return "Choose from the answers shown.";
  if (control === "multi_select" && selected.length === 0) return "Select at least one answer.";
  if (["none", "all"].some((id) => selected.includes(id)) && selected.length > 1) return "Choose that answer by itself.";
  if (selected.includes("other") && !(typeof answer.other_text === "string" && answer.other_text.trim())) return "Add the answer that fits.";
  if (!["single_select", "multi_select"].includes(control) && selected.length === 0) return "Answer the question before continuing.";
  if (control === "number" && parseNumber(selected[0]) === null) return "Enter a number.";
  if (control === "date" && !/^20\d{2}-\d{2}-\d{2}$/.test(selected[0])) return "Choose a date.";
  if (control === "time" && !/^\d{2}:\d{2}$/.test(selected[0])) return "Choose a time.";
  return null;
}

// supabase/functions/future-you-engine/prompts.ts
var PLAN_PROMPT_VERSION = "future-you-plan-v2.2";
var SCHEMA_VERSION = "future-you-contract-v2.2";
var WORDING_RULES = `
Wording layer for every user-facing message, question, option, recommendation, preview, and step:
- Sound like a sharp, trustworthy friend who has already done the hard thinking.
- Lead with the useful conclusion. Keep it brief, concrete, and natural.
- Put only one decision or request in each question. Ask no more than one question at a time.
- Use ordinary words. Never expose engine labels, internal states, check names, or reasoning terminology.
- Do not repeat a fact or question already answered, even with different wording.
- Do not ask the person to calculate, research, or estimate something the engine can reasonably derive from supplied facts, arithmetic, dates, or a clearly labeled conservative assumption.
- When uncertainty remains, make a conservative expert recommendation and name the uncertainty briefly. Do not transfer the analytical burden to the person.
- Explain a recommendation in one short sentence, then make the next decision easy.
- Never use third-person phrases such as "the user" when speaking to the person.
`;
var generatedBatchGoalsInstructions = `
Create fresh Future You test goals. Each goal must sound like something a real person would type, fit the requested category, and differ materially from every excluded goal. Include ordinary, ambiguous, conflicting, unrealistic, constraint-heavy, and edge cases. Never recycle or paraphrase an excluded goal. Return exactly the requested number.
`;
var intakeInstructions = `
You are the Future You planning engine for Resora, a non-clinical wellness and life-planning product.

Your job is to decide the single best next intake action from the supplied goal, profile, prior answers, temporal context, and active-goal load. Think like a skilled human expert in the goal's domain, but speak in ordinary language. Do not use therapy language, diagnose, prescribe treatment, or inflate ordinary distress into a crisis.

Hard rules:
1. Classify exactly one bucket: finish, rhythm, or shift.
2. Classify exactly one approved tag.
3. Maintain a living expert coverage checklist. Universal coverage has eight fixed areas: outcome definition, current state, time/cadence, capacity, access/resources, constraints/non-negotiables, barriers/risks, and support/dependencies. Add goal-specific requirements that a competent expert would genuinely need before recommending a detailed plan. Full Plan must have at least three material goal-specific requirements. Once a goal-specific requirement exists, carry its key forward on later turns; new evidence may complete it or make it not applicable, but do not silently delete or replace it to end intake early.
4. Mark coverage known only when the goal text, profile, or an answer actually supplies the fact. Mark not_applicable only when the current evidence makes that area genuinely irrelevant. Otherwise mark it missing.
5. Full Plan normally builds only when every universal and goal-specific requirement is known or not_applicable and coverage.gate_passed is true. There is no arbitrary minimum question count, but a Full Plan will usually need 8\u201318 normal intake questions. If the 18-question cap is reached with a non-safety fact still missing, return a cautious starter plan instead of failing or ending intake without a plan. Name each missing fact and use conservative assumptions.
6. Ask only a question that can materially change at least one named Action Plan field. Never ask for a fact already known.
6a. Before drafting any visible question, fill question.brief. The brief is the Question Quality Gate. Name exactly one missing_fact_key and one missing_fact; give one to three short meaning_anchors that the final wording must preserve; list the known context used; list the evidence keys used; name the exact way the answer changes the plan; and copy every previously asked question_key into facts_not_to_reask. question.key must equal brief.missing_fact_key, and question.why_needed must exactly copy brief.why_it_changes_plan. If the answer is already present, conflicts with known context, repeats an earlier decision under a new key, or cannot change a named plan field, do not ask it. Choose a different missing fact.
6b. main_topic may repeat only when missing_fact_key is genuinely different. For example, where savings are kept and how savings inside checking will be tracked are different facts; asking where they will be kept twice is not. The draft text and choices must follow the brief and must not introduce another decision.
6c. Never build a question by attaching the full goal to a generic sentence frame. Refer to the subject naturally: "the insurance paperwork," "this boundary," "your savings goal," or another short phrase. Do not repeat dates, amounts, or outcome wording unless that detail is necessary to understand the exact fact being requested.
6d. Ask domain-first questions. For paperwork, identify the remaining documents, completed sections, deadline, submission route, and outside dependencies. For boundaries, first understand the behavior, boundary, person, likely response, and consequence. For savings, understand current amount, required pace, available amount, essential expenses, and where money will be held. Apply the same expert pattern to every other domain.
6e. A question is not justified because it matches a coverage label. It must be the highest-value missing fact for this particular goal and materially change the plan. Never ask abstract placeholders such as what is still waiting, what is already finished, what must stay unchanged, or whether the person has what they need without naming the concrete subject and decision.
7. Ask one question at a time. Prefer single-select or multi-select when the answer space is bounded. When useful, include Other, None of the above, and All of the above. Use option ids other, none, and all for those three choices. Use multi-select when several answers can be true. Do not force those options when they make no sense.
8. Quick Start has at most 10 normal intake questions. Full Plan has at most 18 normal intake questions. A viability-repair question does not count toward that cap. Use question.kind to distinguish intake from viability_repair.
9. After every answer, run a hard viability check against current date/time, deadlines, capacity, access, resources, constraints, safety, and outside dependencies. When numbers or dates imply a hard relationship, do the arithmetic before deciding feasibility. Treat a failed check as a blocker, not a suggestion. Use viability.status viable when there is no known hard failure, even while some checks are still unknown. Unknown means continue intake with the single best question. At the question cap only, unresolved non-safety facts may produce a cautious starter plan that names the uncertainty and makes no aggressive assumption.
9a. Goal Calibration is required after the goal and essential feasibility facts are understood and before plan creation. Set goal_calibration.status to pending until there is enough evidence. Then classify the goal as realistic, aggressive, or unsafe_impossible.
9b. For a realistic goal, set committed_target to the original target and mark calibration confirmed. For an aggressive goal, recommend a safer target, leave committed_target null until the person decides, and preserve the original as a stretch target. For an unsafe or impossible goal, recommend a safer alternative and do not preserve an unsafe target as a stretch.
9c. Do the expert work internally. Use supplied facts, arithmetic, dates, general domain knowledge, and conservative assumptions. Record assumptions and uncertainties in goal_calibration, but do not ask the person to perform the expert calculation. Never claim a personalized tax, medical, legal, or other regulated calculation that the evidence cannot support.
9d. If an aggressive or unsafe_impossible recommendation has not been accepted, ask one goal_calibration question with simple choices. When the person accepts a direction, put it in committed_target and mark confirmed true. If they want to keep the original target and a concrete change could make it realistic, verify that change first, then reclassify the adjusted goal. Do not build a plan until goal_calibration.confirmed is true. committed_target governs the plan; an aggressive original target may remain visible as the stretch target.
10. If the goal cannot currently work, pause normal intake. Set viability.status to needs_repair and ask one plain-language viability_repair question that offers realistic ways to revise the goal or choose a preparation path. Do not spend a normal intake question on this repair.
11. A proposed repair is only a possibility, never proof that it works. The controller will collect the practical details after a person picks a repair. Treat those details as the evidence used to decide whether the repair resolves the failed check.
12. After repair details are collected, decide from the evidence. If the repair works, resume the unfinished expert coverage checklist exactly where it left off. If it does not work, plainly name the remaining gap and offer another relevant change to the outcome, deadline or pace, resources or capacity, or a preparation path. After three failed repair choices, build a cautious 30-day preparation plan instead of repeating the repair question or ending without a plan.
12a. When current_repair_state is present, use the selected repair plus the immediately preceding answer as the repair evidence. Do not ask the same broad verification question again. Ask only a missing fact that could change the decision, or offer the next repair when the evidence is enough to show the current one will not work.
12b. Set question.repair_phase to proposal only when offering repair choices. Set it to verification only when asking for one missing fact about the already selected repair. For intake and goal_calibration questions, set repair_phase to null.
13. Use viability.status preparation and next_action prepare only after preparation is the appropriate route outside an ordinary feasibility-repair conversation. Use Stop/redirect only for genuinely unsafe or prohibited demands.
14. Conditional questions require an explicit activation rule supported by current evidence.
15. Before the normal question cap, prioritize unresolved viability facts and consolidate related unknowns. At the cap, never fail or return an internal state. Build a cautious starter plan, name the missing facts, choose tiny_start, and keep uncertain commitments out of the schedule.
16. Apply the wording layer below before returning any user-facing copy. Do not narrate the engine's reasoning process.
17. A feasibility repair should sound like: "At this pace, the deadline doesn't line up. What do you want to change?" Then offer concrete choices relevant to that goal. This is a tone example, not money-specific logic.
18. Never reveal hidden chain-of-thought. evidence_summary must contain only concise, user-defensible factors.
19. If next_action is ask_question, question must be non-null and plan_impacts must be non-empty. Otherwise question must be null.

${WORDING_RULES}

Return only the required structured output.`;
var planInstructions = `
You are the Future You plan builder for Resora, a non-clinical wellness and life-planning product.

Build a realistic, personalized 30-day Action Plan from the supplied approved intake ledger. Preserve the user's intended result. The plan must fit the user's actual time, access, pressure, capacity, constraints, pacing preference, and combined load from other active goals.

Hard rules:
1. Build the plan around blueprint.goal_calibration.committed_target. If cautious_starter is true and calibration is still pending, preserve the intended result but plan only the smallest reversible action supported by known facts. Keep a separate stretch target only when blueprint.goal_calibration allows one. Do not silently restore the original target after calibration.
2. Use exactly one bucket and one approved tag from the intake route.
3. Goal Gap must contain exactly five relevant areas scored 0\u20133, and total must equal the sum.
4. Choose tiny_start, steady_build, or challenge from evidence; never choose by aspiration alone. Use tiny_start when cautious_starter is true, feasibility was just repaired, capacity is low/uncertain, the behavior is new, or friction is high. Steady_build requires demonstrated workable capacity. Challenge requires strong stable capacity plus evidence that a higher demand fits.
5. Produce exactly 30 ordered future days numbered 1 through 30.
6. Today's Step must be one clear action with amount, anchor, minimum version, success marker, Why, and How.
7. Completed content does not exist in a new plan and must never be invented.
8. Protect explicit constraints and What Cannot Change. Do not trade safety, housing, food, health, legal duties, or required deadlines for goal progress.
9. Use Prepare only for a safe setup step. Do not disguise an unsafe or impossible path as motivation.
10. Apply the wording layer below to all plan copy.
11. Never reveal hidden chain-of-thought. evidence_summary must contain only concise, user-defensible factors.

${WORDING_RULES}

Return only the required structured output.`;

// supabase/functions/future-you-engine/progress-engine.ts
function clone(value) {
  return structuredClone(value);
}
function decisionFor(input) {
  if (input.result === "completed") return "build";
  if (input.result === "partially_completed") return "continue";
  if (["capacity", "emotion"].includes(input.reason)) return "ease";
  if (["access", "external_difficulty"].includes(input.reason)) return "switch";
  return "ease";
}
function applyProgressUpdate(originalPlan, livePlan, history, input) {
  const before = clone(livePlan);
  const decision = decisionFor(input);
  const event = {
    id: crypto.randomUUID(),
    recorded_at: (/* @__PURE__ */ new Date()).toISOString(),
    result: input.result,
    reason: input.reason,
    detail: input.detail ?? null,
    decision
  };
  if (input.validation_should_fail) {
    return {
      valid: false,
      decision,
      original_plan: clone(originalPlan),
      live_plan: before,
      history: clone(history),
      event: null,
      failure_codes: ["progress_validation_failed"]
    };
  }
  const next = clone(livePlan);
  const planDays = Array.isArray(next.plan_days) ? clone(next.plan_days) : [];
  const completedDays = planDays.filter((day) => day.completed === true);
  const remainingDays = planDays.filter((day) => day.completed !== true);
  if (input.result === "completed" && remainingDays[0]) remainingDays[0].completed = true;
  if (decision === "ease" && remainingDays[0]) {
    remainingDays[0].minimum_version = String(remainingDays[0].minimum_version ?? "Do the smallest useful version.");
    remainingDays[0].adjustment = "Reduced after the latest progress update.";
  }
  if (decision === "switch" && remainingDays[0]) {
    remainingDays[0].adjustment = "Use an available route that protects the same result.";
  }
  next.plan_days = [...completedDays, ...remainingDays];
  next.last_progress_decision = decision;
  next.revision = Number(next.revision ?? 1) + 1;
  return {
    valid: true,
    decision,
    original_plan: clone(originalPlan),
    live_plan: next,
    history: [...clone(history), event],
    event,
    failure_codes: []
  };
}

// supabase/functions/future-you-engine/analyzer-scoring.ts
function scoreAnalyzerFindings(findings) {
  const count = (severity) => findings.filter((finding) => finding.severity === severity).reduce((sum, finding) => sum + Number(finding.count ?? 1), 0);
  const severityCounts = {
    critical: count("critical"),
    high: count("high"),
    medium: count("medium"),
    low: count("low")
  };
  let score2 = 100 - severityCounts.critical * 8 - severityCounts.high * 4 - severityCounts.medium * 1.5 - severityCounts.low * 0.5;
  if (severityCounts.critical >= 3) score2 = Math.min(score2, 55);
  else if (severityCounts.critical > 0) score2 = Math.min(score2, 69);
  else if (severityCounts.high > 0) score2 = Math.min(score2, 79);
  return { score: Math.max(0, Math.min(100, Math.round(score2 * 10) / 10)), severityCounts };
}

// supabase/functions/future-you-engine/semantic-intake.ts
var SEMANTIC_INTAKE_VERSION = "future-you-semantic-intake-v5.0";
var FACT_ROLES = [
  "outcome_definition",
  "current_state",
  "success_definition",
  "time_or_cadence",
  "capacity",
  "access_resources",
  "constraints_nonnegotiables",
  "barriers_risks",
  "support_dependencies",
  "goal_specific",
  "realism"
];
var routeTags = [
  "health_movement",
  "food_nourishment",
  "sleep_rest",
  "home_environment",
  "work_career",
  "learning_creativity",
  "money_stability",
  "relationships_communication",
  "emotional_state",
  "life_admin_responsibilities"
];
var optionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 60 },
    label: { type: "string", minLength: 1, maxLength: 110 }
  }
};
var questionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "fact_id", "text", "control", "options", "why_needed", "kind", "ask_if"],
  properties: {
    id: { type: "string", pattern: "^q[1-9][0-9]?$" },
    fact_id: { type: "string", minLength: 2, maxLength: 60 },
    text: { type: "string", minLength: 3, maxLength: 240 },
    control: { enum: ["text", "single_select", "multi_select", "number", "date", "time"] },
    options: { type: "array", maxItems: 8, items: optionSchema },
    why_needed: { type: "string", minLength: 5, maxLength: 180 },
    kind: { enum: ["intake", "viability_repair"] },
    ask_if: { enum: ["fact_unknown", "fact_conflicting"] }
  }
};
var semanticIntakePlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["goal_understanding", "facts", "questions", "realism"],
  properties: {
    goal_understanding: {
      type: "object",
      additionalProperties: false,
      required: ["normalized_goal", "bucket", "tag", "target_outcome", "success_definition", "safety_status", "safety_message"],
      properties: {
        normalized_goal: { type: "string", minLength: 3, maxLength: 500 },
        bucket: { enum: ["finish", "rhythm", "shift"] },
        tag: { enum: routeTags },
        target_outcome: { type: "string", minLength: 3, maxLength: 300 },
        success_definition: { type: "string", minLength: 3, maxLength: 300 },
        safety_status: { enum: ["pass", "stop_redirect"] },
        safety_message: { type: "string", maxLength: 300 }
      }
    },
    facts: {
      type: "array",
      minItems: 9,
      maxItems: 14,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "role", "label", "required", "applicable", "status", "source", "exact_support", "value", "why_needed"],
        properties: {
          id: { type: "string", pattern: "^[a-z][a-z0-9_]{1,59}$" },
          role: { enum: [...FACT_ROLES] },
          label: { type: "string", minLength: 3, maxLength: 120 },
          required: { type: "boolean" },
          applicable: { type: "boolean" },
          status: { enum: ["confirmed", "uncertain", "conflicting", "not_applicable"] },
          source: { enum: ["goal_text", "none"] },
          exact_support: { type: "string", maxLength: 500 },
          value: { type: "string", maxLength: 500 },
          why_needed: { type: "string", minLength: 5, maxLength: 180 }
        }
      }
    },
    questions: { type: "array", minItems: 1, maxItems: 8, items: questionSchema },
    realism: {
      type: "object",
      additionalProperties: false,
      required: ["status", "reason", "evidence_fact_ids", "repair_question_id"],
      properties: {
        status: { enum: ["viable", "needs_repair", "unknown"] },
        reason: { type: "string", minLength: 3, maxLength: 300 },
        evidence_fact_ids: { type: "array", maxItems: 8, items: { type: "string" } },
        repair_question_id: { type: ["string", "null"] }
      }
    }
  }
};
var semanticQuestionReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pass", "issues", "questions"],
  properties: {
    pass: { type: "boolean" },
    issues: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question_id", "code", "explanation"],
        properties: {
          question_id: { type: "string" },
          code: { enum: ["irrelevant", "awkward", "duplicate", "assumption", "compound", "vague", "missing_subject", "wrong_control"] },
          explanation: { type: "string", minLength: 3, maxLength: 180 }
        }
      }
    },
    questions: { type: "array", minItems: 1, maxItems: 8, items: questionSchema }
  }
};
var batchQuestionAuditSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reviews"],
  properties: {
    reviews: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["case_id", "pass", "findings"],
        properties: {
          case_id: { type: "string" },
          pass: { type: "boolean" },
          findings: {
            type: "array",
            maxItems: 10,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["code", "stage", "severity", "title", "summary", "evidence", "recommendation"],
              properties: {
                code: { type: "string", minLength: 3, maxLength: 80 },
                stage: { enum: ["question_quality", "evidence", "completion", "realism", "routing"] },
                severity: { enum: ["critical", "high", "medium", "low"] },
                title: { type: "string", minLength: 3, maxLength: 140 },
                summary: { type: "string", minLength: 3, maxLength: 300 },
                evidence: { type: "string", minLength: 3, maxLength: 500 },
                recommendation: { type: "string", minLength: 3, maxLength: 300 }
              }
            }
          }
        }
      }
    }
  }
};
var semanticIntakeInstructions = `
You design Future You intake for one specific goal. Understand the literal meaning of the entire goal before assigning a route.

Return a compact goal-specific evidence map and only the questions genuinely required to build a grounded plan. Do not use category templates or mechanically paste the goal into generic questions.

Evidence rules:
- A confirmed fact must be directly stated in the goal. exact_support must be a verbatim excerpt from the goal and value must preserve its meaning.
- Never count a category, keyword, default, profile assumption, or model inference as evidence.
- If the goal does not establish a required applicable fact, mark it uncertain with source none and ask one direct question for it.
- Mark a fact not_applicable only when it truly cannot change this goal; explain why in why_needed.
- Include one fact for each of the first nine fact roles. Add one to three goal_specific facts when the individual goal needs them.

Question rules:
- Create 3 to 6 questions normally and never more than 8.
- Each question resolves exactly one fact_id and names the real subject in natural language.
- Ask what the user can answer now. Do not ask broad category questions.
- Do not ask for information already stated in the goal.
- Do not ask \u201CWhere are you now with\u2026\u201D, \u201CDo you have what you need\u2026\u201D, \u201CHow often do you want to do this?\u201D, or mechanically append \u201Cnow\u201D to the goal.
- Do not turn \u201Cwork out what something means\u201D into exercise, cancellation into savings, or a specific daily action into a generic workout.
- Use select controls only when the choices are mutually understandable; include Not sure when uncertainty is plausible.
- Keep each question to one sentence, one question mark, and at most 22 words.

Done means every required applicable fact is confirmed, success is measurable, realism is viable, and no conflict remains. If the literal goal is impossible, guaranteed, controlled by an outside decision-maker, or incompatible with its deadline, set realism to needs_repair and make the first question a viability_repair question with concrete choices.
`;
var semanticQuestionReviewInstructions = `
Act as a strict editor for a complete Future You intake question plan. Review every question against the literal goal and its assigned missing fact.

Reject or correct any question that is irrelevant, awkward, repetitive, category-driven, assumes facts, loses the subject, combines multiple decisions, or could not change the plan. Preserve every question id and fact_id. Return the full corrected question list in the same order. Each question must be natural, direct, at most 22 words, and contain exactly one question mark. Correct every issue you find, then set pass true only if the returned list has no remaining obviously bad question.
`;
var batchQuestionAuditInstructions = `
Audit every Future You intake case and every displayed question. Judge the literal goal, not its assigned category.

Flag a question when it is irrelevant, awkward, mechanically repeats the goal, loses its subject, asks an already-known fact, assumes unsupported information, duplicates another question, or cannot change the plan. Also flag confirmed facts without direct goal or answer evidence, contradictions that were accepted, unrealistic goals that reached planning without repair, and completion with unresolved essential facts.

An obviously bad user-facing question is high severity. Premature completion, accepted contradiction, or unsupported realism is critical. Do not require an action plan in an Intake-only batch. Return one review for every supplied case and do not omit clean cases.
`;
function words(value) {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}
function overlap(left, right) {
  const a = new Set(words(left).filter((word) => word.length > 3));
  const b = new Set(words(right).filter((word) => word.length > 3));
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.min(a.size, b.size);
}
function supportAppearsInGoal(goal, support) {
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9$]+/g, " ").trim();
  return support.trim().length >= 2 && normalize(goal).includes(normalize(support));
}
var forbiddenQuestionPatterns = [
  /^where are you now with\b/i,
  /^do you have what you need\b/i,
  /^how often do you want to do this\??$/i,
  /^how much time do you have each week for\b/i,
  /^what must stay unchanged while\b/i,
  /^how often do you .{35,}\snow\?$/i
];
function validateSemanticPlan(goal, plan) {
  const facts = Array.isArray(plan.facts) ? plan.facts : [];
  const questions = Array.isArray(plan.questions) ? plan.questions : [];
  const factIds = /* @__PURE__ */ new Set();
  for (const fact of facts) {
    if (factIds.has(fact.id)) throw new Error(`duplicate_fact:${fact.id}`);
    factIds.add(fact.id);
    if (fact.status === "confirmed" && (fact.source !== "goal_text" || !supportAppearsInGoal(goal, fact.exact_support))) {
      throw new Error(`unsupported_confirmed_fact:${fact.id}`);
    }
    if (fact.status === "not_applicable" && fact.applicable) throw new Error(`applicable_fact_marked_na:${fact.id}`);
    if (fact.required && fact.applicable && fact.status !== "confirmed" && !questions.some((question) => question.fact_id === fact.id)) {
      throw new Error(`required_fact_without_question:${fact.id}`);
    }
  }
  for (const role of FACT_ROLES.slice(0, 9)) {
    if (!facts.some((fact) => fact.role === role)) throw new Error(`missing_fact_role:${role}`);
  }
  const questionIds = /* @__PURE__ */ new Set();
  for (const question of questions) {
    if (questionIds.has(question.id)) throw new Error(`duplicate_question_id:${question.id}`);
    questionIds.add(question.id);
    if (!factIds.has(question.fact_id)) throw new Error(`unknown_question_fact:${question.id}`);
    if (!question.text.endsWith("?") || (question.text.match(/\?/g) ?? []).length !== 1 || words(question.text).length > 22) {
      throw new Error(`invalid_question_shape:${question.id}`);
    }
    if (forbiddenQuestionPatterns.some((pattern) => pattern.test(question.text))) throw new Error(`forbidden_question_pattern:${question.id}`);
    if ([...questionIds].some((id) => id !== question.id && overlap(question.text, questions.find((item) => item.id === id)?.text ?? "") >= 0.8)) {
      throw new Error(`duplicate_question_meaning:${question.id}`);
    }
    const optionsNeeded = ["single_select", "multi_select"].includes(question.control);
    if (optionsNeeded !== question.options.length >= 2) throw new Error(`question_control_options_mismatch:${question.id}`);
  }
  if (plan.realism.status === "needs_repair") {
    const repair = questions.find((question) => question.id === plan.realism.repair_question_id);
    if (!repair || repair.kind !== "viability_repair") throw new Error("realism_repair_missing");
  }
}
function answerText(answer) {
  const values = Array.isArray(answer.value) ? answer.value : [answer.value];
  const selected = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  const other = typeof answer.other_text === "string" ? answer.other_text.trim() : "";
  return [selected.join(", "), other].filter(Boolean).join(": ");
}
function uncertainAnswer(answer) {
  const value = answerText(answer).toLowerCase().replace(/[’']/g, "'");
  return !value || /^(?:not[_ ]sure|unknown|i (?:am|m) not sure|i do not know|i don't know|whatever|none yet)$/i.test(value) || /realistic (?:answer|option).*current (?:schedule|limits)/i.test(value);
}
function buildSemanticResult(goal, planInput, priorTurns, cap) {
  const plan = structuredClone(planInput);
  const answeredKeys = /* @__PURE__ */ new Set();
  for (const turn of priorTurns) {
    const key = String(turn.question_key ?? turn.key ?? "");
    const answer = turn.answer && typeof turn.answer === "object" ? turn.answer : {};
    if (!key || Object.keys(answer).length === 0) continue;
    answeredKeys.add(key);
    const question2 = plan.questions.find((item) => item.id === key);
    const fact = question2 ? plan.facts.find((item) => item.id === question2.fact_id) : null;
    if (!fact) continue;
    const exact = answerText(answer);
    fact.source = exact ? "user_answer" : "none";
    fact.exact_support = exact;
    fact.value = exact;
    fact.status = uncertainAnswer(answer) ? "uncertain" : "confirmed";
  }
  const timeAnswers = priorTurns.filter((turn) => String(turn.control) === "time" && recordAnswer(turn).value);
  if (timeAnswers.length >= 2) {
    const values = timeAnswers.map((turn) => String(recordAnswer(turn).value));
    if (new Set(values).size < values.length) {
      for (const turn of timeAnswers) {
        const question2 = plan.questions.find((item) => item.id === String(turn.question_key));
        const fact = question2 ? plan.facts.find((item) => item.id === question2.fact_id) : null;
        if (fact) fact.status = "conflicting";
      }
    }
  }
  const unresolved = plan.facts.filter((fact) => fact.required && fact.applicable && fact.status !== "confirmed");
  const repaired = plan.realism.status === "needs_repair" && plan.realism.repair_question_id ? plan.facts.find((fact) => plan.questions.find((question2) => question2.id === plan.realism.repair_question_id)?.fact_id === fact.id)?.status === "confirmed" : false;
  const effectiveRealism = repaired ? "viable" : plan.realism.status;
  const nextQuestion = plan.questions.find((question2) => {
    if (answeredKeys.has(question2.id)) return false;
    const fact = plan.facts.find((item) => item.id === question2.fact_id);
    return fact && fact.applicable && fact.status !== "confirmed";
  }) ?? null;
  const safetyStop = plan.goal_understanding.safety_status === "stop_redirect";
  const done = !safetyStop && unresolved.length === 0 && effectiveRealism === "viable";
  const exhausted = !nextQuestion && !done;
  const nextAction = safetyStop ? "stop_redirect" : nextQuestion ? "ask_question" : done ? "build_plan" : "cautious_starter";
  const roleStatus = (roles) => {
    const matching = plan.facts.filter((fact) => roles.includes(fact.role));
    const applicable = matching.filter((fact) => fact.applicable);
    if (!applicable.length) return { status: "not_applicable", reason: "This information cannot change this goal.", evidence_keys: [] };
    const complete = applicable.every((fact) => fact.status === "confirmed");
    return {
      status: complete ? "known" : "missing",
      reason: complete ? "Direct evidence is recorded." : "Direct evidence is still required.",
      evidence_keys: complete ? applicable.map((fact) => fact.id) : []
    };
  };
  const universal = {
    outcome_definition: roleStatus(["outcome_definition", "success_definition"]),
    current_state: roleStatus(["current_state"]),
    time_or_cadence: roleStatus(["time_or_cadence"]),
    capacity: roleStatus(["capacity"]),
    access_resources: roleStatus(["access_resources"]),
    constraints_nonnegotiables: roleStatus(["constraints_nonnegotiables"]),
    barriers_risks: roleStatus(["barriers_risks"]),
    support_dependencies: roleStatus(["support_dependencies"])
  };
  const goalSpecificFacts = plan.facts.filter((fact) => fact.role === "goal_specific" || fact.role === "realism");
  const goalSpecific = goalSpecificFacts.map((fact) => ({
    key: fact.id,
    label: fact.label,
    status: !fact.applicable ? "not_applicable" : fact.status === "confirmed" ? "known" : "missing",
    why_it_matters: fact.why_needed,
    evidence_keys: fact.status === "confirmed" ? [fact.id] : []
  }));
  if (!goalSpecific.length) {
    goalSpecific.push({
      key: "semantic_goal_fit",
      label: "Goal-specific plan fit",
      status: done ? "known" : "missing",
      why_it_matters: "The plan must fit the literal goal rather than its category.",
      evidence_keys: done ? ["goal_text"] : []
    });
  }
  const coveragePassed = Object.values(universal).every((item) => item.status !== "missing") && goalSpecific.every((item) => item.status !== "missing");
  const factLedger = {
    known: plan.facts.filter((fact) => fact.status === "confirmed").map((fact) => ({
      key: fact.id,
      label: fact.label,
      value: fact.value,
      source: fact.source,
      exact_support: fact.exact_support,
      plan_impacts: [fact.why_needed],
      activation_rule: fact.applicable ? "required_for_this_goal" : "not_applicable"
    })),
    essential: plan.facts.filter((fact) => fact.required && fact.applicable && fact.status !== "confirmed").map((fact) => ({
      key: fact.id,
      label: fact.label,
      value: "Unknown",
      status: fact.status,
      source: fact.source,
      exact_support: fact.exact_support,
      plan_impacts: [fact.why_needed],
      activation_rule: "required_for_this_goal"
    })),
    conditional: [],
    optional: []
  };
  const question = nextQuestion ? {
    key: nextQuestion.id,
    text: nextQuestion.text,
    control: nextQuestion.control,
    options: nextQuestion.options,
    blueprint_link: `semantic_facts.${nextQuestion.fact_id}`,
    plan_impacts: [nextQuestion.why_needed],
    activation_rule: nextQuestion.ask_if,
    kind: nextQuestion.kind,
    repair_phase: nextQuestion.kind === "viability_repair" ? "proposal" : null,
    why_needed: nextQuestion.why_needed,
    brief: {
      missing_fact_key: nextQuestion.id,
      missing_fact: plan.facts.find((fact) => fact.id === nextQuestion.fact_id)?.label ?? nextQuestion.fact_id,
      main_topic: plan.goal_understanding.target_outcome,
      known_context: [goal],
      why_it_changes_plan: nextQuestion.why_needed,
      evidence_keys_used: ["goal_text", ...answeredKeys],
      meaning_anchors: [plan.goal_understanding.target_outcome.slice(0, 100)],
      facts_not_to_reask: [...answeredKeys]
    }
  } : null;
  const checks = [
    { type: "evidence", status: unresolved.length ? "unknown" : "pass", summary: unresolved.length ? "Essential facts still need direct evidence." : "Every essential fact has direct evidence." },
    { type: "realism", status: effectiveRealism === "viable" ? "pass" : effectiveRealism === "needs_repair" ? "fail" : "unknown", summary: plan.realism.reason }
  ];
  return {
    safety: { status: safetyStop ? "stop_redirect" : "pass", boundary_codes: safetyStop ? ["explicit_high_risk"] : [], short_user_message: plan.goal_understanding.safety_message, explicit_evidence: safetyStop ? [goal] : [] },
    realism: { status: done ? "ready" : "needs_setup", constraints: effectiveRealism === "needs_repair" ? [plan.realism.reason] : [], missing_setup: unresolved.map((fact) => fact.label) },
    route: { bucket: plan.goal_understanding.bucket, bucket_confidence: 0.9, tag: plan.goal_understanding.tag, tag_confidence: 0.9, routing_question_needed: false },
    coverage: { universal, goal_specific: goalSpecific, gate_passed: coveragePassed },
    viability: {
      status: effectiveRealism === "needs_repair" ? "needs_repair" : effectiveRealism === "viable" ? "viable" : "pending",
      checks,
      hard_issue: effectiveRealism === "needs_repair" ? plan.realism.reason : null,
      repair_options: nextQuestion?.kind === "viability_repair" ? nextQuestion.options : []
    },
    goal_calibration: {
      status: done ? "realistic" : "pending",
      original_target: goal,
      recommended_target: null,
      committed_target: done ? plan.goal_understanding.normalized_goal : null,
      stretch_target: null,
      recommendation: null,
      reason: done ? "The goal is supported by confirmed evidence." : "Required facts are still being collected.",
      assumptions: [],
      uncertainties: unresolved.map((fact) => fact.label),
      confirmed: done
    },
    blueprint: { semantic_intake_plan: plan, semantic_version: SEMANTIC_INTAKE_VERSION },
    fact_ledger: factLedger,
    next_action: nextAction,
    question,
    stop_reason: safetyStop ? plan.goal_understanding.safety_message : null,
    cautious_starter: exhausted,
    evidence_summary: {
      decision_basis: ["Literal goal text", "Direct user answers", "Strict semantic evidence contract"],
      missing_facts: unresolved.map((fact) => fact.label),
      guardrails_applied: ["No category-selected questions", "No unsupported confirmed facts", "One fact per question", "No duplicate questions"],
      question_plan_exhausted: exhausted,
      done_definition_passed: done
    }
  };
}
function recordAnswer(turn) {
  return turn.answer && typeof turn.answer === "object" ? turn.answer : {};
}
function validateSemanticResult(result, askedKeys, cap) {
  const question = result.question;
  const nextAction = String(result.next_action);
  const evidence = result.evidence_summary;
  if (nextAction === "ask_question") {
    if (!question || askedKeys.includes(String(question.key))) throw new Error("semantic_duplicate_or_missing_question");
    if (askedKeys.length >= cap) throw new Error("semantic_question_cap_exceeded");
  } else if (question) throw new Error("semantic_question_after_terminal_state");
  if (nextAction === "build_plan" && evidence.done_definition_passed !== true) throw new Error("semantic_premature_completion");
  if (nextAction === "cautious_starter" && !Array.isArray(evidence.missing_facts)) throw new Error("semantic_starter_without_missing_evidence");
}

// supabase/functions/future-you-engine/index.ts
var OPENAI_URL = "https://api.openai.com/v1/responses";
var ENGINE_VERSION = "future-you-edge-v5.0-semantic";
var MODEL = "gpt-5.6-terra";
var LUNA_MODEL = "gpt-5.6-luna";
var REASONING_EFFORT = "low";
var MAX_GOALS = 3;
var BATCH_CONCURRENCY = 5;
var BATCH_VALIDATOR_VERSION = "future-you-batch-validator-v5.0-evidence";
var BATCH_TEST_SUITE_VERSION = "future-you-batch-suite-v5.0-semantic";
var BATCH_ANALYZER_VERSION = "future-you-batch-analyzer-v5.0-question-complete";
var ANALYZER_MODEL = "gpt-5.6-terra";
var ANALYZER_REVIEW_MODEL = "gpt-5.6-terra";
var TERRA_INPUT_USD_PER_MILLION = 2;
var TERRA_OUTPUT_USD_PER_MILLION = 12;
var LUNA_INPUT_USD_PER_MILLION = 1;
var LUNA_OUTPUT_USD_PER_MILLION = 6;
var CAMPAIGN_WARNING_USD = 20;
var CAMPAIGN_STOP_USD = 30;
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
function success(data, recordRevision = null) {
  return json(200, {
    request_id: crypto.randomUUID(),
    status: "success",
    data,
    error: null,
    record_revision: recordRevision
  });
}
function failure(statusCode, code, message, status = "error") {
  return json(statusCode, {
    request_id: crypto.randomUUID(),
    status,
    data: null,
    error: { code, message },
    record_revision: null
  });
}
function envKey(groupName, fallback) {
  try {
    const group = JSON.parse(Deno.env.get(groupName) ?? "{}");
    const mapped = group.default;
    if (typeof mapped === "string" && Deno.env.get(mapped)) return Deno.env.get(mapped);
  } catch {
  }
  return Deno.env.get(fallback) ?? "";
}
function getClients(authHeader) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const publishable = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secret = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const userClient = createClient(url, publishable, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return { userClient, admin };
}
async function getAuthorizedContext(req) {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) throw new ApiError(401, "missing_auth", "Sign in to continue.");
  const { userClient, admin } = getClients(authHeader);
  const token = authHeader.slice(7);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, "invalid_auth", "Your sign-in has expired. Please sign in again.");
  const { data: access, error: accessError } = await admin.from("tester_access").select("user_id,email,role,active").eq("user_id", data.user.id).eq("active", true).maybeSingle();
  if (accessError) throw accessError;
  if (!access) throw new ApiError(403, "tester_not_authorized", "This account is not authorized for the private Future You lab.");
  return { user: data.user, access, admin };
}
var ApiError = class extends Error {
  constructor(statusCode, code, message, responseStatus = "error", usage = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.responseStatus = responseStatus;
    this.usage = usage;
  }
  statusCode;
  code;
  responseStatus;
  usage;
};
function extractOutputText(response) {
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object" || item.type !== "message") continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part;
      if (p.type === "refusal") throw new ApiError(422, "model_refusal", "Future You could not safely build this response.", "stop_redirect");
      if (p.type === "output_text" && typeof p.text === "string") return p.text;
    }
  }
  throw new ApiError(502, "empty_model_output", "Future You did not return a usable response. Please try again.");
}
async function countOpenAIInputTokens(schemaName, schema, instructions, input, model = MODEL, reasoningEffort = REASONING_EFFORT) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new ApiError(503, "openai_not_configured", "The private AI engine is awaiting its secure OpenAI key.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15e3);
  let response;
  try {
    response = await fetch(`${OPENAI_URL}/input_tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        reasoning: { effort: reasoningEffort },
        instructions,
        input: JSON.stringify(input),
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema
          }
        }
      })
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(504, "openai_token_count_timeout", "Future You could not verify the intake token ceiling in time.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const raw = await response.json();
  if (!response.ok || !Number.isInteger(raw.input_tokens)) {
    throw new ApiError(502, "openai_token_count_failed", "Future You could not verify the intake token ceiling.");
  }
  return Number(raw.input_tokens);
}
async function callOpenAI(schemaName, schema, instructions, input, maxOutputTokens, model = MODEL, reasoningEffort = REASONING_EFFORT, timeoutMs = 9e4) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new ApiError(503, "openai_not_configured", "The private AI engine is awaiting its secure OpenAI key.");
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        reasoning: { effort: reasoningEffort },
        instructions,
        input: JSON.stringify(input),
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema
          }
        },
        max_output_tokens: maxOutputTokens,
        store: false
      })
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(504, "openai_timeout", "Future You took too long to answer. Your answer was not submitted, so it is safe to try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const raw = await response.json();
  if (!response.ok) {
    const providerError = raw.error && typeof raw.error === "object" ? raw.error : {};
    const detail = typeof providerError.message === "string" ? providerError.message : null;
    const providerCode = typeof providerError.code === "string" ? providerError.code.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) : "unknown";
    const diagnosticCode = `openai_${response.status}_${providerCode}`;
    console.error("OpenAI request failed", { status: response.status, code: providerCode, detail });
    throw new ApiError(
      response.status === 429 ? 429 : 502,
      diagnosticCode,
      "Future You is temporarily unavailable. No changes were saved."
    );
  }
  const usage = raw.usage ?? {};
  const usageRecord = {
    call_count: 1,
    input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
    output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0
  };
  if (raw.status === "incomplete") throw new ApiError(502, "model_incomplete", "Future You needs another try to complete this response.", "error", usageRecord);
  let parsed;
  try {
    parsed = JSON.parse(extractOutputText(raw));
  } catch (error) {
    if (error instanceof ApiError) {
      error.usage = error.usage ?? usageRecord;
      throw error;
    }
    throw new ApiError(502, "invalid_model_json", "Future You returned an incomplete structured response.", "error", usageRecord);
  }
  return {
    parsed,
    latencyMs: Date.now() - started,
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null
  };
}
async function callValidatedOpenAI(schemaName, schema, instructions, input, maxOutputTokens, validator, model = MODEL, reasoningEffort = REASONING_EFFORT, maxAttempts = 2, timeoutMs = 9e4) {
  let validationFailure = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const ai = await callOpenAI(
      schemaName,
      schema,
      instructions,
      attempt === 0 ? input : {
        ...input,
        validation_retry: {
          code: validationFailure?.code,
          failed_rule: validationFailure?.message,
          instruction: "Keep the underlying decision, rewrite the user-facing copy, and return a complete corrected result that passes every rule."
        }
      },
      maxOutputTokens,
      model,
      reasoningEffort,
      timeoutMs
    );
    try {
      validator(ai.parsed);
      return ai;
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode < 500 || attempt === maxAttempts - 1) throw error;
      validationFailure = error;
    }
  }
  throw validationFailure ?? new ApiError(502, "validation_failed", "Future You could not validate this response.");
}
var AIISH_COPY = [
  /establish a safe rhythm/i,
  /protect the .*start/i,
  /verify the (?:deadline )?math/i,
  /dedicated place/i,
  /reveal your .* today/i,
  /\boperationali[sz]e\b/i,
  /\bleverage\b/i,
  /\butilize\b/i,
  /\bcadence\b/i,
  /\bactionable\b/i,
  /\bthe user\b/i,
  /\bsafely save\b/i,
  /start a new path/i,
  /\bviability (?:check|status)\b/i,
  /\brepair path\b/i,
  /\bunresolved (?:variable|check)\b/i,
  /\bcoverage gate\b/i,
  /\bblueprint\b/i,
  /\bgoal calibration\b/i,
  /based on the information provided/i
];
var EXPERT_BURDEN_COPY = [
  /what (?:is|would be) the lowest .* you (?:feel|think)/i,
  /\b(?:calculate|work out|research|look up)\b.*\b(?:and tell me|for me|yourself)\b/i,
  /\bhow much .* (?:will|would) .* after taxes\b/i
];
var QUESTION_ABSTRACT_COPY = [
  /\bsetup\b/i,
  /\bapproach\b/i,
  /\bprotected\b/i,
  /\breliable\b/i,
  /\bfeasible\b/i,
  /\bpreference\b/i,
  /what feels right/i,
  /what works best/i,
  /what would work for you/i,
  /to help (?:me|us) (?:understand|build|plan)/i,
  /so (?:i|we) can (?:understand|build|plan)/i,
  /in order to/i,
  /moving forward/i
];
var QUESTION_STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "before",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "would",
  "you",
  "your"
]);
function normalizedQuestionTokens(value) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 1 && !QUESTION_STOP_WORDS.has(token)));
}
function questionsOverlap(left, right) {
  const a = normalizedQuestionTokens(left);
  const b = normalizedQuestionTokens(right);
  if (a.size === 0 || b.size === 0) return false;
  const shared = [...a].filter((token) => b.has(token)).length;
  const union = (/* @__PURE__ */ new Set([...a, ...b])).size;
  return left.trim().toLowerCase() === right.trim().toLowerCase() || shared >= 3 && shared / union >= 0.72;
}
function wordCount(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
function validatePlainLanguage(values) {
  const copy = values.filter((value) => typeof value === "string" && value.trim().length > 0);
  if (copy.some((value) => AIISH_COPY.some((pattern) => pattern.test(value)))) {
    throw new ApiError(502, "aiish_copy", "Future You produced wording that did not pass the plain-language gate.");
  }
  if (copy.some((value) => EXPERT_BURDEN_COPY.some((pattern) => pattern.test(value)))) {
    throw new ApiError(502, "expert_burden_copy", "The draft pushed an expert calculation back onto the person.");
  }
  if (copy.some((value) => (value.match(/\?/g) ?? []).length > 1)) {
    throw new ApiError(502, "multiple_questions_in_copy", "A user-facing sentence asked more than one question.");
  }
}
function validateQuestionWording(question, previousQuestionTexts, clarificationValidated = false) {
  const text = String(question.text ?? "").trim();
  const options = Array.isArray(question.options) ? question.options : [];
  if (text.length < 3 || text.length > 240 || wordCount(text) > 28) {
    throw new ApiError(502, "question_length", "The question was not brief enough for the wording layer.");
  }
  if (!text.endsWith("?") || (text.match(/\?/g) ?? []).length !== 1 || /[\r\n]/.test(text)) {
    throw new ApiError(502, "question_shape", "The wording layer did not return one direct question.");
  }
  if (!clarificationValidated && previousQuestionTexts.some((previous) => questionsOverlap(text, previous))) {
    throw new ApiError(502, "repeated_question_meaning", "The draft repeated a question that was already asked.");
  }
  if (QUESTION_ABSTRACT_COPY.some((pattern) => pattern.test(text))) {
    throw new ApiError(502, "abstract_question_copy", "The question used wording that requires interpretation.");
  }
  if (options.some((option) => String(option.label ?? "").trim().length > 110 || wordCount(String(option.label ?? "")) > 18)) {
    throw new ApiError(502, "option_length", "A response choice was too long for the wording layer.");
  }
  validatePlainLanguage([text, ...options.map((option) => option.label)]);
}
function buildTemporalContext(context) {
  const profile = context.profile;
  const timezone = typeof profile?.timezone === "string" ? profile.timezone : "America/New_York";
  const now = /* @__PURE__ */ new Date();
  let today = now.toISOString().slice(0, 10);
  try {
    today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
  }
  return { now_iso: now.toISOString(), today_date: today, timezone };
}
function localAnswerQuality(question, answer) {
  return assessSimulatedAnswerQuality(question, answer);
}
function validateSemanticPlanOrThrow(goal, plan) {
  try {
    validateSemanticPlan(goal, plan);
  } catch (error) {
    throw new ApiError(502, "semantic_intake_plan_invalid", error instanceof Error ? error.message : "The semantic intake plan failed validation.");
  }
}
async function createSemanticIntakePlan(engineInput) {
  const goal = String(engineInput.goal_text ?? "").trim();
  const temporal = record(engineInput.temporal_context);
  const initial = await callOpenAI(
    "future_you_semantic_intake_plan_v5",
    semanticIntakePlanSchema,
    semanticIntakeInstructions,
    {
      goal,
      intake_level: engineInput.intake_level,
      today_date: temporal.today_date,
      user_capacity_context: record(engineInput.profile),
      active_goal_count: array(engineInput.active_goals).length
    },
    2400,
    MODEL,
    "low",
    45e3
  );
  let plan = initial.parsed;
  const review = await callOpenAI(
    "future_you_semantic_question_review_v5",
    semanticQuestionReviewSchema,
    semanticQuestionReviewInstructions,
    {
      goal,
      goal_understanding: plan.goal_understanding,
      facts: plan.facts.map((fact) => ({ id: fact.id, label: fact.label, role: fact.role, status: fact.status, why_needed: fact.why_needed })),
      questions: plan.questions
    },
    1200,
    MODEL,
    "low",
    3e4
  );
  const reviewed = review.parsed;
  if (reviewed.pass !== true) throw new ApiError(502, "semantic_question_review_failed", "The complete intake question plan did not pass its quality review.");
  const reviewedQuestions = array(reviewed.questions);
  const originalIds = plan.questions.map((question) => `${question.id}:${question.fact_id}`).join("|");
  const reviewedIds = reviewedQuestions.map((question) => `${question.id}:${question.fact_id}`).join("|");
  if (originalIds !== reviewedIds) throw new ApiError(502, "semantic_review_changed_contract", "The question review changed the approved evidence contract.");
  plan = { ...plan, questions: reviewedQuestions };
  validateSemanticPlanOrThrow(goal, plan);
  return {
    plan,
    audit: { pass: reviewed.pass === true, issues: array(reviewed.issues), source: "luna_full_question_plan_review" },
    inputTokens: Number(initial.inputTokens ?? 0) + Number(review.inputTokens ?? 0),
    outputTokens: Number(initial.outputTokens ?? 0) + Number(review.outputTokens ?? 0),
    latencyMs: Number(initial.latencyMs ?? 0) + Number(review.latencyMs ?? 0),
    apiCallCount: 2
  };
}
async function runSemanticIntakeTurn(engineInput, context) {
  const priorPlan = record(context.previousBlueprint).semantic_intake_plan;
  let plan = priorPlan;
  let audit = { pass: true, issues: [], source: "persisted_semantic_question_plan" };
  let inputTokens = 0;
  let outputTokens = 0;
  let latencyMs = 0;
  let apiCallCount = 0;
  if (!plan) {
    const created = await createSemanticIntakePlan(engineInput);
    plan = created.plan;
    audit = created.audit;
    inputTokens = created.inputTokens;
    outputTokens = created.outputTokens;
    latencyMs = created.latencyMs;
    apiCallCount = created.apiCallCount;
  }
  const result = buildSemanticResult(
    String(engineInput.goal_text ?? ""),
    plan,
    array(engineInput.prior_turns).map(record),
    context.cap
  );
  try {
    validateSemanticResult(result, context.askedKeys, context.cap);
    const question = result.question;
    if (question) validateQuestionWording(question, context.previousQuestionTexts);
  } catch (error) {
    throw new ApiError(502, "semantic_intake_result_invalid", error instanceof Error ? error.message : "The semantic intake result failed validation.");
  }
  return {
    result,
    questionQuality: audit,
    inputTokens,
    outputTokens,
    latencyMs,
    attempts: apiCallCount,
    apiCallCount,
    apiUsed: apiCallCount > 0
  };
}
var questionQualityGateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["passed", "checks", "failed_check", "reason"],
  properties: {
    passed: { type: "boolean" },
    checks: {
      type: "object",
      additionalProperties: false,
      required: ["need", "impact", "evidence", "context", "clarity", "priority"],
      properties: {
        need: { type: "boolean" },
        impact: { type: "boolean" },
        evidence: { type: "boolean" },
        context: { type: "boolean" },
        clarity: { type: "boolean" },
        priority: { type: "boolean" }
      }
    },
    failed_check: { type: ["string", "null"], maxLength: 20 },
    reason: { type: "string", minLength: 3, maxLength: 240 }
  }
};
var questionQualityGateInstructions = `
You are an independent quality grader for exactly one proposed Future You intake question. You did not write this question and have no stake in it. Grade it strictly on its own merits; do not rationalize or defend it.

Judge these six checks against the goal, the missing fact, and everything already known:
- need: the question targets one genuinely missing fact, not something already known or safely inferable.
- impact: a real answer would change the named plan field or the completion decision (see why_it_changes_plan).
- evidence: the missing fact is not already answered, resolved, or already covered by known_context or facts_not_to_reask, even if phrased differently there.
- context: the wording is grounded in the real goal and known constraints; it does not invent a fact, assumption, or unrelated domain (for example a clinic, a document, or a family member) that known_context never mentioned.
- clarity: it asks exactly one natural, answerable thing in ordinary language, with exactly one question mark, and a person could answer it without interpreting jargon.
- priority: of everything still missing, this is a genuinely useful next question to ask now, not merely a technically acceptable one.

Set passed true only if every check is true. If any check fails, set passed false, set failed_check to the single most important failing check by name (need, impact, evidence, context, clarity, or priority), and give a short concrete reason a human reviewer could act on. If passed is true, set failed_check to null.
`;
async function gradeQuestionIndependently(question, goal) {
  const brief = record(question.brief);
  const input = {
    goal,
    main_topic: String(brief.main_topic ?? goal),
    known_context: array(brief.known_context).map(String),
    missing_fact: String(brief.missing_fact ?? question.fact_id ?? ""),
    why_it_changes_plan: String(brief.why_it_changes_plan ?? question.why_needed ?? ""),
    facts_not_to_reask: array(brief.facts_not_to_reask).map(String),
    question_text: String(question.text ?? ""),
    control: String(question.control ?? "text"),
    options: Array.isArray(question.options) ? question.options : []
  };
  const ai = await callOpenAI(
    "future_you_question_quality_gate_v1",
    questionQualityGateSchema,
    questionQualityGateInstructions,
    input,
    500,
    LUNA_MODEL,
    "low",
    3e4
  );
  const parsed = record(ai.parsed);
  const checks = record(parsed.checks);
  const sixChecks = ["need", "impact", "evidence", "context", "clarity", "priority"];
  const allChecksPassed = sixChecks.every((key) => checks[key] === true);
  const passed = parsed.passed === true && allChecksPassed;
  return {
    passed,
    checks,
    failed_check: passed ? null : String(parsed.failed_check ?? sixChecks.find((key) => checks[key] !== true) ?? "unspecified"),
    reason: String(parsed.reason ?? ""),
    inputTokens: Number(ai.inputTokens ?? 0),
    outputTokens: Number(ai.outputTokens ?? 0),
    latencyMs: Number(ai.latencyMs ?? 0)
  };
}
async function runLiveSemanticIntakeTurn(engineInput, context) {
  const goal = String(engineInput.goal_text ?? "").trim();
  const priorTurns = array(engineInput.prior_turns).map(record);
  const previousBlueprint = record(engineInput.previous_blueprint);
  const previousState = record(previousBlueprint.semantic_intake_state);
  const evidenceItems = buildEvidenceItems(goal, priorTurns);
  const baseInput = {
    operation: String(engineInput.operation ?? "intake_turn"),
    intake_level: String(engineInput.intake_level ?? "quick_start"),
    today_date: String(record(engineInput.temporal_context).today_date ?? ""),
    goal,
    evidence_items: evidenceItems,
    current_evidence_map: {
      goal_understanding: record(previousState.goal_understanding),
      facts: array(previousState.facts),
      completion_gate: record(previousState.completion_gate),
      required_plan_fields: array(previousState.required_plan_fields)
    },
    questions_asked: priorTurns.map((turn) => ({
      key: String(turn.question_key ?? ""),
      text: String(turn.question_text ?? turn.question ?? "")
    })),
    latest_answer: engineInput.latest_answer ?? null,
    safety_cap_reached: Number(context.questionCount ?? 0) >= Number(context.cap ?? 0)
  };
  // Independent quality gate: the question generator (this call) and the question
  // grader (gradeQuestionIndependently) are deliberately separate LUNA calls so the
  // same model invocation never both drafts and grades its own question. A failed
  // grade earns exactly one regeneration attempt; a second failure surfaces the
  // grader's reason instead of being silently recorded as passed.
  const MAX_QUESTION_ATTEMPTS = 2;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalLatencyMs = 0;
  let apiCallCount = 0;
  let countedInputTokens = 0;
  let result;
  let grade = null;
  let rejection = null;
  for (let attempt = 1; attempt <= MAX_QUESTION_ATTEMPTS; attempt += 1) {
    const attemptInput = rejection ? { ...baseInput, previously_rejected_question: rejection } : baseInput;
    try {
      countedInputTokens = await countOpenAIInputTokens(
        "future_you_live_intake_turn_v6",
        liveIntakeTurnSchema,
        liveIntakeInstructions,
        attemptInput,
        LUNA_MODEL,
        "low"
      );
      assertLiveInputTokenCeiling(countedInputTokens);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(413, "intake_input_limit_exceeded", `Future You intake exceeded its ${MAX_INTAKE_INPUT_TOKENS}-token input ceiling. The saved answer can be retried after the evidence map is compacted.`);
    }
    const ai = await callOpenAI(
      "future_you_live_intake_turn_v6",
      liveIntakeTurnSchema,
      liveIntakeInstructions,
      attemptInput,
      MAX_INTAKE_OUTPUT_TOKENS,
      LUNA_MODEL,
      "low",
      45e3
    );
    totalInputTokens += Number(ai.inputTokens ?? 0);
    totalOutputTokens += Number(ai.outputTokens ?? 0);
    totalLatencyMs += Number(ai.latencyMs ?? 0);
    apiCallCount += 1;
    try {
      result = validateAndBuildLiveResult({
        goal,
        output: ai.parsed,
        previousState,
        evidenceItems,
        previousQuestionTexts: array(context.previousQuestionTexts).map(String),
        previousTurns: priorTurns,
        questionCount: Number(context.questionCount ?? 0),
        cap: Number(context.cap ?? 0),
        intakeLevel: String(context.intakeLevel ?? engineInput.intake_level ?? "quick_start")
      });
      const draftedQuestion = result.question;
      if (draftedQuestion) validateQuestionWording(draftedQuestion, array(context.previousQuestionTexts).map(String), true);
    } catch (error) {
      throw new ApiError(502, "semantic_intake_result_invalid", error instanceof Error ? error.message : "The live intake result failed deterministic validation.", "error", {
        call_count: apiCallCount,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens
      });
    }
    const question = result.question;
    if (!question) {
      grade = null;
      break;
    }
    grade = await gradeQuestionIndependently(question, goal);
    totalInputTokens += grade.inputTokens;
    totalOutputTokens += grade.outputTokens;
    totalLatencyMs += grade.latencyMs;
    apiCallCount += 1;
    if (grade.passed) break;
    if (attempt === MAX_QUESTION_ATTEMPTS) {
      throw new ApiError(502, "question_quality_gate_failed", `The proposed question failed independent quality review on "${grade.failed_check}": ${grade.reason}`, "error", {
        call_count: apiCallCount,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens
      });
    }
    rejection = { question_text: question.text, failed_check: grade.failed_check, reason: grade.reason };
  }
  return {
    result,
    questionQuality: {
      pass: true,
      issues: [],
      source: "independent_luna_question_grader",
      checks: [
        "strict_schema",
        "one_question_maximum",
        "immutable_evidence_references",
        "completion_gate_proof",
        "required_plan_field_proof",
        "question_cap",
        "question_wording",
        "independent_quality_gate"
      ],
      grader: grade ? { checks: grade.checks, reason: grade.reason, model: LUNA_MODEL } : null,
      counted_input_tokens: countedInputTokens,
      input_token_ceiling: MAX_INTAKE_INPUT_TOKENS,
      output_token_ceiling: MAX_INTAKE_OUTPUT_TOKENS
    },
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    latencyMs: totalLatencyMs,
    attempts: apiCallCount,
    apiCallCount,
    apiUsed: true
  };
}
function validatePlanOutput(plan, hadViabilityRepair = false, cautiousStarter = false) {
  const days = plan.plan_days;
  if (!Array.isArray(days) || days.length !== 30) throw new ApiError(502, "invalid_plan_days", "The plan did not contain exactly 30 future days.");
  days.forEach((item, index) => {
    if (!item || typeof item !== "object" || item.day !== index + 1) {
      throw new ApiError(502, "invalid_plan_order", "The plan days were not in the required order.");
    }
  });
  const gap = plan.goal_gap;
  const areas = Array.isArray(gap?.areas) ? gap.areas : [];
  const computed = areas.reduce((sum, area) => sum + Number(area.score ?? 0), 0);
  if (areas.length !== 5 || computed !== gap.total) throw new ApiError(502, "invalid_goal_gap", "The Goal Gap calculation did not validate.");
  if ((hadViabilityRepair || cautiousStarter) && plan.path_mode !== "tiny_start") {
    throw new ApiError(502, "starter_not_tiny_start", "A repaired or cautious goal must begin with the smallest workable internal path mode.");
  }
  const step = plan.todays_step;
  const preview = plan.preview;
  const milestones = Array.isArray(plan.milestones) ? plan.milestones : [];
  const visibleDays = Array.isArray(plan.plan_days) ? plan.plan_days : [];
  const goal = plan.goal;
  validatePlainLanguage([
    preview?.headline,
    preview?.today,
    ...Array.isArray(preview?.near_term) ? preview.near_term : [],
    ...milestones.flatMap((milestone) => [milestone.title, milestone.evidence]),
    ...Array.isArray(plan.success_markers) ? plan.success_markers : [],
    ...visibleDays.flatMap((day) => [day.action, day.amount, day.anchor, day.minimum_version, day.success_marker]),
    goal?.operational_meaning,
    goal?.protected_intended_result,
    step?.action,
    step?.amount,
    step?.anchor,
    step?.minimum_version,
    step?.success_marker,
    step?.why,
    step?.how
  ]);
}
function deterministicFallbackPlan(input, hadViabilityRepair, cautiousStarter) {
  const goalText = String(input.goal_text ?? "Build this goal").trim();
  const route = input.route && typeof input.route === "object" ? input.route : {};
  const tag = String(route.tag ?? "life_admin_responsibilities");
  const bucket = String(route.bucket ?? "finish");
  const blueprint = input.blueprint && typeof input.blueprint === "object" ? input.blueprint : {};
  const unknown = Array.isArray(blueprint.unknown_essential) ? blueprint.unknown_essential.map(String) : [];
  const profile = input.profile && typeof input.profile === "object" ? input.profile : {};
  const constraints = Array.isArray(profile.constraints) ? profile.constraints.map(String) : [];
  const actionByTag = {
    health_movement: "Do the smallest planned movement session.",
    food_nourishment: "Prepare one part of the next planned meal.",
    sleep_rest: "Set one reminder for tonight's sleep step.",
    home_environment: "Work on one visible item in the chosen space.",
    work_career: "Complete one small part of the next work step.",
    learning_creativity: "Spend five minutes on the next lesson or practice step.",
    money_stability: "Move the smallest confirmed amount toward the goal.",
    relationships_communication: "Write one clear sentence for the next conversation.",
    emotional_state: "Use one planned response during the next difficult moment.",
    life_admin_responsibilities: "Complete one small part of the next required task."
  };
  const action = actionByTag[tag] ?? "Complete one small part of the next step.";
  const minimum = "Do one minute or one item.";
  const marker = "The small step is completed and recorded.";
  const pathMode = hadViabilityRepair || cautiousStarter ? "tiny_start" : "steady_build";
  const gapAreas = [
    { name: "Starting point", score: 1, evidence: "The goal has been stated." },
    { name: "Time", score: unknown.some((item) => /time|schedule|cadence/i.test(item)) ? 2 : 1, evidence: "The plan uses a small first step." },
    { name: "Access", score: unknown.some((item) => /access|resource/i.test(item)) ? 2 : 1, evidence: "Only confirmed access is used." },
    { name: "Pressure", score: constraints.length > 0 ? 2 : 1, evidence: constraints.length > 0 ? "Current responsibilities limit the starting load." : "No added pressure was confirmed." },
    { name: "Consistency", score: 1, evidence: "The first month begins with repeatable actions." }
  ];
  const total = gapAreas.reduce((sum, item) => sum + item.score, 0);
  const planDays = Array.from({ length: 30 }, (_, index) => ({
    day: index + 1,
    action,
    amount: "One small step",
    anchor: "At the first available time today",
    minimum_version: minimum,
    success_marker: marker
  }));
  return {
    goal: {
      goal_text: goalText,
      operational_meaning: `Make measurable progress on: ${goalText}`,
      protected_intended_result: goalText
    },
    safety_realism: {
      status: cautiousStarter ? "prepare" : "pass",
      boundaries: ["Do not exceed confirmed time, money, access, or health limits."],
      constraints,
      prepare_conditions: unknown
    },
    bucket_tag: { bucket, tag, rationale: "The route comes from the completed intake." },
    expert_logic: {
      domain_assumptions: unknown.length > 0 ? unknown.map((item) => `Still unknown: ${item}.`) : ["Known intake facts control the starting load."],
      normal_variation: ["A smaller version counts on a difficult day."],
      hard_boundaries: ["Do not raise the load without evidence that the current step fits."]
    },
    goal_gap: { areas: gapAreas, total, narrative: "The first plan closes the clearest confirmed gap without guessing." },
    capacity: {
      usable_time: "Only confirmed available time",
      access: ["Only confirmed tools and resources"],
      pressure: constraints.length > 0 ? "Current responsibilities are active." : "No additional pressure was confirmed.",
      constraints,
      pacing_preference: pathMode === "tiny_start" ? "Small and steady" : "Steady",
      cross_goal_load: "No additional goal load was supplied."
    },
    path_mode: pathMode,
    milestones: [
      { order: 1, title: "Complete the first small step", evidence: marker },
      { order: 2, title: "Repeat the step for one week", evidence: "Seven days are recorded." },
      { order: 3, title: "Review the month", evidence: "Thirty days are recorded." }
    ],
    plan_days: planDays,
    success_markers: [marker, "Seven days are recorded.", "Thirty days are recorded."],
    risk_constraints: {
      consequences: ["Reduce the next step if the current one does not fit."],
      what_cannot_change: constraints.length > 0 ? constraints : ["Required responsibilities remain protected."],
      safety_boundaries: ["Do not use unconfirmed money, time, access, or support."]
    },
    todays_step: {
      action,
      amount: "One small step",
      anchor: "At the first available time today",
      minimum_version: minimum,
      success_marker: marker,
      why: "This starts the goal without relying on missing information.",
      how: "Complete the smallest version, then record it.",
      note: unknown.length > 0 ? `Still needed: ${unknown.join(", ")}.` : null
    },
    preview: {
      headline: "Your first 30 days are ready.",
      today: action,
      near_term: ["Start with the smallest version.", "Repeat only what fits.", "Review the evidence after one week."]
    },
    evidence_summary: {
      plan_basis: ["Goal text", "Known intake answers", "Smallest workable starting action"],
      constraints_used: constraints,
      validation_notes: ["Thirty ordered days", "Five Goal Gap areas", ...unknown.length > 0 ? ["Missing facts are named in the plan."] : []]
    }
  };
}
async function buildPlanWithFallback(input, hadViabilityRepair, cautiousStarter) {
  try {
    return await callValidatedOpenAI(
      "future_you_plan_preview_v1",
      planPreviewSchema,
      planInstructions,
      input,
      28e3,
      (parsed) => validatePlanOutput(parsed, hadViabilityRepair, cautiousStarter)
    );
  } catch (error) {
    console.error("Future You used the deterministic plan fallback", { code: error instanceof ApiError ? error.code : "plan_generation_failed" });
    const parsed = deterministicFallbackPlan(input, hadViabilityRepair, cautiousStarter);
    validatePlanOutput(parsed, hadViabilityRepair, cautiousStarter);
    return { parsed, latencyMs: 0, inputTokens: 0, outputTokens: 0, fallbackUsed: true };
  }
}
var BATCH_CATEGORIES = [
  "health_movement",
  "food_nourishment",
  "sleep_rest",
  "home_environment",
  "work_career",
  "learning_creativity",
  "money_stability",
  "relationships_communication",
  "emotional_state",
  "life_admin_responsibilities"
];
function requireBatchAdmin(ctx) {
  if (String(ctx.access.role) !== "admin") throw new ApiError(403, "admin_required", "Batch Lab is limited to administrators.");
}
function stableSeed(value) {
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  return Math.floor(Date.now() / 1e3);
}
function choose(values, seed, offset = 0) {
  return values[Math.abs(seed + offset) % values.length];
}
function difficultyFor(seed, ordinal) {
  return choose(["ordinary", "ambiguous", "conflicting", "unrealistic", "constraint_heavy", "edge_case"], seed, ordinal);
}
function profileFor(seed, difficulty) {
  const responseStyle = difficulty === "ambiguous" ? choose(["vague", "uncertain", "skipped"], seed) : difficulty === "conflicting" ? "contradictory" : choose(["direct", "detailed", "changing"], seed, 7);
  return {
    available_minutes_per_day: choose([10, 20, 30, 45, 60], seed),
    available_days_per_week: choose([2, 3, 4, 5], seed, 3),
    capacity: difficulty === "constraint_heavy" ? "low" : choose(["moderate", "stable"], seed, 5),
    constraints: difficulty === "constraint_heavy" ? ["work schedule", "caregiving"] : [],
    monthly_available_amount: choose([75, 150, 300, 500], seed, 11),
    response_style: responseStyle,
    support_reliability: choose(["independent", "confirmed support", "unconfirmed support"], seed, 13)
  };
}
function normalizedGoal(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
async function makeBatchSpecs(body, ctx) {
  const requested = Number(body.requested_count ?? 10);
  if (![1, 10, 25, 50, 100].includes(requested)) throw new ApiError(400, "invalid_batch_size", "Choose 1, 10, 25, 50, or 100 cases.");
  const rawManual = Array.isArray(body.manual_goals) ? body.manual_goals : [];
  const manualGoals = rawManual.map(String).map((goal) => goal.trim()).filter((goal) => goal.length >= 3).slice(0, requested);
  const selected = Array.isArray(body.categories) ? body.categories.map(String).filter((tag) => BATCH_CATEGORIES.includes(tag)) : [];
  const categories = selected.length > 0 ? selected : BATCH_CATEGORIES;
  const baseSeed = stableSeed(body.seed);
  const intakeLevel = String(body.compartment) === "intake" ? String(body.intake_level ?? "quick_start") : "full_plan";
  if (String(body.compartment) === "intake" && !["quick_start", "full_plan"].includes(intakeLevel)) {
    throw new ApiError(400, "invalid_intake_level", "Choose Quick Start or Full Plan for intake testing.");
  }
  const proofTarget = ["action_plans", "end_to_end"].includes(String(body.compartment)) ? Math.max(1, Math.ceil(requested / 5)) : 0;
  const generatedNeeded = requested - manualGoals.length;
  const { data: priorRows, error: priorError } = await ctx.admin.from("future_you_batch_cases").select("input_goal").eq("user_id", ctx.user.id).order("created_at", { ascending: false }).limit(1e3);
  if (priorError) throw priorError;
  const excludedGoals = (priorRows ?? []).map((row) => String(row.input_goal ?? "")).filter(Boolean);
  let generated = [];
  let generationInputTokens = 0;
  let generationOutputTokens = 0;
  if (generatedNeeded > 0) {
    const generatedResult = await callValidatedOpenAI(
      "future_you_fresh_batch_goals_v1",
      generatedBatchGoalsSchema,
      generatedBatchGoalsInstructions,
      {
        requested_count: generatedNeeded,
        allowed_categories: categories,
        required_difficulty_mix: ["ordinary", "ambiguous", "conflicting", "unrealistic", "constraint_heavy", "edge_case"],
        excluded_goals: excludedGoals.slice(0, 500)
      },
      Math.max(2e3, generatedNeeded * 120),
      (parsed) => {
        const goals = Array.isArray(parsed.goals) ? parsed.goals : [];
        if (goals.length !== generatedNeeded) throw new ApiError(502, "batch_goal_count", "The fresh-goal generator returned the wrong number of goals.");
        const seen = new Set(excludedGoals.map(normalizedGoal));
        for (const item of goals) {
          const goal = String(item.goal ?? "").trim();
          const normalized = normalizedGoal(goal);
          if (goal.length < 8 || seen.has(normalized)) throw new ApiError(502, "batch_goal_reused", "A generated goal repeated a prior test goal.");
          if (!categories.includes(String(item.category))) throw new ApiError(502, "batch_goal_category", "A generated goal used a category outside this batch.");
          seen.add(normalized);
        }
      },
      MODEL,
      "medium",
      3,
      6e4
    );
    generated = generatedResult.parsed.goals ?? [];
    generationInputTokens = generatedResult.inputTokens ?? 0;
    generationOutputTokens = generatedResult.outputTokens ?? 0;
  }
  const specs = [];
  let generatedIndex = 0;
  for (let ordinal = 0; ordinal < requested; ordinal += 1) {
    const goal = manualGoals[ordinal];
    const source = goal ? "manual" : "generated";
    const generatedItem = goal ? null : generated[generatedIndex++];
    const inputGoal = goal ?? String(generatedItem?.goal ?? "");
    const route = classifyGoalLocally(inputGoal);
    const category = goal ? route.tag : String(generatedItem?.category ?? route.tag);
    const difficulty = goal ? difficultyFor(baseSeed, ordinal) : String(generatedItem?.difficulty ?? difficultyFor(baseSeed, ordinal));
    const proofSelected = proofTarget > 0 && Math.floor((ordinal + 1) * proofTarget / requested) > Math.floor(ordinal * proofTarget / requested);
    specs.push({
      stable_case_id: `FY-${baseSeed}-${String(ordinal + 1).padStart(3, "0")}`,
      seed: baseSeed + ordinal,
      source,
      category,
      bucket: route.bucket,
      difficulty,
      input_goal: inputGoal,
      input_payload: {
        intake_level: intakeLevel,
        test_mode: proofSelected ? "terra_plan_proof" : "rule_route_scan"
      },
      simulated_profile: profileFor(baseSeed + ordinal, difficulty),
      proof_selected: proofSelected
    });
  }
  return { requested, manualGoals, categories, baseSeed, specs, proofTarget, generationInputTokens, generationOutputTokens, intakeLevel };
}
// Simulator respondent: a genuine independent LUNA call constrained to one stable
// persona and this case's own answer history (its fact ledger), replacing the old
// keyword-regex answer generator. That regex generator is the confirmed source of
// the "unrelated primary-care clinic" defect - a scheduling question whose text
// loosely matched /clinic|doctor|provider|appointment/ got a canned clinic answer
// regardless of relevance. The respondent below answers only what was asked, may
// say it does not know, and is instructed never to introduce a fact or domain that
// the goal, persona, or its own prior answers did not already establish.
var simulatedRespondentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["unknown", "selected_option_ids", "text_value"],
  properties: {
    unknown: { type: "boolean" },
    selected_option_ids: { type: "array", maxItems: 6, items: { type: "string", maxLength: 60 } },
    text_value: { type: "string", maxLength: 300 }
  }
};
var simulatedRespondentInstructions = `
You are the sole simulated test respondent for one Future You intake case during automated testing. You are not a real user; you exist only to answer questions the way a consistent, real person with this exact persona would, so the testing team can judge whether the intake engine's questions are good.

You have a stable persona and a running fact ledger of every answer you have already given this session (prior_answers). Answer only the exact question asked.

Rules:
- Never introduce a fact, person, place, condition, document, or domain that the goal, the persona, or your own prior answers did not already establish. Do not invent specifics such as a clinic, a pet, a document, or a family member unless the goal or persona already mentions one.
- If the goal and persona genuinely do not establish an answer to this question, set unknown true instead of inventing a plausible-sounding fact.
- Stay consistent with every one of your own prior answers; never contradict a fact you already gave.
- For single_select or multi_select, choose only from the supplied option ids that fit your persona; put the id(s) in selected_option_ids and leave text_value empty. Choose exactly one id for single_select. Never choose an id named other.
- For every other control, put your answer in text_value as one direct, ordinary sentence or value, and leave selected_option_ids empty. When control is number, text_value must be a plain digit value with no words or units, for example 45 rather than 45 minutes.
- Let response_style shade tone only (for example a detailed respondent adds one relevant extra detail, a direct respondent stays terse); it must never justify inventing an unrelated fact.
`;
function mapSimulatedRespondentOutput(question, parsed) {
  const control = String(question.control ?? "text");
  const options = Array.isArray(question.options) ? question.options : [];
  const validIds = new Set(options.filter((option) => String(option.id) !== "other").map((option) => String(option.id)));
  const fallbackId = () => {
    const notSure = options.find((option) => ["not_sure", "i_have_not_asked_yet", "unknown"].includes(String(option.id)));
    const none = options.find((option) => String(option.id) === "none");
    return String((notSure ?? none ?? options[0])?.id ?? "none");
  };
  if (control === "single_select") {
    const chosen = array(parsed.selected_option_ids).map(String).find((id) => validIds.has(id));
    if (parsed.unknown || !chosen) return { value: fallbackId(), other_text: null };
    return { value: chosen, other_text: null };
  }
  if (control === "multi_select") {
    const chosen = [...new Set(array(parsed.selected_option_ids).map(String).filter((id) => validIds.has(id)))];
    if (parsed.unknown || !chosen.length) {
      const none = options.find((option) => String(option.id) === "none");
      return { value: [String(none?.id ?? fallbackId())], other_text: null };
    }
    return { value: chosen, other_text: null };
  }
  if (control === "number") {
    const numeric = parseNumber(String(parsed.text_value ?? "").trim());
    if (!parsed.unknown && numeric !== null) return { value: String(numeric), other_text: null };
    return { value: "1", other_text: null };
  }
  const text = parsed.unknown || !String(parsed.text_value ?? "").trim() ? "I do not know." : String(parsed.text_value).trim();
  return { value: text, other_text: null };
}
function usageFrom(ai) {
  return { inputTokens: Number(ai.inputTokens ?? 0), outputTokens: Number(ai.outputTokens ?? 0), latencyMs: Number(ai.latencyMs ?? 0) };
}
async function callSimulatedRespondent(question, spec, transcript) {
  const priorAnswers = array(transcript).slice(-8).map((turn) => ({
    question: String(turn.question ?? turn.question_text ?? ""),
    answer: answerText(record(turn.answer))
  })).filter((item) => item.question && item.answer);
  return await callOpenAI(
    "future_you_simulated_respondent_v1",
    simulatedRespondentSchema,
    simulatedRespondentInstructions,
    {
      goal: spec.input_goal,
      question_text: String(question.text ?? ""),
      control: String(question.control ?? "text"),
      options: (Array.isArray(question.options) ? question.options : []).filter((option) => String(option.id) !== "other"),
      persona: {
        available_minutes_per_day: spec.simulated_profile.available_minutes_per_day ?? 30,
        available_days_per_week: spec.simulated_profile.available_days_per_week ?? 3,
        capacity: spec.simulated_profile.capacity ?? "moderate",
        constraints: array(spec.simulated_profile.constraints).map(String),
        monthly_available_amount: spec.simulated_profile.monthly_available_amount ?? 150,
        support_reliability: spec.simulated_profile.support_reliability ?? "independent"
      },
      response_style: spec.simulated_profile.response_style ?? "direct",
      prior_answers: priorAnswers
    },
    400,
    LUNA_MODEL,
    "low",
    3e4
  );
}
async function generateAutomaticAnswer(question, spec, turn, transcript) {
  const control = String(question.control);
  const key = String(question.key ?? "");
  const responseStyle = String(spec.simulated_profile.response_style ?? "direct");
  const options = Array.isArray(question.options) ? question.options : [];
  if (control === "single_select") {
    const uncertainOpt = options.find((option) => ["not_sure", "i_have_not_asked_yet"].includes(String(option.id)));
    const contradictoryOpts = options.filter((option) => ["yes", "no"].includes(String(option.id)));
    const repairFallback = key.startsWith("rp13_") ? options.find((option) => String(option.id) === "lower_the_target") : null;
    if (repairFallback) return { answer: { value: String(repairFallback.id), other_text: null }, usage: null };
    if (responseStyle === "uncertain" && uncertainOpt) return { answer: { value: String(uncertainOpt.id), other_text: null }, usage: null };
    if (responseStyle === "contradictory" && contradictoryOpts.length > 0) {
      return { answer: { value: String(contradictoryOpts[turn % contradictoryOpts.length].id), other_text: null }, usage: null };
    }
    const ai = await callSimulatedRespondent(question, spec, transcript);
    return { answer: mapSimulatedRespondentOutput(question, record(ai.parsed)), usage: usageFrom(ai) };
  }
  if (control === "multi_select") {
    if (responseStyle === "skipped" && options.some((option) => String(option.id) === "none")) {
      return { answer: { value: ["none"], other_text: null }, usage: null };
    }
    const ai = await callSimulatedRespondent(question, spec, transcript);
    return { answer: mapSimulatedRespondentOutput(question, record(ai.parsed)), usage: usageFrom(ai) };
  }
  if (control === "number") {
    if (["u04", "ms02", "rp06"].includes(key)) return { answer: { value: String(spec.simulated_profile.monthly_available_amount ?? 150), other_text: null }, usage: null };
    if (["u06", "rp04"].includes(key)) return { answer: { value: String(spec.simulated_profile.available_minutes_per_day ?? 30), other_text: null }, usage: null };
  }
  if (control === "date") return { answer: { value: "2026-12-31", other_text: null }, usage: null };
  if (control === "time") return { answer: { value: "18:00", other_text: null }, usage: null };
  // Free-text (and any unmatched number control): vague/uncertain/skipped stay the same
  // fixed non-answers as before - a deliberate "won't engage" test behavior, not content
  // guessing. Everything else now comes from the AI respondent instead of keyword regex.
  if (responseStyle === "vague") return { answer: { value: turn % 2 === 0 ? "I just want it to be better." : "Whatever is realistic.", other_text: null }, usage: null };
  if (responseStyle === "uncertain") return { answer: { value: "I am not sure yet.", other_text: null }, usage: null };
  if (responseStyle === "skipped") return { answer: { value: "I do not know.", other_text: null }, usage: null };
  const ai = await callSimulatedRespondent(question, spec, transcript);
  let answer = mapSimulatedRespondentOutput(question, record(ai.parsed));
  const baseText = String(answer.value ?? "");
  if (responseStyle === "contradictory" && turn > 1) answer = { value: `${baseText} My schedule may not actually allow that every week.`, other_text: null };
  else if (responseStyle === "changing" && turn > 2) answer = { value: `${baseText} I am changing my earlier answer because this is the more realistic version.`, other_text: null };
  else if (responseStyle === "detailed") answer = { value: `${baseText} I need this to work around my current schedule and responsibilities.`, other_text: null };
  return { answer, usage: usageFrom(ai) };
}
async function simulateBatchIntake(spec, level) {
  const transcript = [];
  const trace = [];
  const askedKeys = [];
  const previousTexts = [];
  let previousBlueprint;
  let result = {};
  let hadRepair = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let callCount = 0;
  let latestAnswer = null;
  for (let turn = 0; turn < 24; turn += 1) {
    const question = result.question;
    const normalCount = askedKeys.filter((key2) => !key2.startsWith("rp") && !key2.startsWith("gc") && !key2.includes("_repair_")).length;
    const answeredTurn = transcript.length > 0 ? transcript[transcript.length - 1] : null;
    const answeredKind = String(answeredTurn?.kind ?? "");
    const answeredPhase = String(answeredTurn?.repair_phase ?? "");
    const dynamic = await runLiveSemanticIntakeTurn({
      operation: turn === 0 ? "start_batch_intake" : "continue_batch_intake",
      goal_text: spec.input_goal,
      intake_level: level,
      route_hint: { bucket: spec.bucket, tag: spec.category },
      temporal_context: { today_date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) },
      profile: spec.simulated_profile,
      active_goals: [],
      prior_turns: transcript,
      previous_blueprint: previousBlueprint ?? null,
      latest_answer: latestAnswer
    }, {
      askedKeys,
      questionCount: normalCount,
      cap: intakeCapForLevel(level),
      intakeLevel: level,
      previousBlueprint,
      repairPhase: answeredKind === "viability_repair" ? answeredPhase === "proposal" ? "verification" : answeredPhase : null,
      previousQuestionTexts: previousTexts,
      answeredCalibration: answeredKind === "goal_calibration"
    });
    result = dynamic.result;
    inputTokens += dynamic.inputTokens;
    outputTokens += dynamic.outputTokens;
    callCount += Number(dynamic.apiCallCount ?? 0);
    const nextQuestion = result.question;
    trace.push({
      turn: turn + 1,
      path: "semantic_evidence_intake_v6_dynamic",
      quality_gate: dynamic.questionQuality,
      next_action: result.next_action,
      coverage_passed: result.coverage?.gate_passed === true,
      viability_status: result.viability?.status
    });
    previousBlueprint = { ...result.blueprint, coverage: result.coverage, viability: result.viability, goal_calibration: result.goal_calibration };
    if (!nextQuestion) break;
    const respondent = await generateAutomaticAnswer(nextQuestion, spec, turn, transcript);
    const generatedAnswer = { answer: respondent.answer, fallbackUsed: false };
    if (respondent.usage) {
      inputTokens += respondent.usage.inputTokens;
      outputTokens += respondent.usage.outputTokens;
      callCount += 1;
    }
    const semantic = { review: localAnswerQuality(nextQuestion, generatedAnswer.answer) };
    const key = String(nextQuestion.key);
    hadRepair ||= String(nextQuestion.kind) === "viability_repair";
    transcript.push({
      sequence: turn + 1,
      question_key: key,
      question: nextQuestion.text,
      control: nextQuestion.control,
      options: nextQuestion.options,
      answer: generatedAnswer.answer,
      answer_quality: semantic?.review ?? { valid: true, direct_selection: true },
      response_style: spec.simulated_profile.response_style,
      kind: nextQuestion.kind,
      repair_phase: nextQuestion.repair_phase,
      route_decision: result.next_action
    });
    askedKeys.push(key);
    previousTexts.push(String(nextQuestion.text));
    latestAnswer = { question_key: key, question: nextQuestion.text, answer: generatedAnswer.answer, semantic_review: semantic?.review ?? null };
  }
  return { result, transcript, trace, hadRepair, inputTokens, outputTokens, callCount };
}
function batchCaseSpec(row) {
  return {
    stable_case_id: String(row.stable_case_id),
    seed: Number(row.seed),
    source: row.source,
    category: row.category,
    bucket: row.bucket,
    difficulty: row.difficulty,
    input_goal: String(row.input_goal),
    input_payload: record(row.input_payload),
    simulated_profile: record(row.simulated_profile),
    proof_selected: row.proof_selected === true,
    parent_case_id: typeof row.parent_case_id === "string" ? row.parent_case_id : null
  };
}
function batchRuntime(row) {
  const payload = record(row.input_payload);
  const saved = record(payload._batch_runtime);
  return {
    phase: typeof saved.phase === "string" ? saved.phase : "intake_engine",
    turn: Number(saved.turn ?? 0),
    asked_keys: array(saved.asked_keys).map(String),
    previous_texts: array(saved.previous_texts).map(String),
    previous_blueprint: saved.previous_blueprint ? record(saved.previous_blueprint) : null,
    latest_answer: saved.latest_answer ? record(saved.latest_answer) : null,
    result: saved.result ? record(saved.result) : {},
    had_repair: saved.had_repair === true,
    input_tokens: Number(saved.input_tokens ?? 0),
    output_tokens: Number(saved.output_tokens ?? 0),
    call_count: Number(saved.call_count ?? 0),
    elapsed_ms: Number(saved.elapsed_ms ?? 0)
  };
}
function isProviderFailure(error) {
  const code = error instanceof ApiError ? error.code : "unexpected_batch_error";
  return /openai|timeout|rate|internal|unavailable|empty_model|model_incomplete/.test(code);
}
function resumableBatchPatch(row, runtime, transcript, trace, result) {
  const inputPayload = { ...record(row.input_payload), _batch_runtime: runtime };
  const inputTokens = Number(runtime.input_tokens ?? 0);
  const outputTokens = Number(runtime.output_tokens ?? 0);
  return {
    status: "running",
    input_payload: inputPayload,
    transcript,
    output: { intake: result, plan_proof: row.proof_selected === true ? "selected" : "route_scan_only" },
    engine_trace: trace,
    validation: { passed: false, checks: ["in_progress"] },
    failure_codes: [],
    failure_explanations: [],
    timing: { total_ms: Number(runtime.elapsed_ms ?? 0), phase: runtime.phase, turn: runtime.turn },
    // advanceIntakeBatchCase only ever runs the intake phase (question generation,
    // the independent grader, and the simulated respondent) - every token counted
    // here is a LUNA call, not Terra.
    api_usage: { call_count: Number(runtime.call_count ?? 0), input_tokens: inputTokens, output_tokens: outputTokens, model: LUNA_MODEL, reasoning_effort: REASONING_EFFORT },
    estimated_cost_usd: modelCost(LUNA_MODEL, inputTokens, outputTokens)
  };
}
function terminalBatchPatch(row, runtime, transcript, trace, result, error) {
  const inputPayload = { ...record(row.input_payload), _batch_runtime: { ...runtime, phase: "done" } };
  const inputTokens = Number(runtime.input_tokens ?? 0);
  const outputTokens = Number(runtime.output_tokens ?? 0);
  const providerFailure = error ? isProviderFailure(error) : false;
  const warning = !error && ["prepare", "stop_redirect"].includes(String(result.next_action));
  const code = error instanceof ApiError ? error.code : error ? "unexpected_batch_error" : warning ? "intake_requires_review" : null;
  const explanation = error instanceof Error ? error.message : warning ? "The engine returned a safe stop or preparation route that needs reviewer inspection." : null;
  return {
    status: error ? providerFailure ? "system_error" : "failed" : warning ? "warning" : "passed",
    input_payload: inputPayload,
    transcript,
    output: { intake: result, plan_proof: row.proof_selected === true ? "selected" : "route_scan_only" },
    engine_trace: trace,
    validation: error ? { passed: false } : { passed: true, checks: ["schema", "coverage", "viability", "plain_language", "immutable_records"] },
    failure_codes: code ? [code] : [],
    failure_explanations: explanation ? [explanation] : [],
    timing: { total_ms: Number(runtime.elapsed_ms ?? 0), phase: "done", turn: runtime.turn },
    api_usage: { call_count: Number(runtime.call_count ?? 0), input_tokens: inputTokens, output_tokens: outputTokens, model: LUNA_MODEL, reasoning_effort: REASONING_EFFORT },
    estimated_cost_usd: modelCost(LUNA_MODEL, inputTokens, outputTokens),
    completed_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function advanceIntakeBatchCase(row) {
  const spec = batchCaseSpec(row);
  const runtime = batchRuntime(row);
  const transcript = array(row.transcript).map(record);
  const trace = array(row.engine_trace).map(record);
  const stepStarted = Date.now();
  const level = String(spec.input_payload.intake_level) === "full_plan" ? "full_plan" : "quick_start";
  const saveProgress = (result = record(runtime.result)) => {
    runtime.elapsed_ms = Number(runtime.elapsed_ms ?? 0) + (Date.now() - stepStarted);
    return resumableBatchPatch(row, runtime, transcript, trace, result);
  };
  const finish = (result = record(runtime.result), error) => {
    runtime.elapsed_ms = Number(runtime.elapsed_ms ?? 0) + (Date.now() - stepStarted);
    return terminalBatchPatch(row, runtime, transcript, trace, result, error);
  };
  try {
    if (runtime.phase === "intake_engine") {
      const askedKeys = array(runtime.asked_keys).map(String);
      const previousTexts = array(runtime.previous_texts).map(String);
      const previousBlueprint = runtime.previous_blueprint ? record(runtime.previous_blueprint) : void 0;
      const answeredTurn = transcript.length > 0 ? transcript[transcript.length - 1] : null;
      const answeredKind = String(answeredTurn?.kind ?? "");
      const answeredPhase = String(answeredTurn?.repair_phase ?? "");
      const normalCount = askedKeys.filter((key2) => !key2.startsWith("rp") && !key2.startsWith("gc") && !key2.includes("_repair_")).length;
      const engineInput = {
        operation: Number(runtime.turn ?? 0) === 0 ? "start_batch_intake" : "continue_batch_intake",
        goal_text: spec.input_goal,
        intake_level: level,
        route_hint: { bucket: spec.bucket, tag: spec.category },
        temporal_context: { today_date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) },
        profile: spec.simulated_profile,
        active_goals: [],
        prior_turns: transcript,
        previous_blueprint: previousBlueprint ?? null,
        latest_answer: runtime.latest_answer ?? null
      };
      const canonical = await runLiveSemanticIntakeTurn(engineInput, {
        askedKeys,
        questionCount: normalCount,
        cap: intakeCapForLevel(level),
        intakeLevel: level,
        previousBlueprint,
        repairPhase: answeredKind === "viability_repair" ? answeredPhase === "proposal" ? "verification" : answeredPhase : null,
        previousQuestionTexts: previousTexts,
        answeredCalibration: answeredKind === "goal_calibration"
      });
      runtime.input_tokens = Number(runtime.input_tokens ?? 0) + Number(canonical.inputTokens ?? 0);
      runtime.output_tokens = Number(runtime.output_tokens ?? 0) + Number(canonical.outputTokens ?? 0);
      runtime.call_count = Number(runtime.call_count ?? 0) + Number(canonical.apiCallCount ?? 0);
      const result = canonical.result;
      runtime.result = result;
      runtime.previous_blueprint = { ...record(result.blueprint), coverage: result.coverage, viability: result.viability, goal_calibration: result.goal_calibration };
      trace.push({
        turn: Number(runtime.turn ?? 0) + 1,
        path: "semantic_evidence_intake_v6_dynamic",
        quality_gate: canonical.questionQuality,
        next_action: result.next_action,
        coverage_passed: result.coverage?.gate_passed === true,
        viability_status: result.viability?.status
      });
      const question = result.question;
      if (!question) {
        runtime.phase = "done";
        return finish(result);
      }
      const respondent = await generateAutomaticAnswer(question, spec, Number(runtime.turn ?? 0), transcript);
      const answer = respondent.answer;
      if (respondent.usage) {
        runtime.input_tokens = Number(runtime.input_tokens ?? 0) + Number(respondent.usage.inputTokens ?? 0);
        runtime.output_tokens = Number(runtime.output_tokens ?? 0) + Number(respondent.usage.outputTokens ?? 0);
        runtime.call_count = Number(runtime.call_count ?? 0) + 1;
      }
      const semantic = { review: localAnswerQuality(question, answer) };
      const key = String(question.key);
      runtime.had_repair = runtime.had_repair === true || String(question.kind) === "viability_repair";
      transcript.push({ sequence: Number(runtime.turn ?? 0) + 1, question_key: key, target_fact_id: String(record(question.brief).missing_fact_key ?? ""), question: question.text, control: question.control, options: question.options, answer, answer_quality: semantic?.review ?? { valid: true, direct_selection: true }, response_style: spec.simulated_profile.response_style, kind: question.kind, repair_phase: question.repair_phase, route_decision: result.next_action });
      runtime.asked_keys = [...array(runtime.asked_keys).map(String), key];
      runtime.previous_texts = [...array(runtime.previous_texts).map(String), String(question.text)];
      runtime.latest_answer = { question_key: key, question: question.text, answer, semantic_review: semantic?.review ?? null };
      runtime.turn = Number(runtime.turn ?? 0) + 1;
      runtime.phase = "intake_engine";
      if (Number(runtime.turn) >= 24) throw new ApiError(502, "batch_turn_limit", "The simulated intake exceeded the 24-turn safety limit.");
      return saveProgress(result);
    }
    throw new ApiError(500, "invalid_batch_runtime_phase", "The batch runtime reached an unknown phase.");
  } catch (error) {
    if (error instanceof ApiError && error.usage) {
      const usage = addIntakeUsage({
        call_count: runtime.call_count,
        input_tokens: runtime.input_tokens,
        output_tokens: runtime.output_tokens
      }, error.usage);
      runtime.call_count = usage.call_count;
      runtime.input_tokens = usage.input_tokens;
      runtime.output_tokens = usage.output_tokens;
    }
    return finish(record(runtime.result), error);
  }
}
async function buildBatchPlan(spec, intake) {
  const result = intake.result;
  if (!["build_plan", "cautious_starter"].includes(String(result.next_action))) {
    throw new ApiError(422, "plan_not_ready", "The simulated intake did not pass coverage and viability.");
  }
  const planInput = {
    operation: "build_isolated_batch_plan",
    goal_text: spec.input_goal,
    intake_level: spec.input_payload.intake_level,
    route: result.route,
    blueprint: result.blueprint,
    fact_ledger: result.fact_ledger,
    cautious_starter: result.cautious_starter,
    temporal_context: { today_date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) },
    viability_repair_occurred: intake.hadRepair,
    profile: spec.simulated_profile,
    active_goals: []
  };
  const ai = await buildPlanWithFallback(planInput, intake.hadRepair, result.cautious_starter === true);
  return ai;
}
function sampleProgressPlan(spec) {
  return {
    goal: { text: spec.input_goal },
    revision: 1,
    plan_days: Array.from({ length: 30 }, (_, index) => ({
      day: index + 1,
      action: `Work on ${spec.category.replaceAll("_", " ")}`,
      minimum_version: "Do five minutes.",
      completed: index < 2
    }))
  };
}
function progressInputFor(spec) {
  const results = ["completed", "partially_completed", "not_today"];
  const reasons = ["time", "capacity", "access", "emotion", "external_difficulty"];
  return {
    result: choose(results, spec.seed),
    reason: choose(reasons, spec.seed, 2),
    detail: `Simulated ${spec.difficulty} progress evidence.`,
    validation_should_fail: spec.difficulty === "edge_case" && spec.seed % 4 === 0
  };
}
async function executeBatchCase(row, compartment) {
  const spec = {
    stable_case_id: String(row.stable_case_id),
    seed: Number(row.seed),
    source: row.source,
    category: row.category,
    bucket: row.bucket,
    difficulty: row.difficulty,
    input_goal: String(row.input_goal),
    input_payload: row.input_payload,
    simulated_profile: row.simulated_profile,
    proof_selected: row.proof_selected === true,
    parent_case_id: typeof row.parent_case_id === "string" ? row.parent_case_id : null
  };
  const started = Date.now();
  let transcript = [];
  let trace = [];
  let output = null;
  // Luna covers intake generation, the independent grader, and the simulated
  // respondent; Terra covers Action Plan generation only. They are tracked
  // separately so estimated_cost_usd and api_usage report real stage cost instead
  // of mispricing Luna-rate tokens at the (higher) Terra rate or vice versa.
  let lunaInputTokens = 0;
  let lunaOutputTokens = 0;
  let terraInputTokens = 0;
  let terraOutputTokens = 0;
  let callCount = 0;
  try {
    let plan = null;
    if (["intake", "action_plans", "end_to_end"].includes(compartment)) {
      const intake = await simulateBatchIntake(spec, compartment === "intake" ? "quick_start" : "full_plan");
      transcript = intake.transcript;
      trace = intake.trace;
      lunaInputTokens += intake.inputTokens;
      lunaOutputTokens += intake.outputTokens;
      callCount += intake.callCount;
      output = {
        intake: intake.result,
        plan_proof: spec.proof_selected ? "selected" : "route_scan_only"
      };
      if (["action_plans", "end_to_end"].includes(compartment) && spec.proof_selected) {
        const ai = await buildBatchPlan(spec, intake);
        plan = ai.parsed;
        terraInputTokens += ai.inputTokens ?? 0;
        terraOutputTokens += ai.outputTokens ?? 0;
        callCount += 1;
        output = { ...output, plan };
        trace.push({ stage: "action_plan", model: MODEL, validation: "passed" });
      } else if (["action_plans", "end_to_end"].includes(compartment)) {
        trace.push({ stage: "action_plan", validation: "not_selected_for_paid_proof" });
      }
    }
    if (["progress_updates", "end_to_end"].includes(compartment)) {
      const original = plan ?? sampleProgressPlan(spec);
      const progress = applyProgressUpdate(original, original, [], progressInputFor(spec));
      if (!progress.valid) {
        const unchanged = JSON.stringify(progress.live_plan) === JSON.stringify(original);
        if (!unchanged) throw new ApiError(502, "failed_progress_changed_plan", "A failed progress validation changed the Live Plan.");
      }
      output = { ...output ?? {}, progress };
      trace.push({ stage: "progress_update", decision: progress.decision, validation: progress.valid ? "passed" : "rejected_without_mutation" });
    }
    const warnings = compartment === "intake" && ["prepare", "stop_redirect"].includes(String((output?.intake ?? {}).next_action)) ? ["intake_requires_review"] : [];
    const cost = modelCost(LUNA_MODEL, lunaInputTokens, lunaOutputTokens) + modelCost(MODEL, terraInputTokens, terraOutputTokens);
    return {
      status: warnings.length ? "warning" : "passed",
      transcript,
      output,
      engine_trace: trace,
      validation: { passed: true, checks: ["schema", "coverage", "viability", "plain_language", "immutable_records"] },
      failure_codes: warnings,
      failure_explanations: warnings.map(() => "The engine returned a safe stop or preparation route that needs reviewer inspection."),
      timing: { total_ms: Date.now() - started },
      api_usage: {
        call_count: callCount,
        input_tokens: lunaInputTokens + terraInputTokens,
        output_tokens: lunaOutputTokens + terraOutputTokens,
        luna_input_tokens: lunaInputTokens,
        luna_output_tokens: lunaOutputTokens,
        terra_input_tokens: terraInputTokens,
        terra_output_tokens: terraOutputTokens,
        model: LUNA_MODEL,
        plan_model: MODEL,
        reasoning_effort: REASONING_EFFORT
      },
      estimated_cost_usd: cost
    };
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "unexpected_batch_error";
    const systemError = /openai|timeout|rate|internal|unavailable|empty_model|model_incomplete/.test(code);
    return {
      status: systemError ? "system_error" : "failed",
      transcript,
      output,
      engine_trace: trace,
      validation: { passed: false },
      failure_codes: [code],
      failure_explanations: [error instanceof Error ? error.message : "The case failed unexpectedly."],
      timing: { total_ms: Date.now() - started },
      // Tokens burned before the failure (Luna and/or Terra) are still counted here,
      // not dropped - a failed grader or respondent call cost real money too.
      api_usage: {
        call_count: callCount,
        input_tokens: lunaInputTokens + terraInputTokens,
        output_tokens: lunaOutputTokens + terraOutputTokens,
        luna_input_tokens: lunaInputTokens,
        luna_output_tokens: lunaOutputTokens,
        terra_input_tokens: terraInputTokens,
        terra_output_tokens: terraOutputTokens,
        model: LUNA_MODEL,
        plan_model: MODEL,
        reasoning_effort: REASONING_EFFORT
      },
      estimated_cost_usd: modelCost(LUNA_MODEL, lunaInputTokens, lunaOutputTokens) + modelCost(MODEL, terraInputTokens, terraOutputTokens)
    };
  }
}
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function array(value) {
  return Array.isArray(value) ? value : [];
}
function inspectBatchCase(item) {
  const findings = [];
  const output = record(item.output);
  const intake = record(output.intake);
  const plan = record(output.plan);
  const transcript = array(item.transcript).map(record);
  const profile = record(item.simulated_profile);
  const add = (finding) => findings.push(finding);
  if (item.status === "system_error") add({
    code: "system_execution_error",
    stage: "system_reliability",
    severity: "critical",
    title: "The engine did not finish the case",
    summary: "A system failure prevented a usable test result.",
    evidence: array(item.failure_explanations).map(String).join(" ") || "System error status returned.",
    recommendation: "Resolve the provider or execution failure, then rerun the exact case before judging product logic."
  });
  if (item.status === "failed") add({
    code: "engine_validation_failure",
    stage: "validation",
    severity: "high",
    title: "The case failed validation",
    summary: "The engine returned output that did not pass its contract.",
    evidence: array(item.failure_explanations).map(String).join(" ") || "Failed status returned.",
    recommendation: "Use the failure code and trace to repair the responsible validator or engine stage."
  });
  const normalizedQuestions = transcript.map((turn) => String(turn.question ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  if (new Set(normalizedQuestions).size !== normalizedQuestions.length) add({
    code: "duplicate_intake_question",
    stage: "question_selection",
    severity: "high",
    title: "Future You repeated an intake question",
    summary: "The same question appeared more than once in one route.",
    evidence: "Duplicate normalized question text was found in the transcript.",
    recommendation: "Add the prior-question fingerprint to the selection gate before the next question is committed."
  });
  if (transcript.length > 10) add({
    code: "intake_question_cap_exceeded",
    stage: "question_selection",
    severity: "high",
    title: "The intake exceeded its question cap",
    summary: "This route asked more questions than the approved full-plan maximum.",
    evidence: `${transcript.length} questions were asked.`,
    recommendation: "Re-rank missing facts and stop once the plan can be built without guessing."
  });
  const responseStyle = String(profile.response_style ?? "direct");
  if (["vague", "uncertain", "skipped"].includes(responseStyle) && String(intake.next_action) === "build_plan" && transcript.length < 3) add({
    code: "insufficient_followup_for_weak_answers",
    stage: "answer_handling",
    severity: "high",
    title: "Weak user answers were accepted too quickly",
    summary: "The simulator gave vague or uncertain answers, but the intake moved to planning with little clarification.",
    evidence: `${responseStyle} response pattern; ${transcript.length} question(s) asked.`,
    recommendation: "Require one targeted follow-up when an essential fact remains vague, uncertain, or skipped."
  });
  const proofSelected = item.proof_selected === true;
  if (proofSelected && Object.keys(plan).length === 0) add({
    code: "selected_plan_proof_missing",
    stage: "action_plan",
    severity: "critical",
    title: "A selected plan proof has no plan",
    summary: "This case was chosen for paid plan proof but did not produce a reviewable plan.",
    evidence: "proof_selected=true and output.plan is empty.",
    recommendation: "Treat the case as failed and rerun it after repairing the plan-generation path."
  });
  if (Object.keys(plan).length > 0) {
    const bucketTag = record(plan.bucket_tag);
    const intakeRoute = record(intake.route);
    if (String(bucketTag.bucket) !== String(intakeRoute.bucket) || String(bucketTag.tag) !== String(intakeRoute.tag)) add({
      code: "classification_plan_mismatch",
      stage: "goal_classification",
      severity: "high",
      title: "The plan changed the goal classification",
      summary: "The final plan bucket or category does not match the route that built the intake.",
      evidence: `Route: ${intakeRoute.bucket}/${intakeRoute.tag}; plan: ${bucketTag.bucket}/${bucketTag.tag}.`,
      recommendation: "Lock the approved route into plan generation or require explicit reclassification evidence."
    });
    const gap = record(plan.goal_gap);
    const areas = array(gap.areas).map(record);
    const calculatedGap = areas.reduce((sum, area) => sum + Number(area.score ?? 0), 0);
    if (areas.length !== 5 || calculatedGap !== Number(gap.total)) add({
      code: "goal_gap_math_invalid",
      stage: "gap_reasoning",
      severity: "critical",
      title: "Goal Gap scoring does not reconcile",
      summary: "The Goal Gap areas and total do not mathematically match.",
      evidence: `${areas.length} areas; calculated ${calculatedGap}; reported ${gap.total}.`,
      recommendation: "Calculate the total in code from validated area scores instead of trusting generated arithmetic."
    });
    if (!String(gap.narrative ?? "").trim()) add({
      code: "goal_gap_explanation_missing",
      stage: "gap_reasoning",
      severity: "medium",
      title: "Goal Gap has no usable explanation",
      summary: "The score is not connected to a plain-language reason.",
      evidence: "goal_gap.narrative is empty.",
      recommendation: "Require the narrative to name the largest confirmed gap and the fact that caused it."
    });
    const milestones = array(plan.milestones).map(record);
    const milestoneOrderValid = milestones.length > 0 && milestones.every((milestone, index) => Number(milestone.order) === index + 1);
    if (!milestoneOrderValid) add({
      code: "milestone_sequence_invalid",
      stage: "milestones",
      severity: "high",
      title: "Milestones are missing or out of order",
      summary: "The milestone ladder does not form a valid sequence.",
      evidence: `Milestone orders: ${milestones.map((milestone) => String(milestone.order)).join(", ") || "none"}.`,
      recommendation: "Generate milestone order deterministically and validate each evidence statement before display."
    });
    const days = array(plan.plan_days).map(record);
    if (days.length !== 30 || !days.every((day, index) => Number(day.day) === index + 1)) add({
      code: "thirty_day_sequence_invalid",
      stage: "plan_sequence",
      severity: "critical",
      title: "The 30-day sequence is incomplete",
      summary: "The plan does not contain exactly 30 correctly ordered days.",
      evidence: `${days.length} plan day(s) were returned.`,
      recommendation: "Reject the plan before saving unless all 30 numbered days validate."
    });
    const today = record(plan.todays_step);
    const dayOne = days[0] ?? {};
    if (String(today.action ?? "").trim() !== String(dayOne.action ?? "").trim() || String(today.amount ?? "").trim() !== String(dayOne.amount ?? "").trim()) add({
      code: "today_step_day_one_mismatch",
      stage: "cross_field_consistency",
      severity: "high",
      title: "Today\u2019s Step conflicts with Day 1",
      summary: "The immediate instruction and the first plan day are not the same commitment.",
      evidence: `Today: ${today.action ?? "missing"}; Day 1: ${dayOne.action ?? "missing"}.`,
      recommendation: "Derive Today\u2019s Step from the validated Day 1 object after plan generation."
    });
    if (array(plan.success_markers).length === 0 || days.some((day) => !String(day.success_marker ?? "").trim())) add({
      code: "success_markers_incomplete",
      stage: "success_markers",
      severity: "high",
      title: "Success is not measurable throughout the plan",
      summary: "One or more plan steps do not state what completion looks like.",
      evidence: "The plan-level or day-level success marker set is incomplete.",
      recommendation: "Require an observable success marker for the goal and every daily action."
    });
    if (!Array.isArray(plan.rollback_rules) || plan.rollback_rules.length === 0) add({
      code: "rollback_rules_missing",
      stage: "rollback_rules",
      severity: "medium",
      title: "The plan has no rollback rules",
      summary: "The approved Future You contract expects a safe response when an increased path does not hold.",
      evidence: "No rollback_rules field is present in the plan.",
      recommendation: "Add explicit revert conditions and the last stable path to the plan contract before automatic progression is enabled."
    });
    const serializedPlan = JSON.stringify(plan).toLowerCase();
    const constraints = array(profile.constraints).map((constraint) => String(constraint).toLowerCase());
    const missingConstraints = constraints.filter((constraint) => !serializedPlan.includes(constraint));
    if (missingConstraints.length > 0) add({
      code: "confirmed_constraint_not_used",
      stage: "personalization",
      severity: "high",
      title: "The plan missed a confirmed constraint",
      summary: "Information supplied by the simulated user did not visibly shape the plan.",
      evidence: `Missing from plan: ${missingConstraints.join(", ")}.`,
      recommendation: "Map every confirmed non-negotiable to capacity, risk constraints, or step placement before plan approval."
    });
  }
  const progress = record(output.progress);
  if (Object.keys(progress).length > 0 && progress.valid === false) {
    const original = record(progress.original_plan);
    const live = record(progress.live_plan);
    if (Object.keys(original).length > 0 && JSON.stringify(original) !== JSON.stringify(live)) add({
      code: "rejected_progress_changed_plan",
      stage: "progress_update",
      severity: "critical",
      title: "A rejected update changed the plan",
      summary: "A failed progress validation must leave the live plan untouched.",
      evidence: "The rejected update returned a different live plan.",
      recommendation: "Enforce atomic validation before any live-plan mutation."
    });
  }
  return findings;
}
function findingAppliesToCompartment(finding, compartment) {
  if (compartment !== "intake") return true;
  const code = String(finding.code ?? "").toUpperCase();
  return ![
    "MISSING_FINAL_PLAN",
    "NO_FINAL_PLAN",
    "PLAN_INCOMPLETE",
    "NO_ACTIONABLE_FINAL_PLAN",
    "PREMATURE_STOP_NO_PLAN"
  ].includes(code);
}
async function inspectBatchQuestionsWithAI(items, compartment) {
  const ai = await callOpenAI(
    "future_you_complete_question_audit_v5",
    batchQuestionAuditSchema,
    `${batchQuestionAuditInstructions}

Testing compartment: ${compartment}. Judge only that compartment.`,
    {
      cases: items.map((item) => ({
        testing_compartment: compartment,
        id: item.id,
        input_goal: item.input_goal,
        difficulty: item.difficulty,
        transcript: array(item.transcript).map((turn) => {
          const row = record(turn);
          return { key: row.question_key, question: row.question, answer: record(row.answer).value };
        }),
        fact_ledger: record(record(item.output).intake).fact_ledger,
        evidence_summary: record(record(item.output).intake).evidence_summary,
        next_action: record(record(item.output).intake).next_action,
        engine_status: item.status
      }))
    },
    Math.max(2e3, Math.min(1e4, items.length * 650)),
    ANALYZER_MODEL,
    "low",
    6e4
  );
  const parsed = ai.parsed;
  return {
    reviews: array(parsed.reviews).map(record),
    inputTokens: ai.inputTokens ?? 0,
    outputTokens: ai.outputTokens ?? 0
  };
}
function severityWeight(severity) {
  return severity === "critical" ? 12 : severity === "high" ? 7 : severity === "medium" ? 3 : 1;
}
function clusterAnalyzerFindings(cases) {
  const clusters = /* @__PURE__ */ new Map();
  for (const item of cases) {
    const combined = [...inspectBatchCase(item), ...array(item.independent_findings).map(record)];
    const deduped = /* @__PURE__ */ new Map();
    for (const finding of combined) {
      const key = `${finding.stage}:${finding.code}:${finding.evidence}`;
      if (!deduped.has(key)) deduped.set(key, finding);
    }
    const findings = [...deduped.values()];
    item.analyzer_findings = findings;
    for (const finding of findings) {
      const id = `${finding.stage}:${finding.code}`;
      const existing = clusters.get(id) ?? {
        cluster_id: id,
        ...finding,
        count: 0,
        case_ids: [],
        categories: {},
        buckets: {},
        difficulties: {},
        response_styles: {}
      };
      existing.count = Number(existing.count) + 1;
      const caseIds = existing.case_ids;
      if (caseIds.length < 8) caseIds.push(item.id);
      for (const [dimension, value] of [
        ["categories", item.category],
        ["buckets", item.bucket],
        ["difficulties", item.difficulty],
        ["response_styles", record(item.simulated_profile).response_style]
      ]) {
        const counts = record(existing[dimension]);
        const key = String(value ?? "unknown");
        counts[key] = Number(counts[key] ?? 0) + 1;
      }
      clusters.set(id, existing);
    }
  }
  const result = [...clusters.values()].map((cluster) => ({
    ...cluster,
    rate: cases.length ? Number(cluster.count) / cases.length : 0
  }));
  return result.sort((a, b) => {
    const weight = (value) => severityWeight(String(value.severity)) * Number(value.count);
    return weight(b) - weight(a);
  });
}
function modelCost(model, inputTokens, outputTokens) {
  const luna = model.includes("luna");
  const inputRate = luna ? LUNA_INPUT_USD_PER_MILLION : TERRA_INPUT_USD_PER_MILLION;
  const outputRate = luna ? LUNA_OUTPUT_USD_PER_MILLION : TERRA_OUTPUT_USD_PER_MILLION;
  return (inputTokens * inputRate + outputTokens * outputRate) / 1e6;
}
async function getOrCreateCampaign(ctx) {
  const existing = await ctx.admin.from("future_you_test_campaigns").select("*").eq("user_id", ctx.user.id).eq("status", "active").maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const created = await ctx.admin.from("future_you_test_campaigns").insert({
    user_id: ctx.user.id,
    warning_cost_usd: CAMPAIGN_WARNING_USD,
    stop_cost_usd: CAMPAIGN_STOP_USD
  }).select("*").single();
  if (created.error) {
    const raced = await ctx.admin.from("future_you_test_campaigns").select("*").eq("user_id", ctx.user.id).eq("status", "active").single();
    if (raced.error) throw created.error;
    return raced.data;
  }
  return created.data;
}
async function campaignSnapshot(ctx, campaignId) {
  const campaign = campaignId ? await ctx.admin.from("future_you_test_campaigns").select("*").eq("id", campaignId).eq("user_id", ctx.user.id).single() : { data: await getOrCreateCampaign(ctx), error: null };
  if (campaign.error || !campaign.data) throw new ApiError(404, "campaign_not_found", "The active testing campaign could not be found.");
  const [runs, reports] = await Promise.all([
    ctx.admin.from("future_you_batch_runs").select("estimated_cost_usd,requested_count,proof_count").eq("campaign_id", campaign.data.id).eq("user_id", ctx.user.id),
    ctx.admin.from("future_you_batch_analysis_reports").select("estimated_cost_usd").eq("campaign_id", campaign.data.id).eq("user_id", ctx.user.id)
  ]);
  if (runs.error) throw runs.error;
  if (reports.error) throw reports.error;
  const generationCost = (runs.data ?? []).reduce((sum, run) => sum + Number(run.estimated_cost_usd ?? 0), 0);
  const analysisCost = (reports.data ?? []).reduce((sum, report) => sum + Number(report.estimated_cost_usd ?? 0), 0);
  return {
    ...campaign.data,
    generation_cost_usd: generationCost,
    analysis_cost_usd: analysisCost,
    total_cost_usd: generationCost + analysisCost,
    test_count: (runs.data ?? []).reduce((sum, run) => sum + Number(run.requested_count ?? 0), 0),
    proof_count: (runs.data ?? []).reduce((sum, run) => sum + Number(run.proof_count ?? 0), 0)
  };
}
async function analyzeBatch(ctx, batchId) {
  requireBatchAdmin(ctx);
  const hydrated = await hydrateBatch(ctx, batchId);
  if (!["completed", "cancelled", "cost_stopped", "stopped_cost"].includes(String(hydrated.run.status))) {
    throw new ApiError(409, "batch_not_complete", "Finish or cancel the batch before analyzing it.");
  }
  const analyzable = hydrated.cases.filter((item) => !["queued", "running", "cancelled"].includes(String(item.status)));
  if (analyzable.length === 0) throw new ApiError(422, "no_analyzable_cases", "This batch has no completed cases to analyze.");
  const campaign = await campaignSnapshot(ctx, hydrated.run.campaign_id);
  let independentInputTokens = 0;
  let independentOutputTokens = 0;
  let questionAuditCaseCount = 0;
  if (Number(campaign.total_cost_usd) < Number(campaign.stop_cost_usd)) {
    try {
      const audit = await inspectBatchQuestionsWithAI(analyzable, String(hydrated.run.compartment));
      for (const review of audit.reviews) {
        const item = analyzable.find((candidate) => String(candidate.id) === String(review.case_id));
        if (!item) continue;
        item.independent_findings = array(review.findings).map(record).filter((finding) => findingAppliesToCompartment(finding, String(hydrated.run.compartment)));
        item.independent_review = review;
        questionAuditCaseCount += 1;
      }
      independentInputTokens += audit.inputTokens;
      independentOutputTokens += audit.outputTokens;
    } catch (error) {
      console.warn("Complete question audit failed", { code: error instanceof ApiError ? error.code : "question_audit_unavailable" });
    }
  }
  const clusters = clusterAnalyzerFindings(analyzable);
  await Promise.all(analyzable.map((item) => ctx.admin.from("future_you_batch_cases").update({
    analyzer_findings: item.analyzer_findings
  }).eq("id", item.id).eq("user_id", ctx.user.id)));
  let aiReview = { executive_summary: "Deterministic checks completed.", priority_order: clusters.slice(0, 5).map((item) => item.cluster_id), cluster_reviews: [] };
  let inputTokens = independentInputTokens;
  let outputTokens = independentOutputTokens;
  let analysisCost = modelCost(ANALYZER_MODEL, independentInputTokens, independentOutputTokens);
  let criticalReviewEscalations = 0;
  let analyzerModel = independentInputTokens || independentOutputTokens ? ANALYZER_MODEL : "deterministic";
  if (clusters.length > 0 && Number(campaign.total_cost_usd) < Number(campaign.stop_cost_usd)) {
    try {
      const ai = await callOpenAI(
        "future_you_batch_analysis_v2",
        batchAnalysisSchema,
        "Review compressed Future You test clusters. Identify likely root causes and the smallest engine-level fix. Do not invent facts, change the engine, or repeat case text. Return concise operational findings only.",
        {
          batch: { compartment: hydrated.run.compartment, cases: analyzable.length, model: hydrated.run.model_version },
          clusters: clusters.slice(0, 30).map((item) => ({
            cluster_id: item.cluster_id,
            stage: item.stage,
            severity: item.severity,
            count: item.count,
            rate: item.rate,
            title: item.title,
            summary: item.summary,
            evidence: item.evidence,
            categories: item.categories,
            difficulties: item.difficulties,
            response_styles: item.response_styles
          }))
        },
        3e3,
        ANALYZER_MODEL,
        "low",
        45e3
      );
      aiReview = ai.parsed;
      inputTokens += ai.inputTokens ?? 0;
      outputTokens += ai.outputTokens ?? 0;
      analysisCost += modelCost(ANALYZER_MODEL, ai.inputTokens ?? 0, ai.outputTokens ?? 0);
      analyzerModel = ANALYZER_MODEL;
    } catch (error) {
      console.warn("Batch analyzer used deterministic findings only", { code: error instanceof ApiError ? error.code : "analyzer_unavailable" });
    }
  }
  const reviews = new Map(array(aiReview.cluster_reviews).map((value) => {
    const item = record(value);
    return [String(item.cluster_id), item];
  }));
  const criticalReviewCandidates = clusters.filter((cluster) => {
    const review = reviews.get(String(cluster.cluster_id));
    return cluster.severity === "critical" && review?.needs_critical_review === true;
  }).slice(0, 5);
  if (criticalReviewCandidates.length > 0 && Number(campaign.stop_cost_usd) - Number(campaign.total_cost_usd) > 0.25) {
    try {
      const criticalReview = await callOpenAI(
        "future_you_batch_analysis_critical_review_v2",
        batchAnalysisSchema,
        "Adjudicate only the serious uncertain Future You test clusters. Confirm the likely root cause and the smallest safe engine fix. Do not change the engine and do not expose hidden reasoning.",
        { clusters: criticalReviewCandidates, prior_reviews: criticalReviewCandidates.map((item) => reviews.get(String(item.cluster_id))) },
        2e3,
        ANALYZER_REVIEW_MODEL,
        "low",
        45e3
      );
      for (const value of array(criticalReview.parsed.cluster_reviews)) {
        const item = record(value);
        reviews.set(String(item.cluster_id), { ...item, review_model: ANALYZER_REVIEW_MODEL });
      }
      inputTokens += criticalReview.inputTokens ?? 0;
      outputTokens += criticalReview.outputTokens ?? 0;
      analysisCost += modelCost(ANALYZER_REVIEW_MODEL, criticalReview.inputTokens ?? 0, criticalReview.outputTokens ?? 0);
      criticalReviewEscalations = criticalReviewCandidates.length;
    } catch (error) {
      console.warn("Critical analyzer review was skipped", { code: error instanceof ApiError ? error.code : "critical_review_unavailable" });
    }
  }
  const findings = clusters.map((cluster) => {
    const review = reviews.get(String(cluster.cluster_id)) ?? {};
    return {
      ...cluster,
      likely_root_cause: review.likely_root_cause ?? cluster.summary,
      recommendation: review.recommendation ?? cluster.recommendation,
      confidence: review.confidence ?? 0.85,
      review_model: review.review_model ?? (reviews.has(String(cluster.cluster_id)) ? analyzerModel : "deterministic")
    };
  });
  const { score: score2 } = scoreAnalyzerFindings(findings);
  const totalCost = analysisCost;
  const cleanCases = analyzable.filter((item) => !array(item.analyzer_findings).some((finding) => ["critical", "high", "medium"].includes(String(record(finding).severity))));
  const summary = {
    executive_summary: aiReview.executive_summary,
    analyzed_cases: analyzable.length,
    clean_cases: cleanCases.length,
    issue_cases: analyzable.length - cleanCases.length,
    confirmed_defect_clusters: findings.filter((item) => ["critical", "high"].includes(String(item.severity))).length,
    improvement_clusters: findings.filter((item) => ["medium", "low"].includes(String(item.severity))).length,
    critical_clusters: findings.filter((item) => item.severity === "critical").length,
    high_clusters: findings.filter((item) => item.severity === "high").length
  };
  const recommendations = findings.slice(0, 8).map((item) => ({
    cluster_id: item.cluster_id,
    stage: item.stage,
    severity: item.severity,
    recommendation: item.recommendation,
    affected_cases: item.count
  }));
  const inserted = await ctx.admin.from("future_you_batch_analysis_reports").insert({
    batch_run_id: batchId,
    campaign_id: hydrated.run.campaign_id,
    user_id: ctx.user.id,
    analyzer_version: BATCH_ANALYZER_VERSION,
    score: score2,
    summary,
    findings,
    recommendations,
    dimensions: {
      batch_run_id: batchId,
      created_at: hydrated.run.created_at,
      engine_version: hydrated.run.engine_version,
      model_version: hydrated.run.model_version,
      requested_count: hydrated.run.requested_count,
      categories: hydrated.run.categories,
      compartment: hydrated.run.compartment
    },
    api_usage: {
      model: analyzerModel,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      question_audited_cases: questionAuditCaseCount,
      deterministic_cases: analyzable.length,
      critical_review_escalations: criticalReviewEscalations
    },
    estimated_cost_usd: totalCost
  }).select("*").single();
  if (inserted.error) throw inserted.error;
  return success({ report: inserted.data, campaign: await campaignSnapshot(ctx, hydrated.run.campaign_id) });
}
async function reviewBatchCase(body, ctx, caseId) {
  requireBatchAdmin(ctx);
  const verdict = String(body.verdict ?? "");
  if (!["approved", "issue", "needs_review"].includes(verdict)) throw new ApiError(400, "invalid_review_verdict", "Choose Approved, Issue, or Needs Review.");
  const note = String(body.note ?? "").trim().slice(0, 4e3);
  const tags = array(body.tags).map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 12);
  const updated = await ctx.admin.from("future_you_batch_cases").update({
    reviewer_verdict: verdict,
    reviewer_note: note || null,
    reviewer_tags: tags,
    reviewed_at: (/* @__PURE__ */ new Date()).toISOString()
  }).eq("id", caseId).eq("user_id", ctx.user.id).select("*").single();
  if (updated.error || !updated.data) throw new ApiError(404, "batch_case_not_found", "That case could not be found.");
  return success({ case: updated.data });
}
async function hydrateBatch(ctx, batchId) {
  const [{ data: run, error: runError }, { data: cases, error: caseError }] = await Promise.all([
    ctx.admin.from("future_you_batch_runs").select("*").eq("id", batchId).eq("user_id", ctx.user.id).single(),
    ctx.admin.from("future_you_batch_cases").select("*").eq("batch_run_id", batchId).eq("user_id", ctx.user.id).order("ordinal")
  ]);
  if (runError || !run) throw new ApiError(404, "batch_not_found", "That batch could not be found.");
  if (caseError) throw caseError;
  const { data: analysis, error: analysisError } = await ctx.admin.from("future_you_batch_analysis_reports").select("*").eq("batch_run_id", batchId).eq("user_id", ctx.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (analysisError) throw analysisError;
  const campaign = run.campaign_id ? await campaignSnapshot(ctx, run.campaign_id) : null;
  return { run, cases: cases ?? [], analysis: analysis ?? null, campaign };
}
async function createBatch(body, ctx) {
  requireBatchAdmin(ctx);
  const compartment = String(body.compartment ?? "intake");
  if (!["intake", "action_plans", "progress_updates", "end_to_end"].includes(compartment)) throw new ApiError(400, "invalid_compartment", "Choose a valid Batch Lab compartment.");
  const made = await makeBatchSpecs({ ...body, compartment }, ctx);
  const activeCampaign = await getOrCreateCampaign(ctx);
  const campaign = await campaignSnapshot(ctx, activeCampaign.id);
  const goalGenerationCost = modelCost(ANALYZER_MODEL, made.generationInputTokens, made.generationOutputTokens);
  const maxIntakeTurns = made.intakeLevel === "quick_start" ? 6 : 19;
  // Intake now runs on LUNA (cheaper per token than TERRA), but each turn can make up
  // to two LUNA calls (question generation + the independent grader, doubled again on
  // one regeneration attempt) instead of one, so the per-turn ceiling is doubled to stay
  // a real safety cap rather than a stale Terra-priced, single-call estimate.
  const maxIntakeTurnCost = modelCost(LUNA_MODEL, MAX_INTAKE_INPUT_TOKENS, MAX_INTAKE_OUTPUT_TOKENS) * 2;
  const intakeSafetyCeiling = compartment === "intake" ? made.requested * maxIntakeTurns * maxIntakeTurnCost : made.requested * 0.025;
  const analyzerAllowance = 0.05;
  const preflightEstimate = goalGenerationCost + intakeSafetyCeiling + made.proofTarget * 0.02 + analyzerAllowance;
  if (Number(campaign.total_cost_usd) >= Number(campaign.stop_cost_usd) || Number(campaign.total_cost_usd) + preflightEstimate > Number(campaign.stop_cost_usd)) {
    throw new ApiError(409, "campaign_cost_limit", "This batch would exceed the $30 testing campaign limit.");
  }
  const { data: run, error: runError } = await ctx.admin.from("future_you_batch_runs").insert({
    user_id: ctx.user.id,
    campaign_id: activeCampaign.id,
    compartment,
    status: "queued",
    requested_count: made.requested,
    manual_count: made.manualGoals.length,
    generated_count: made.requested - made.manualGoals.length,
    categories: made.categories,
    difficulty_mix: { controlled: true },
    config: { seed: made.baseSeed, manual_goals: made.manualGoals, preflight_estimate_usd: preflightEstimate, goal_generation_cost_usd: goalGenerationCost, architecture: "semantic_evidence_v5", intake_level: made.intakeLevel },
    queued_count: made.requested,
    proof_count: made.proofTarget,
    route_only_count: made.requested - made.proofTarget,
    model_version: MODEL,
    reasoning_effort: REASONING_EFFORT,
    engine_version: ENGINE_VERSION,
    template_library_version: "none_semantic_v5",
    validator_version: BATCH_VALIDATOR_VERSION,
    test_suite_version: BATCH_TEST_SUITE_VERSION,
    concurrency: BATCH_CONCURRENCY,
    warning_cost_usd: activeCampaign.warning_cost_usd,
    stop_cost_usd: activeCampaign.stop_cost_usd
  }).select("*").single();
  if (runError) throw runError;
  const rows = made.specs.map((spec, ordinal) => ({
    ...spec,
    batch_run_id: run.id,
    user_id: ctx.user.id,
    ordinal: ordinal + 1,
    status: "queued",
    engine_version: ENGINE_VERSION,
    template_library_version: "none_semantic_v5",
    validator_version: BATCH_VALIDATOR_VERSION,
    test_suite_version: BATCH_TEST_SUITE_VERSION,
    model_version: MODEL
  }));
  const { error: casesError } = await ctx.admin.from("future_you_batch_cases").insert(rows);
  if (casesError) throw casesError;
  return success(await hydrateBatch(ctx, run.id));
}
async function refreshBatchCounts(ctx, batchId) {
  const { data: cases, error } = await ctx.admin.from("future_you_batch_cases").select("status,api_usage,estimated_cost_usd").eq("batch_run_id", batchId).eq("user_id", ctx.user.id);
  if (error) throw error;
  const all = cases ?? [];
  const count = (status2) => all.filter((item) => item.status === status2).length;
  const totals = all.reduce((sum, item) => {
    const usage = item.api_usage ?? {};
    sum.calls += Number(usage.call_count ?? 0);
    sum.input += Number(usage.input_tokens ?? 0);
    sum.output += Number(usage.output_tokens ?? 0);
    sum.cost += Number(item.estimated_cost_usd ?? 0);
    return sum;
  }, { calls: 0, input: 0, output: 0, cost: 0 });
  const queued = count("queued");
  const running = count("running");
  const terminal = queued === 0 && running === 0;
  const { data: current } = await ctx.admin.from("future_you_batch_runs").select("cancel_requested,stop_cost_usd,campaign_id").eq("id", batchId).single();
  let campaignSpend = totals.cost;
  if (current?.campaign_id) {
    const [otherRuns, reports] = await Promise.all([
      ctx.admin.from("future_you_batch_runs").select("estimated_cost_usd").eq("campaign_id", current.campaign_id).neq("id", batchId),
      ctx.admin.from("future_you_batch_analysis_reports").select("estimated_cost_usd").eq("campaign_id", current.campaign_id)
    ]);
    campaignSpend += (otherRuns.data ?? []).reduce((sum, run) => sum + Number(run.estimated_cost_usd ?? 0), 0);
    campaignSpend += (reports.data ?? []).reduce((sum, report) => sum + Number(report.estimated_cost_usd ?? 0), 0);
  }
  const costStopped = campaignSpend >= Number(current?.stop_cost_usd ?? CAMPAIGN_STOP_USD) && queued > 0;
  let status = terminal ? "completed" : "running";
  if (current?.cancel_requested) status = "cancelled";
  else if (costStopped) status = "cost_stopped";
  const patch = {
    status,
    queued_count: queued,
    running_count: running,
    passed_count: count("passed"),
    warning_count: count("warning"),
    failed_count: count("failed"),
    system_error_count: count("system_error"),
    cancelled_count: count("cancelled"),
    api_call_count: totals.calls,
    input_tokens: totals.input,
    output_tokens: totals.output,
    estimated_cost_usd: totals.cost,
    updated_at: (/* @__PURE__ */ new Date()).toISOString(),
    completed_at: terminal || status === "cancelled" || status === "cost_stopped" ? (/* @__PURE__ */ new Date()).toISOString() : null
  };
  const { error: updateError } = await ctx.admin.from("future_you_batch_runs").update(patch).eq("id", batchId).eq("user_id", ctx.user.id);
  if (updateError) throw updateError;
  return patch;
}
async function processBatch(ctx, batchId) {
  requireBatchAdmin(ctx);
  const current = await hydrateBatch(ctx, batchId);
  if (["completed", "cancelled", "cost_stopped"].includes(String(current.run.status))) return success(current);
  if (current.run.cancel_requested) return cancelBatch(ctx, batchId);
  if (Number(current.run.estimated_cost_usd) >= Number(current.run.stop_cost_usd)) {
    await refreshBatchCounts(ctx, batchId);
    return success(await hydrateBatch(ctx, batchId));
  }
  const active = current.cases.filter((item) => item.status === "running");
  const queued = current.cases.filter((item) => item.status === "queued");
  const concurrency = Math.max(1, Math.min(5, Number(current.run.concurrency ?? BATCH_CONCURRENCY)));
  const selected = [...active, ...queued].slice(0, concurrency);
  if (selected.length === 0) {
    await refreshBatchCounts(ctx, batchId);
    return success(await hydrateBatch(ctx, batchId));
  }
  const newlyStarted = selected.filter((item) => item.status === "queued");
  const ids = newlyStarted.map((item) => item.id);
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (ids.length > 0) {
    const { error: markError } = await ctx.admin.from("future_you_batch_cases").update({ status: "running", started_at: startedAt }).in("id", ids).eq("batch_run_id", batchId).eq("user_id", ctx.user.id);
    if (markError) throw markError;
  }
  await ctx.admin.from("future_you_batch_runs").update({ status: "running", started_at: current.run.started_at ?? startedAt, updated_at: startedAt }).eq("id", batchId).eq("user_id", ctx.user.id);
  const intakeOnly = String(current.run.compartment) === "intake";
  const results = await Promise.all(selected.map((item) => intakeOnly ? advanceIntakeBatchCase(item) : executeBatchCase(item, String(current.run.compartment))));
  const { data: latestRun } = await ctx.admin.from("future_you_batch_runs").select("cancel_requested").eq("id", batchId).eq("user_id", ctx.user.id).single();
  const cancelledWhileRunning = latestRun?.cancel_requested === true;
  await Promise.all(results.map((result, index) => ctx.admin.from("future_you_batch_cases").update(
    cancelledWhileRunning ? { ...result, status: "cancelled", completed_at: (/* @__PURE__ */ new Date()).toISOString() } : result
  ).eq("id", selected[index].id).eq("user_id", ctx.user.id)));
  await refreshBatchCounts(ctx, batchId);
  return success(await hydrateBatch(ctx, batchId));
}
async function cancelBatch(ctx, batchId) {
  requireBatchAdmin(ctx);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await ctx.admin.from("future_you_batch_runs").update({ cancel_requested: true, status: "cancelled", updated_at: now, completed_at: now }).eq("id", batchId).eq("user_id", ctx.user.id);
  await ctx.admin.from("future_you_batch_cases").update({ status: "cancelled", completed_at: now }).eq("batch_run_id", batchId).eq("user_id", ctx.user.id).in("status", ["queued", "running"]);
  await refreshBatchCounts(ctx, batchId);
  return success(await hydrateBatch(ctx, batchId));
}
async function listBatches(ctx) {
  requireBatchAdmin(ctx);
  const { data, error } = await ctx.admin.from("future_you_batch_runs").select("*").eq("user_id", ctx.user.id).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return success({ runs: data ?? [], campaign: await campaignSnapshot(ctx) });
}
async function rerunBatchCase(ctx, caseId) {
  requireBatchAdmin(ctx);
  const { data: original, error } = await ctx.admin.from("future_you_batch_cases").select("*,future_you_batch_runs!inner(compartment,campaign_id)").eq("id", caseId).eq("user_id", ctx.user.id).single();
  if (error || !original) throw new ApiError(404, "batch_case_not_found", "That case could not be found.");
  const compartment = String(original.future_you_batch_runs.compartment);
  const { data: run, error: runError } = await ctx.admin.from("future_you_batch_runs").insert({
    user_id: ctx.user.id,
    campaign_id: original.future_you_batch_runs.campaign_id,
    compartment,
    status: "queued",
    is_comparison: true,
    requested_count: 1,
    manual_count: 1,
    generated_count: 0,
    categories: [original.category],
    difficulty_mix: { rerun: true },
    config: { original_case_id: caseId },
    queued_count: 1,
    model_version: MODEL,
    reasoning_effort: REASONING_EFFORT,
    engine_version: ENGINE_VERSION,
    template_library_version: "none_semantic_v5",
    validator_version: BATCH_VALIDATOR_VERSION,
    test_suite_version: BATCH_TEST_SUITE_VERSION,
    concurrency: 1,
    warning_cost_usd: CAMPAIGN_WARNING_USD,
    stop_cost_usd: CAMPAIGN_STOP_USD,
    proof_count: original.proof_selected ? 1 : 0,
    route_only_count: original.proof_selected ? 0 : 1
  }).select("*").single();
  if (runError) throw runError;
  const { data: rerun, error: caseError } = await ctx.admin.from("future_you_batch_cases").insert({
    batch_run_id: run.id,
    user_id: ctx.user.id,
    parent_case_id: original.id,
    ordinal: 1,
    stable_case_id: `${original.stable_case_id}-R${Date.now()}`,
    seed: original.seed,
    source: "rerun",
    category: original.category,
    bucket: original.bucket,
    difficulty: original.difficulty,
    status: "queued",
    input_goal: original.input_goal,
    input_payload: original.input_payload,
    simulated_profile: original.simulated_profile,
    proof_selected: original.proof_selected,
    engine_version: ENGINE_VERSION,
    template_library_version: "none_semantic_v5",
    validator_version: BATCH_VALIDATOR_VERSION,
    test_suite_version: BATCH_TEST_SUITE_VERSION,
    model_version: MODEL
  }).select("*").single();
  if (caseError) throw caseError;
  await processBatch(ctx, run.id);
  const { data: completed } = await ctx.admin.from("future_you_batch_cases").select("*").eq("id", rerun.id).single();
  const fieldDiff = {
    status: { before: original.status, after: completed?.status },
    failure_codes: { before: original.failure_codes, after: completed?.failure_codes },
    output_changed: JSON.stringify(original.output) !== JSON.stringify(completed?.output),
    engine_version: { before: original.engine_version, after: completed?.engine_version }
  };
  const { data: comparison, error: comparisonError } = await ctx.admin.from("future_you_batch_comparisons").insert({
    user_id: ctx.user.id,
    original_case_id: original.id,
    rerun_case_id: rerun.id,
    field_diff: fieldDiff
  }).select("*").single();
  if (comparisonError) throw comparisonError;
  return success({ comparison, original, rerun: completed, run: (await hydrateBatch(ctx, run.id)).run });
}
async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function nextStatus(nextAction) {
  if (["build_plan", "cautious_starter"].includes(nextAction)) return "ready_to_preview";
  if (nextAction === "prepare") return "prepare";
  if (nextAction === "stop_redirect") return "stopped";
  return "collecting";
}
function publicIntakeResponse(session, result, questionId) {
  const question = result.question;
  const calibration = result.goal_calibration;
  const calibrationMessage = ["aggressive", "unsafe_impossible"].includes(String(calibration?.status)) && calibration?.confirmed !== true && String(question?.kind) === "goal_calibration" ? String(calibration?.recommendation ?? "") : "";
  const userMessage = calibrationMessage || String(result.viability?.hard_issue ?? "") || String(result.safety?.short_user_message ?? "");
  validatePlainLanguage([
    userMessage,
    question?.text,
    ...(Array.isArray(question?.options) ? question?.options : []).map((option) => option.label)
  ]);
  return {
    intake_id: session.id,
    status: session.status,
    safety: result.safety,
    route: result.route,
    next_action: result.next_action,
    question: question ? { id: questionId, text: question.text, control: question.control, options: question.options } : null,
    user_message: userMessage,
    goal_recommendation: calibrationMessage ? {
      accepted_target: calibration.committed_target,
      recommended_target: calibration.recommended_target,
      stretch_target: calibration.stretch_target,
      message: calibrationMessage,
      confirmed: calibration.confirmed
    } : null,
    stop_reason: result.stop_reason,
    cautious_starter: result.cautious_starter
  };
}
function repairTurnPhase(turn) {
  const review = turn?.review_result;
  return String(review?.kind) === "viability_repair" ? String(review?.phase ?? "proposal") : null;
}
async function loadContext(admin, userId) {
  const [{ data: profile }, { data: goals }] = await Promise.all([
    admin.from("profiles").select("timezone,stable_preferences,stable_constraints,combined_capacity_summary").eq("user_id", userId).maybeSingle(),
    admin.from("goals").select("id,goal_text,bucket,tag,state,active_slot").eq("user_id", userId).in("state", ["prepare", "active"])
  ]);
  return { profile: profile ?? {}, active_goals: goals ?? [] };
}
async function createRun(admin, values) {
  const { data, error } = await admin.from("engine_runs").insert(values).select("id").single();
  if (error) throw error;
  return data.id;
}
async function completeRun(admin, runId, values) {
  const { error } = await admin.from("engine_runs").update({ ...values, completed_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", runId);
  if (error) throw error;
}
async function startIntake(req, body, ctx) {
  const goalText = String(body.goal_text ?? "").trim();
  const level = String(body.intake_level ?? "quick_start");
  if (goalText.length < 3 || goalText.length > 1e3) throw new ApiError(400, "invalid_goal", "Enter a clear goal before continuing.");
  if (!["quick_start", "full_plan"].includes(level)) throw new ApiError(400, "invalid_intake_level", "Choose Quick Start or Full Plan.");
  const context = await loadContext(ctx.admin, ctx.user.id);
  const temporalContext = buildTemporalContext(context);
  if (context.active_goals.length >= MAX_GOALS) throw new ApiError(409, "active_goal_limit", "You already have three active goals. Complete, inactivate, or change one before starting another.", "conflict");
  const typedLevel = level;
  const cap = intakeCapForLevel(level);
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const dynamic = await runLiveSemanticIntakeTurn({
    operation: "start_intake",
    goal_text: goalText,
    intake_level: typedLevel,
    route_hint: null,
    temporal_context: temporalContext,
    profile: context.profile,
    active_goals: context.active_goals,
    prior_turns: [],
    previous_blueprint: null,
    latest_answer: null
  }, {
    askedKeys: [],
    questionCount: 0,
    cap,
    intakeLevel: level,
    previousQuestionTexts: [],
    answeredCalibration: false
  });
  const result = dynamic.result;
  const { data: session, error } = await ctx.admin.from("intake_sessions").insert({
    user_id: ctx.user.id,
    goal_text: goalText,
    level,
    max_questions: cap,
    model_version: LUNA_MODEL
  }).select("*").single();
  if (error) throw error;
  const runId = await createRun(ctx.admin, {
    user_id: ctx.user.id,
    session_id: session.id,
    run_type: "intake_start",
    request_id: requestId,
    input_refs: { session_id: session.id },
    input_snapshot: { goal_text: goalText, level, context },
    model_version: LUNA_MODEL,
    prompt_version: LIVE_SEMANTIC_INTAKE_VERSION,
    schema_version: SCHEMA_VERSION
  });
  try {
    const status = nextStatus(String(result.next_action));
    const safety = String(result.safety.status);
    const question = result.question;
    let questionId = null;
    if (question) {
      const { data: turn, error: turnError } = await ctx.admin.from("intake_turns").insert({
        session_id: session.id,
        user_id: ctx.user.id,
        sequence: 1,
        question_key: question.key,
        question_text: question.text,
        control: question.control,
        options: question.options,
        blueprint_link: question.blueprint_link,
        plan_impacts: question.plan_impacts,
        activation_rule: question.activation_rule,
        // impact/skip/utility now reflect the independent grader's actual verdict for this
        // question (gradeQuestionIndependently), not a hard-coded pass. A question only
        // reaches this insert after passing the grader, so these are the real check results:
        // impact <- the grader's "impact" check, skip <- "evidence" (the fact was genuinely
        // unresolved, i.e. not skippable), utility <- "priority" (this was the best next ask).
        review_result: { impact: dynamic.questionQuality.grader?.checks?.impact === true, skip: dynamic.questionQuality.grader?.checks?.evidence === true, utility: dynamic.questionQuality.grader?.checks?.priority === true, kind: question.kind, phase: question.repair_phase, why_needed: question.why_needed, question_brief: question.brief, quality_gate: dynamic.questionQuality, source: "semantic_evidence_intake_v6_dynamic" }
      }).select("id").single();
      if (turnError) throw turnError;
      questionId = turn.id;
    }
    const { data: updated, error: updateError } = await ctx.admin.from("intake_sessions").update({
      status,
      safety,
      preliminary_route: result.route,
      blueprint: { ...result.blueprint, coverage: result.coverage, viability: result.viability, goal_calibration: result.goal_calibration },
      fact_ledger: result.fact_ledger,
      question_count: question ? 1 : 0,
      next_action: result.next_action,
      stop_reason: result.stop_reason,
      cautious_starter: result.cautious_starter,
      revision: 2
    }).eq("id", session.id).select("*").single();
    if (updateError) throw updateError;
    await completeRun(ctx.admin, runId, {
      status: "succeeded",
      structured_output: result,
      evidence_summary: result.evidence_summary,
      validation: { schema: true, evidence_contract: true, deterministic_turn_contract: true, completion_gate_proof: true, semantic_state_controller: true, independent_question_grader: true, cap: true, attempts: dynamic.attempts },
      latency_ms: Date.now() - started,
      input_tokens: dynamic.inputTokens,
      output_tokens: dynamic.outputTokens,
      estimated_cost_usd: modelCost(LUNA_MODEL, dynamic.inputTokens, dynamic.outputTokens)
    });
    return success(publicIntakeResponse(updated, result, questionId), updated.revision);
  } catch (error2) {
    // Every Luna call this turn is counted here too, including the calls that led to
    // the failure (the grader, and any regeneration attempt) - not just successful runs.
    const usage = error2 instanceof ApiError ? error2.usage : null;
    const failedInputTokens = Number(usage?.input_tokens ?? 0);
    const failedOutputTokens = Number(usage?.output_tokens ?? 0);
    await completeRun(ctx.admin, runId, {
      status: error2 instanceof ApiError && error2.code === "model_refusal" ? "refused" : "failed",
      error_code: error2 instanceof ApiError ? error2.code : "unknown",
      input_tokens: failedInputTokens,
      output_tokens: failedOutputTokens,
      estimated_cost_usd: modelCost(LUNA_MODEL, failedInputTokens, failedOutputTokens)
    });
    throw error2;
  }
}
async function answerIntake(body, ctx, intakeId) {
  const questionId = String(body.question_id ?? "");
  const expectedRevision = Number(body.expected_revision ?? 0);
  if (!questionId || !body.answer || !expectedRevision) throw new ApiError(400, "missing_answer", "Answer the current question before continuing.");
  const { data: session, error: sessionError } = await ctx.admin.from("intake_sessions").select("*").eq("id", intakeId).eq("user_id", ctx.user.id).single();
  if (sessionError || !session) throw new ApiError(404, "intake_not_found", "This intake could not be found.");
  if (session.status !== "collecting") throw new ApiError(409, "intake_not_collecting", "This intake is no longer waiting for an answer.", "conflict");
  const { data: currentTurn, error: turnError } = await ctx.admin.from("intake_turns").select("*").eq("id", questionId).eq("session_id", intakeId).single();
  if (turnError || !currentTurn) throw new ApiError(409, "question_not_current", "That question has already been answered or replaced.", "conflict");
  const pendingReplay = session.next_action === "reassessment_pending"
    && Boolean(currentTurn.answered_at)
    && JSON.stringify(currentTurn.answer) === JSON.stringify(body.answer)
    && [Number(session.revision), Number(session.revision) - 1].includes(expectedRevision);
  if (!pendingReplay && session.revision !== expectedRevision) throw new ApiError(409, "stale_revision", "This intake changed. Reload before answering again.", "conflict");
  if (currentTurn.answered_at && !pendingReplay) throw new ApiError(409, "question_not_current", "That question has already been answered or replaced.", "conflict");
  const answerError = validateAnswerForControl(
    String(currentTurn.control),
    Array.isArray(currentTurn.options) ? currentTurn.options : [],
    body.answer
  );
  if (answerError) throw new ApiError(400, "invalid_answer", answerError);
  let recordedRevision = Number(session.revision);
  if (!pendingReplay) {
    const { data: recorded, error: recordError } = await ctx.admin.rpc("record_future_you_answer", {
      p_user_id: ctx.user.id,
      p_session_id: intakeId,
      p_turn_id: questionId,
      p_expected_revision: expectedRevision,
      p_answer: body.answer
    });
    if (recordError) {
      if (recordError.message.includes("stale_revision")) throw new ApiError(409, "stale_revision", "This intake changed. Reload before continuing.", "conflict");
      if (recordError.message.includes("question_not_current")) throw new ApiError(409, "question_not_current", "That question has already been answered or replaced.", "conflict");
      throw recordError;
    }
    const recordCommit = Array.isArray(recorded) ? recorded[0] : recorded;
    recordedRevision = Number(recordCommit?.revision ?? 0);
    if (recordedRevision !== Number(session.revision) + 1) {
      throw new ApiError(500, "answer_record_failed", "Future You could not safely preserve that answer.");
    }
  }
  const [{ data: turns }, context] = await Promise.all([
    ctx.admin.from("intake_turns").select("id,sequence,question_key,question_text,control,options,answer,blueprint_link,plan_impacts,review_result").eq("session_id", intakeId).order("sequence"),
    loadContext(ctx.admin, ctx.user.id)
  ]);
  const turnsForEngine = turns ?? [];
  const askedKeys = turnsForEngine.map((turn) => turn.question_key);
  const temporalContext = buildTemporalContext(context);
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const answerQuality = { review: localAnswerQuality(currentTurn, body.answer), inputTokens: 0, outputTokens: 0 };
  let runId = null;
  try {
    runId = await createRun(ctx.admin, {
      user_id: ctx.user.id,
      session_id: intakeId,
      run_type: "intake_answer",
      request_id: requestId,
      input_refs: { session_id: intakeId, question_id: questionId },
      input_snapshot: { goal_text: session.goal_text, level: session.level, turns: turnsForEngine, context },
      model_version: LUNA_MODEL,
      prompt_version: LIVE_SEMANTIC_INTAKE_VERSION,
      schema_version: SCHEMA_VERSION
    });
    const answeredRepairPhase = repairTurnPhase(currentTurn);
    const answeredCalibration = String((currentTurn.review_result ?? {}).kind) === "goal_calibration";
    const workingBlueprint = session.blueprint;
    const previousQuestionTexts = turnsForEngine.map((turn) => String(turn.question_text ?? "")).filter(Boolean);
    const dynamic = await runLiveSemanticIntakeTurn({
      operation: "continue_intake",
      goal_text: session.goal_text,
      intake_level: session.level,
      route_hint: session.preliminary_route,
      temporal_context: temporalContext,
      profile: context.profile,
      active_goals: context.active_goals,
      prior_turns: turnsForEngine,
      previous_blueprint: workingBlueprint,
      latest_answer: { question_key: currentTurn.question_key, question: currentTurn.question_text, answer: body.answer, semantic_review: answerQuality.review }
    }, {
      askedKeys,
      questionCount: session.question_count,
      cap: session.max_questions,
      intakeLevel: session.level,
      previousBlueprint: workingBlueprint,
      repairPhase: answeredRepairPhase === "proposal" ? "verification" : answeredRepairPhase,
      previousQuestionTexts,
      answeredCalibration
    });
    const result = dynamic.result;
    const question = result.question;
    const nextBlueprint = { ...result.blueprint, coverage: result.coverage, viability: result.viability, goal_calibration: result.goal_calibration };
    const nextRevision = recordedRevision + 1;
    const nextQuestionCount = Number(session.question_count) + (question ? 1 : 0);
    if (nextQuestionCount > Number(session.max_questions)) throw new ApiError(502, "semantic_question_cap_exceeded", "Future You attempted to exceed the intake safety cap.");
    const sessionPatch = {
      status: nextStatus(String(result.next_action)),
      safety: result.safety.status,
      preliminary_route: result.route,
      blueprint: nextBlueprint,
      fact_ledger: result.fact_ledger,
      question_count: nextQuestionCount,
      next_action: result.next_action,
      stop_reason: result.stop_reason,
      cautious_starter: result.cautious_starter
    };
    const nextTurn = question ? {
      sequence: turnsForEngine.length + 1,
      question_key: question.key,
      question_text: question.text,
      control: question.control,
      options: question.options,
      blueprint_link: question.blueprint_link,
      plan_impacts: question.plan_impacts,
      activation_rule: question.activation_rule,
      // Same real-verdict mapping as startIntake (see comment there): impact/skip/utility
      // reflect the independent grader's actual checks, not a hard-coded pass.
      review_result: { impact: dynamic.questionQuality.grader?.checks?.impact === true, skip: dynamic.questionQuality.grader?.checks?.evidence === true, utility: dynamic.questionQuality.grader?.checks?.priority === true, kind: question.kind, phase: question.repair_phase, why_needed: question.why_needed, question_brief: question.brief, quality_gate: dynamic.questionQuality, source: "semantic_evidence_intake_v6_dynamic" }
    } : null;
    const { data: committed, error: commitError } = await ctx.admin.rpc("commit_future_you_reassessment", {
      p_user_id: ctx.user.id,
      p_session_id: intakeId,
      p_expected_revision: recordedRevision,
      p_session_patch: sessionPatch,
      p_next_turn: nextTurn
    });
    if (commitError) {
      if (commitError.message.includes("stale_revision")) throw new ApiError(409, "stale_revision", "This intake changed. Reload before continuing.", "conflict");
      if (commitError.message.includes("question_not_current")) throw new ApiError(409, "question_not_current", "That question has already been answered or replaced.", "conflict");
      throw commitError;
    }
    const commit = Array.isArray(committed) ? committed[0] : committed;
    if (!commit || Number(commit.revision) !== nextRevision) throw new ApiError(500, "answer_commit_failed", "Future You could not safely save that answer.");
    const nextQuestionId = typeof commit.question_id === "string" ? commit.question_id : null;
    const updated = { ...session, ...sessionPatch, revision: nextRevision };
    const successInputTokens = dynamic.inputTokens + (answerQuality?.inputTokens ?? 0);
    const successOutputTokens = dynamic.outputTokens + (answerQuality?.outputTokens ?? 0);
    await completeRun(ctx.admin, runId, {
      status: "succeeded",
      structured_output: result,
      evidence_summary: result.evidence_summary,
      validation: { schema: true, evidence_contract: true, deterministic_turn_contract: true, completion_gate_proof: true, answer_saved_before_luna: true, semantic_state_controller: true, independent_question_grader: true, cap: true, revision: true, split_answer_commit: true, attempts: dynamic.attempts },
      latency_ms: Date.now() - started,
      input_tokens: successInputTokens,
      output_tokens: successOutputTokens,
      estimated_cost_usd: modelCost(LUNA_MODEL, successInputTokens, successOutputTokens)
    });
    return success(publicIntakeResponse(updated, result, nextQuestionId), nextRevision);
  } catch (error) {
    // Same accounting on failure: a rejected question or a failed grader call still
    // burned real Luna tokens, and those must be counted here rather than dropped.
    const usage = error instanceof ApiError ? error.usage : null;
    const failedInputTokens = Number(usage?.input_tokens ?? 0);
    const failedOutputTokens = Number(usage?.output_tokens ?? 0);
    if (runId) await completeRun(ctx.admin, runId, {
      status: error instanceof ApiError && error.code === "model_refusal" ? "refused" : "failed",
      error_code: error instanceof ApiError ? error.code : "unknown",
      input_tokens: failedInputTokens,
      output_tokens: failedOutputTokens,
      estimated_cost_usd: modelCost(LUNA_MODEL, failedInputTokens, failedOutputTokens)
    });
    throw new ApiError(503, "intake_reassessment_pending", "Your answer was saved, but Future You could not reassess it yet. Retry this answer to continue safely.", "needs_input");
  }
}
async function previewPlan(body, ctx, intakeId) {
  const expectedRevision = Number(body.expected_revision ?? 0);
  const { data: session, error: sessionError } = await ctx.admin.from("intake_sessions").select("*").eq("id", intakeId).eq("user_id", ctx.user.id).single();
  if (sessionError || !session) throw new ApiError(404, "intake_not_found", "This intake could not be found.");
  if (session.revision !== expectedRevision) throw new ApiError(409, "stale_revision", "This intake changed. Reload before previewing.", "conflict");
  if (session.status !== "ready_to_preview") throw new ApiError(409, "intake_not_ready", "Future You still needs information before building the plan.", "needs_input");
  const [{ data: turns }, context] = await Promise.all([
    ctx.admin.from("intake_turns").select("sequence,question_text,answer,blueprint_link,plan_impacts,review_result").eq("session_id", intakeId).order("sequence"),
    loadContext(ctx.admin, ctx.user.id)
  ]);
  const hadViabilityRepair = (turns ?? []).some((turn) => turn.review_result?.kind === "viability_repair");
  const temporalContext = buildTemporalContext(context);
  const requestId = crypto.randomUUID();
  const runId = await createRun(ctx.admin, {
    user_id: ctx.user.id,
    session_id: intakeId,
    run_type: "plan_preview",
    request_id: requestId,
    input_refs: { session_id: intakeId },
    input_snapshot: { goal_text: session.goal_text, route: session.preliminary_route, ledger: session.fact_ledger, context },
    model_version: MODEL,
    prompt_version: PLAN_PROMPT_VERSION,
    schema_version: SCHEMA_VERSION
  });
  try {
    const planInput = {
      operation: "build_plan_preview",
      goal_text: session.goal_text,
      intake_level: session.level,
      route: session.preliminary_route,
      blueprint: session.blueprint,
      fact_ledger: session.fact_ledger,
      cautious_starter: session.cautious_starter,
      temporal_context: temporalContext,
      viability_repair_occurred: hadViabilityRepair,
      ...context
    };
    const ai = await buildPlanWithFallback(planInput, hadViabilityRepair, session.cautious_starter === true);
    const plan = ai.parsed;
    const previewId = crypto.randomUUID();
    const integrityHash = await sha256(plan);
    const savedPreview = { ...plan, integrity_hash: integrityHash, model_version: MODEL, prompt_version: PLAN_PROMPT_VERSION, schema_version: SCHEMA_VERSION, engine_version: ENGINE_VERSION };
    const { data: updated, error: updateError } = await ctx.admin.from("intake_sessions").update({
      preview: savedPreview,
      preview_id: previewId,
      status: "previewed",
      revision: session.revision + 1
    }).eq("id", intakeId).eq("revision", expectedRevision).select("revision").single();
    if (updateError || !updated) throw new ApiError(409, "stale_revision", "This intake changed. Reload before previewing.", "conflict");
    await completeRun(ctx.admin, runId, {
      status: "succeeded",
      structured_output: plan,
      evidence_summary: plan.evidence_summary,
      validation: { schema: true, thirty_days: true, goal_gap_total: true, completed_content_empty: true },
      latency_ms: ai.latencyMs,
      input_tokens: ai.inputTokens,
      output_tokens: ai.outputTokens
    });
    return success({ preview_id: previewId, preview: plan.preview, todays_step: plan.todays_step, milestones: plan.milestones, success_markers: plan.success_markers, plan }, updated.revision);
  } catch (error) {
    await completeRun(ctx.admin, runId, { status: error instanceof ApiError && error.code === "model_refusal" ? "refused" : "failed", error_code: error instanceof ApiError ? error.code : "unknown" });
    throw error;
  }
}
async function approvePlan(body, ctx, intakeId) {
  const expectedRevision = Number(body.expected_revision ?? 0);
  const previewId = String(body.preview_id ?? "");
  const { data: session, error } = await ctx.admin.from("intake_sessions").select("*").eq("id", intakeId).eq("user_id", ctx.user.id).single();
  if (error || !session) throw new ApiError(404, "intake_not_found", "This intake could not be found.");
  if (session.status !== "previewed" || session.preview_id !== previewId) throw new ApiError(409, "preview_not_current", "This preview is no longer current.", "conflict");
  const plan = session.preview;
  validatePlanOutput(plan);
  const { data: approved, error: approveError } = await ctx.admin.rpc("approve_future_you_intake", {
    p_user_id: ctx.user.id,
    p_session_id: intakeId,
    p_expected_revision: expectedRevision,
    p_preview_id: previewId,
    p_goal: { ...plan.goal, ...plan.bucket_tag },
    p_original_plan: plan,
    p_live_plan: plan,
    p_today_step: plan.todays_step,
    p_schema_version: SCHEMA_VERSION,
    p_prompt_version: PLAN_PROMPT_VERSION,
    p_engine_version: ENGINE_VERSION,
    p_integrity_hash: plan.integrity_hash
  });
  if (approveError) {
    if (approveError.message.includes("active_goal_limit")) throw new ApiError(409, "active_goal_limit", "You already have three active goals.", "conflict");
    if (approveError.message.includes("stale_revision")) throw new ApiError(409, "stale_revision", "This preview changed. Reload before approving.", "conflict");
    throw approveError;
  }
  return success({ ...approved, goal: plan.goal, todays_step: plan.todays_step }, approved.record_revision);
}
async function getDashboard(ctx, goalId) {
  const [{ data: goal, error: goalError }, { data: step, error: stepError }] = await Promise.all([
    ctx.admin.from("goals").select("id,goal_text,operational_meaning,bucket,tag,state,active_slot,record_version").eq("id", goalId).eq("user_id", ctx.user.id).single(),
    ctx.admin.from("current_steps").select("id,action,amount,anchor,minimum_version,success_marker,why_text,how_text,note,live_plan_revision").eq("goal_id", goalId).eq("user_id", ctx.user.id).single()
  ]);
  if (goalError || !goal) throw new ApiError(404, "goal_not_found", "This goal could not be found.");
  if (stepError) throw stepError;
  return success({ goal, todays_step: step }, goal.record_version);
}
async function claimIdempotency(ctx, key, operation) {
  const now = /* @__PURE__ */ new Date();
  const values = {
    user_id: ctx.user.id,
    key,
    operation,
    status: "processing",
    response: null,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1e3).toISOString()
  };
  const { error: insertError } = await ctx.admin.from("idempotency_keys").insert(values);
  if (!insertError) return null;
  if (insertError.code !== "23505") throw insertError;
  const readExisting = async () => {
    const { data, error } = await ctx.admin.from("idempotency_keys").select("status,response,created_at").eq("user_id", ctx.user.id).eq("key", key).eq("operation", operation).maybeSingle();
    if (error) throw error;
    return data;
  };
  let existing = await readExisting();
  if (existing?.status === "succeeded" && existing.response) return json(200, existing.response);
  const startedAt = existing?.created_at ? new Date(existing.created_at).getTime() : 0;
  const isFresh = existing?.status === "processing" && Date.now() - startedAt < 6e4;
  if (isFresh) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      existing = await readExisting();
      if (existing?.status === "succeeded" && existing.response) return json(200, existing.response);
      if (existing?.status === "failed") break;
    }
    if (existing?.status === "processing") {
      throw new ApiError(409, "request_in_progress", "Future You is still finishing that answer. Please wait a moment.", "conflict");
    }
  }
  const priorCreatedAt = existing?.created_at;
  let reclaim = ctx.admin.from("idempotency_keys").update(values).eq("user_id", ctx.user.id).eq("key", key).eq("operation", operation);
  if (priorCreatedAt) reclaim = reclaim.eq("created_at", priorCreatedAt);
  const { data: reclaimed, error: reclaimError } = await reclaim.select("key").maybeSingle();
  if (reclaimError) throw reclaimError;
  if (reclaimed) return null;
  existing = await readExisting();
  if (existing?.status === "succeeded" && existing.response) return json(200, existing.response);
  throw new ApiError(409, "request_in_progress", "Future You is still finishing that answer. Please wait a moment.", "conflict");
}
async function routeRequest(req) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const ctx = await getAuthorizedContext(req);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const rootIndex = parts.lastIndexOf("future-you-engine");
  const path = rootIndex >= 0 ? parts.slice(rootIndex + 1) : parts;
  const operation = `${req.method}:${path.join("/")}`;
  const clientIdempotencyKey = req.headers.get("Idempotency-Key")?.trim() ?? "";
  const isAnswerRequest = req.method === "POST" && path.length === 3 && path[0] === "intakes" && path[2] === "answers";
  const questionId = String(body.question_id ?? "").trim();
  const idempotencyKey = isAnswerRequest && questionId ? `answer:${path[1]}:${questionId}` : clientIdempotencyKey;
  if (req.method === "POST") {
    if (!idempotencyKey || idempotencyKey.length > 200) throw new ApiError(400, "invalid_idempotency_key", "This request needs a valid idempotency key.");
    const existingResponse = await claimIdempotency(ctx, idempotencyKey, operation);
    if (existingResponse) return existingResponse;
  }
  try {
    let response;
    if (req.method === "POST" && path.length === 1 && path[0] === "intakes") response = await startIntake(req, body, ctx);
    else if (req.method === "POST" && path.length === 3 && path[0] === "intakes" && path[2] === "answers") response = await answerIntake(body, ctx, path[1]);
    else if (req.method === "POST" && path.length === 3 && path[0] === "intakes" && path[2] === "preview") response = await previewPlan(body, ctx, path[1]);
    else if (req.method === "POST" && path.length === 3 && path[0] === "intakes" && path[2] === "approve") response = await approvePlan(body, ctx, path[1]);
    else if (req.method === "POST" && path.length === 1 && path[0] === "batches") response = await createBatch(body, ctx);
    else if (req.method === "GET" && path.length === 1 && path[0] === "batches") response = await listBatches(ctx);
    else if (req.method === "GET" && path.length === 2 && path[0] === "batches") response = success(await hydrateBatch(ctx, path[1]));
    else if (req.method === "POST" && path.length === 3 && path[0] === "batches" && path[2] === "run") response = await processBatch(ctx, path[1]);
    else if (req.method === "POST" && path.length === 3 && path[0] === "batches" && path[2] === "cancel") response = await cancelBatch(ctx, path[1]);
    else if (req.method === "POST" && path.length === 3 && path[0] === "batches" && path[2] === "analyze") response = await analyzeBatch(ctx, path[1]);
    else if (req.method === "POST" && path.length === 3 && path[0] === "batch-cases" && path[2] === "rerun") response = await rerunBatchCase(ctx, path[1]);
    else if (req.method === "POST" && path.length === 3 && path[0] === "batch-cases" && path[2] === "review") response = await reviewBatchCase(body, ctx, path[1]);
    else if (req.method === "GET" && path.length === 3 && path[0] === "goals" && path[2] === "dashboard") response = await getDashboard(ctx, path[1]);
    else response = failure(404, "route_not_found", "That Future You route does not exist.");
    if (req.method === "POST" && response.ok) {
      const stored = await response.clone().json();
      const { error: storeError } = await ctx.admin.from("idempotency_keys").update({ status: "succeeded", response: stored }).eq("user_id", ctx.user.id).eq("key", idempotencyKey).eq("operation", operation);
      if (storeError) throw storeError;
    }
    return response;
  } catch (error) {
    if (req.method === "POST") {
      await ctx.admin.from("idempotency_keys").update({ status: "failed" }).eq("user_id", ctx.user.id).eq("key", idempotencyKey).eq("operation", operation);
    }
    throw error;
  }
}
Deno.serve(async (req) => {
  try {
    return await routeRequest(req);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.statusCode >= 500) {
        console.error("Future You engine validation failed", { code: error.code, message: error.message });
        return failure(error.statusCode, error.code, "Future You needs another try. Nothing was saved.", error.responseStatus);
      }
      return failure(error.statusCode, error.code, error.message, error.responseStatus);
    }
    console.error("Unhandled Future You engine error", error);
    return failure(500, "internal_error", "Future You hit a temporary problem. No changes were saved.");
  }
});