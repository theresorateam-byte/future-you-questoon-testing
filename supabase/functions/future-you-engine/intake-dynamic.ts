export const LIVE_SEMANTIC_INTAKE_VERSION = "future-you-semantic-intake-v6.0-dynamic";
export const QUICK_START_MAX_QUESTIONS = 5;
export const FULL_PLAN_SAFETY_CAP = 18;
export const MAX_INTAKE_INPUT_TOKENS = 16_000;
export const MAX_INTAKE_OUTPUT_TOKENS = 4_000;

export function intakeCapForLevel(level: string): number {
  return level === "quick_start" ? QUICK_START_MAX_QUESTIONS : FULL_PLAN_SAFETY_CAP;
}

export const COMPLETION_GATE_KEYS = [
  "outcome_defined",
  "current_state_known",
  "success_measurable",
  "time_capacity_known",
  "access_resources_known",
  "constraints_nonnegotiables_known",
  "barriers_risks_known",
  "support_dependencies_known",
  "goal_specific_resolved",
  "realism_viable",
  "contradictions_resolved",
  "required_plan_fields_evidenced"
] as const;

const FACT_ROLES = [
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
] as const;

const GATE_ROLE_REQUIREMENTS: Partial<Record<typeof COMPLETION_GATE_KEYS[number], string[]>> = {
  outcome_defined: ["outcome_definition"],
  current_state_known: ["current_state"],
  success_measurable: ["success_definition"],
  time_capacity_known: ["time_or_cadence", "capacity"],
  access_resources_known: ["access_resources"],
  constraints_nonnegotiables_known: ["constraints_nonnegotiables"],
  barriers_risks_known: ["barriers_risks"],
  support_dependencies_known: ["support_dependencies"],
  goal_specific_resolved: ["goal_specific"],
  realism_viable: ["realism"]
};

const ROUTE_TAGS = [
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
] as const;

const optionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 60 },
    label: { type: "string", minLength: 1, maxLength: 110 }
  }
};

const factMutationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id", "operation", "role", "label", "required", "applicable", "status",
    "evidence_ids", "exact_support", "value", "why_needed"
  ],
  properties: {
    id: { type: "string", pattern: "^[a-z][a-z0-9_]{1,59}$" },
    operation: { enum: ["upsert", "retire"] },
    role: { enum: [...FACT_ROLES] },
    label: { type: "string", minLength: 3, maxLength: 120 },
    required: { type: "boolean" },
    applicable: { type: "boolean" },
    status: { enum: ["confirmed", "uncertain", "conflicting", "not_applicable", "retired"] },
    evidence_ids: { type: "array", maxItems: 8, items: { type: "string", minLength: 3, maxLength: 80 } },
    exact_support: { type: "string", maxLength: 500 },
    value: { type: "string", maxLength: 500 },
    why_needed: { type: "string", minLength: 5, maxLength: 180 }
  }
};

const gateItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "fact_ids", "reason"],
  properties: {
    status: { enum: ["passed", "missing", "conflicting"] },
    fact_ids: { type: "array", maxItems: 16, items: { type: "string" } },
    reason: { type: "string", minLength: 3, maxLength: 240 }
  }
};

const questionSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["fact_id", "text", "control", "options", "why_needed", "kind"],
  properties: {
    fact_id: { type: "string", minLength: 2, maxLength: 60 },
    text: { type: "string", minLength: 3, maxLength: 240 },
    control: { enum: ["text", "single_select", "multi_select", "number", "date", "time"] },
    options: { type: "array", maxItems: 8, items: optionSchema },
    why_needed: { type: "string", minLength: 5, maxLength: 180 },
    kind: { enum: ["intake", "viability_repair"] }
  }
};

const gateProperties = Object.fromEntries(COMPLETION_GATE_KEYS.map((key) => [key, gateItemSchema]));

export const liveIntakeTurnSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "goal_understanding", "fact_mutations", "completion_gate", "required_plan_fields",
    "next_action", "question", "missing_facts", "safety"
  ],
  properties: {
    goal_understanding: {
      type: "object",
      additionalProperties: false,
      required: ["normalized_goal", "bucket", "tag", "target_outcome", "success_definition"],
      properties: {
        normalized_goal: { type: "string", minLength: 3, maxLength: 500 },
        bucket: { enum: ["finish", "rhythm", "shift"] },
        tag: { enum: [...ROUTE_TAGS] },
        target_outcome: { type: "string", minLength: 3, maxLength: 300 },
        success_definition: { type: "string", minLength: 3, maxLength: 300 }
      }
    },
    fact_mutations: { type: "array", maxItems: 32, items: factMutationSchema },
    completion_gate: {
      type: "object",
      additionalProperties: false,
      required: [...COMPLETION_GATE_KEYS],
      properties: gateProperties
    },
    required_plan_fields: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field_key", "required", "status", "fact_ids"],
        properties: {
          field_key: { type: "string", pattern: "^[a-z][a-z0-9_]{1,59}$" },
          required: { type: "boolean" },
          status: { enum: ["passed", "missing", "conflicting"] },
          fact_ids: { type: "array", maxItems: 16, items: { type: "string" } }
        }
      }
    },
    next_action: { enum: ["ask_question", "complete", "cautious_starter", "stop_redirect"] },
    question: questionSchema,
    missing_facts: { type: "array", maxItems: 32, items: { type: "string", minLength: 2, maxLength: 160 } },
    safety: {
      type: "object",
      additionalProperties: false,
      required: ["status", "message", "evidence_ids"],
      properties: {
        status: { enum: ["pass", "stop_redirect"] },
        message: { type: "string", maxLength: 300 },
        evidence_ids: { type: "array", maxItems: 8, items: { type: "string" } }
      }
    }
  }
};

export const liveIntakeInstructions = `You own the next Future You intake decision for one literal goal.

Reassess the original goal, every stored evidence item, the entire current fact map, every uncertainty, every conflict, every prior question, every goal-specific requirement, and every completion-gate field on this turn.

Evidence contract:
- Real evidence is only the original goal text or a direct user answer in evidence_items.
- A confirmed or not_applicable fact must cite an evidence_id and include exact_support copied verbatim from that evidence item.
- Never confirm a fact from a category, profile, default, assumption, inference, or earlier model statement.
- Preserve valid existing facts, but use fact_mutations to update, add, conflict, mark not applicable, or retire facts as the evidence changes.
- On later turns, fact_mutations is a delta: return only facts that changed, were added, became conflicting or not applicable, or were retired. Never repeat unchanged facts.
- On the first turn, create a fact for every universal role plus the goal-specific and realism roles.
- A conflicting fact must cite at least two distinct evidence items.

Question contract:
- Return no question list and no future question plan.
- Return exactly one best next question only when next_action is ask_question.
- The question must resolve one unresolved fact and materially change the plan.
- Do not ask for information already confirmed.
- If an answer resolves a broad fact but exposes a new missing detail, add a new unresolved fact and target that new fact. Never mark a fact confirmed and ask it again in the same response.
- After a vague, uncertain, skipped, or off-topic answer, ask a materially different clarification. Never repeat the exact question text.
- Do not use a fixed category library or category-first selection.
- Keep the question to one sentence, one question mark, and at most 22 words.

Completion contract:
- Mark every completion_gate field independently.
- A passed gate field must cite confirmed fact_ids supported by real evidence.
- Every required plan field must point to confirmed facts.
- Return complete only when every gate field passes, every required plan field passes, realism is viable, no required fact is unresolved, and no conflict remains.
- Full Plan has no target question count. Continue until complete unless safety_cap_reached is true.
- When safety_cap_reached is true and completion is not valid, return cautious_starter and name every missing fact.
- Return stop_redirect only for an explicit safety boundary.
`;

export type EvidenceItem = {
  id: string;
  source: "goal_text" | "user_answer";
  text: string;
  question_key?: string;
  question_text?: string;
};

export type IntakeUsage = {
  call_count: number;
  input_tokens: number;
  output_tokens: number;
};

export function addIntakeUsage(current: Partial<IntakeUsage>, addition: Partial<IntakeUsage> | null | undefined): IntakeUsage {
  return {
    call_count: Number(current.call_count ?? 0) + Number(addition?.call_count ?? 0),
    input_tokens: Number(current.input_tokens ?? 0) + Number(addition?.input_tokens ?? 0),
    output_tokens: Number(current.output_tokens ?? 0) + Number(addition?.output_tokens ?? 0)
  };
}

function simulatedFactKey(question: any): string {
  const brief = asRecord(question?.brief);
  return String(brief.missing_fact_key ?? question?.fact_id ?? question?.blueprint_link ?? "").toLowerCase();
}

function simulatedAnswerText(question: any, goal: string, profile: any): string {
  const prompt = String(question?.text ?? "").toLowerCase();
  const factKey = simulatedFactKey(question);
  const factLabel = String(asRecord(question?.brief).missing_fact ?? "").toLowerCase();
  const context = `${factKey} ${factLabel} ${prompt}`;
  const goalText = goal.toLowerCase();
  const minutes = Number(profile?.available_minutes_per_day ?? 30);
  const days = Number(profile?.available_days_per_week ?? 3);
  const amount = Number(profile?.monthly_available_amount ?? 150);
  const constraints = asArray(profile?.constraints).map(String);

  if (/jurisdiction|country|state|province|territory|where .*found|where .*located/.test(context)) {
    return "It was found in Albany, New York, United States.";
  }
  if (/handwritten will|document detail|signature|witness|dated|library book/.test(context)) {
    return "The handwritten will is dated, signed, and names two people, but I do not see witness signatures.";
  }
  if (/child|pet/.test(context) && /cabinet|dangerous|unsafe|reach/.test(context)) {
    return "A child can currently reach the cabinet, which contains medicine and cleaning products.";
  }
  if (/caregiving|care hours|care task|parent|sibling|covered care|filled shift/.test(context)) {
    if (/success|result|working|arrangement/.test(context)) return "Success means all 14 weekly care hours are assigned and no medication or meal visits are missed.";
    if (/hour|task|need/.test(context)) return "My parent needs about 14 hours each week for medication, meals, transport, and household help.";
    return "My parent and two siblings must agree, and a case manager can help if we cannot agree.";
  }
  if (/mandarin|conversation|translation|speaking prompt|language/.test(context)) {
    return "Success is a five-minute Mandarin conversation about greetings, family, and daily routines, with one written prompt and no translation.";
  }
  if (/submission date|original date|deadline|due date/.test(context)) {
    return `The original deadline is October 15, 2026, and I can work for ${minutes} minutes on ${days} days each week.`;
  }

  if (/smoke alarm|smoke detector/.test(`${goalText} ${context}`)) {
    return "I have two smoke alarms: one in the hallway outside the bedrooms and one in the living room.";
  }
  if (/clinic|doctor|provider|appointment/.test(`${goalText} ${context}`)) {
    return "I use my neighborhood primary-care clinic, can book through its portal, and can attend weekday appointments after 4 PM.";
  }
  if (/transfer|monthly amount|available amount|budget|afford|money|saving|debt|expense|bill/.test(context)) {
    return `I can transfer $${amount} each month starting on my next payday.`;
  }
  if (/current state|baseline|right now|currently|starting point|already/.test(context)) {
    if (/walk/.test(goalText)) return "I currently walk about 10 minutes after work once a week.";
    return "I am starting near the beginning and currently work on this about once a week.";
  }
  if (/success|measur|done|complete|finish|outcome/.test(context)) {
    if (/walk/.test(goalText)) return `Success means walking for 20 minutes after work on ${days} days each week for one month.`;
    return `Success means I can verify the goal is complete on ${days} separate days or checkpoints.`;
  }
  if (/time|capacity|schedule|cadence|when|day|week|month/.test(context)) {
    return `I can use ${minutes} minutes on ${days} days each week, usually after work.`;
  }
  if (/access|resource|tool|equipment|location/.test(context)) {
    return "I have the basic tools, account access, transportation, and a place to do this.";
  }
  if (/constraint|nonnegotiable|must not change|cannot change/.test(context)) {
    return constraints.length > 0 ? `${constraints.join(" and ")} cannot change.` : "My work schedule cannot change.";
  }
  if (/barrier|risk|hardest|difficult|gets in the way|stops you/.test(context)) {
    return "My work schedule and low energy after work are the main barriers.";
  }
  if (/support|depend|help|approval|who else/.test(context)) {
    return profile?.support_reliability === "confirmed support"
      ? "One trusted person has agreed to help when needed."
      : "I am responsible for this and do not need anyone else's approval.";
  }
  if (/goal specific|specific requirement|detail/.test(context)) {
    return `The goal-specific requirement is to do this after work and keep it within ${minutes} minutes.`;
  }
  const subject = words(String(question?.text ?? "")).filter((word) => word.length > 3).slice(0, 6).join(" ");
  return `For ${subject || "this goal"}, my current answer is that it must fit within ${minutes} minutes on ${days} days each week.`;
}

export function simulatedAnswerForQuestion(question: any, goal: string, profile: any, turn = 0): { value: string; other_text: null } {
  const responseStyle = String(profile?.response_style ?? "direct");
  if (responseStyle === "vague") return { value: turn % 2 === 0 ? "I just want it to be better." : "Whatever is realistic.", other_text: null };
  if (responseStyle === "uncertain") return { value: "I am not sure yet.", other_text: null };
  if (responseStyle === "skipped") return { value: "I do not know.", other_text: null };
  if (String(question?.control) === "number") {
    const context = `${simulatedFactKey(question)} ${String(asRecord(question?.brief).missing_fact ?? "")} ${String(question?.text ?? "")}`.toLowerCase();
    if (/transfer|amount|budget|afford|money|saving/.test(context)) return { value: String(profile?.monthly_available_amount ?? 150), other_text: null };
    if (/minute|time|capacity/.test(context)) return { value: String(profile?.available_minutes_per_day ?? 30), other_text: null };
    if (/day|week|cadence|frequency/.test(context)) return { value: String(profile?.available_days_per_week ?? 3), other_text: null };
    if (/smoke alarm|smoke detector/.test(context)) return { value: "2", other_text: null };
  }
  const base = simulatedAnswerText(question, goal, profile);
  if (responseStyle === "contradictory" && turn > 1) return { value: `${base} My schedule may not actually allow that every week.`, other_text: null };
  if (responseStyle === "changing" && turn > 2) return { value: `${base} I am changing my earlier answer because this is the more realistic version.`, other_text: null };
  if (responseStyle === "detailed") return { value: `${base} I need this to work around my current responsibilities.`, other_text: null };
  return { value: base, other_text: null };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function answerText(answer: unknown): string {
  const record = asRecord(answer);
  const values = Array.isArray(record.value) ? record.value : [record.value];
  const selected = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  const other = typeof record.other_text === "string" ? record.other_text.trim() : "";
  return [selected.join(", "), other].filter(Boolean).join(": ");
}

function turnAnswerText(turn: any): string {
  const answer = asRecord(turn?.answer);
  const options = new Map(asArray(turn?.options).map((option) => [String(option?.id ?? ""), String(option?.label ?? option?.id ?? "")]));
  const values = Array.isArray(answer.value) ? answer.value : [answer.value];
  const selected = values.map((value) => {
    const raw = String(value ?? "").trim();
    return options.get(raw) || raw;
  }).filter(Boolean);
  const other = typeof answer.other_text === "string" ? answer.other_text.trim() : "";
  return [selected.join(", "), other].filter(Boolean).join(": ");
}

export function assessSimulatedAnswerQuality(question: any, answer: any): Record<string, any> {
  const text = answerText(answer).trim();
  const normalizedText = text.toLowerCase().replace(/[.!?]+$/g, "").trim();
  const uncertain = /^(?:i\s+)?(?:am\s+)?not sure(?: yet)?$|^unknown$|^i do not know$|^i don't know$|^not_sure$|^whatever is realistic$|^i just want it to be better$/.test(normalizedText);
  const contradictory = /may not actually|changing my earlier answer|more realistic version/.test(normalizedText);
  const control = String(question?.control ?? "text");
  const selectedControl = ["single_select", "multi_select", "number", "date", "time"].includes(control);
  const questionWords = new Set(words(String(question?.text ?? "")).filter((word) => word.length > 3 && !["what", "which", "would", "could", "your", "this", "that", "about", "including"].includes(word)));
  const answerWords = new Set(words(text).filter((word) => word.length > 3));
  const lexicalMatch = [...questionWords].some((word) => answerWords.has(word));
  const answersQuestion = !uncertain && (selectedControl || lexicalMatch);
  return {
    valid: true,
    answers_question: answersQuestion,
    specific_enough: answersQuestion,
    non_contradictory: !contradictory,
    uncertainty_preserved: uncertain || !answersQuestion || contradictory,
    clarification_question: null,
    source: "deterministic_answer_contract",
    question_key: question?.key
  };
}

export function buildEvidenceItems(goal: string, priorTurns: any[]): EvidenceItem[] {
  const items: EvidenceItem[] = [{ id: "goal_text", source: "goal_text", text: goal }];
  for (const turn of priorTurns) {
    const text = turnAnswerText(turn);
    if (!text) continue;
    const stableId = String(turn.id ?? turn.sequence ?? turn.question_key ?? "").trim();
    if (!stableId) throw new Error("answer_evidence_without_stable_id");
    items.push({
      id: `turn:${stableId}`,
      source: "user_answer",
      text,
      question_key: String(turn.question_key ?? ""),
      question_text: String(turn.question_text ?? turn.question ?? "")
    });
  }
  return items;
}

export function assertLiveInputTokenCeiling(inputTokens: number): number {
  if (!Number.isInteger(inputTokens) || inputTokens < 0) throw new Error("invalid_input_token_count");
  if (inputTokens > MAX_INTAKE_INPUT_TOKENS) throw new Error(`intake_input_token_ceiling_exceeded:${inputTokens}`);
  return inputTokens;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9$]+/g, " ").trim();
}

function supportAppearsInEvidence(support: string, evidenceIds: string[], evidence: Map<string, EvidenceItem>): boolean {
  if (!support.trim() || !evidenceIds.length) return false;
  const needle = normalized(support);
  return evidenceIds.some((id) => {
    const item = evidence.get(id);
    return item ? normalized(item.text).includes(needle) : false;
  });
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function overlap(left: string, right: string): number {
  const a = new Set(words(left).filter((word) => word.length > 3));
  const b = new Set(words(right).filter((word) => word.length > 3));
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.min(a.size, b.size);
}

const forbiddenQuestionPatterns = [
  /^where are you now with\b/i,
  /^do you have what you need\b/i,
  /^how often do you want to do this\??$/i,
  /^how much time do you have each week for\b/i,
  /^what must stay unchanged while\b/i
];

function mergeFacts(previousFacts: any[], mutations: any[], evidence: Map<string, EvidenceItem>, corrections: string[]): any[] {
  const facts = new Map<string, any>();
  for (const prior of previousFacts) {
    const fact = structuredClone(prior);
    if (!fact.id || facts.has(String(fact.id))) throw new Error(`duplicate_prior_fact:${fact.id}`);
    facts.set(String(fact.id), fact);
  }
  const changed = new Set<string>();
  for (const rawMutation of mutations) {
    const mutation = structuredClone(rawMutation);
    const id = String(mutation.id ?? "");
    if (!id || changed.has(id)) throw new Error(`duplicate_fact_mutation:${id}`);
    changed.add(id);
    for (const evidenceId of asArray(mutation.evidence_ids).map(String)) {
      if (!evidence.has(evidenceId)) throw new Error(`unknown_evidence_reference:${id}:${evidenceId}`);
    }
    if (mutation.operation === "retire") {
      if (!facts.has(id)) throw new Error(`retire_unknown_fact:${id}`);
      facts.set(id, { ...facts.get(id), ...mutation, required: false, applicable: false, status: "retired" });
      continue;
    }
    if (mutation.status === "retired") throw new Error(`retired_fact_requires_retire_operation:${id}`);
    if (mutation.status === "confirmed" || mutation.status === "not_applicable") {
      if (!supportAppearsInEvidence(String(mutation.exact_support ?? ""), asArray(mutation.evidence_ids).map(String), evidence)) {
        corrections.push(`unsupported_fact_downgraded:${id}`);
        mutation.operation = "upsert";
        mutation.status = "uncertain";
        mutation.required = true;
        mutation.applicable = true;
        mutation.value = "";
        mutation.exact_support = "";
      }
    }
    if (mutation.status === "conflicting" && new Set(asArray(mutation.evidence_ids).map(String)).size < 2) {
      throw new Error(`conflict_without_two_evidence_items:${id}`);
    }
    if (mutation.status === "not_applicable" && (mutation.applicable || mutation.required)) {
      throw new Error(`invalid_not_applicable_fact:${id}`);
    }
    facts.set(id, mutation);
  }
  const active = [...facts.values()].filter((fact) => fact.status !== "retired");
  for (const role of FACT_ROLES) {
    if (!active.some((fact) => fact.role === role)) throw new Error(`missing_live_fact_role:${role}`);
  }
  return [...facts.values()];
}

function confirmedFact(fact: any): boolean {
  return fact && (fact.status === "confirmed" || fact.status === "not_applicable") && asArray(fact.evidence_ids).length > 0;
}

function validateGate(gate: any, facts: any[], requiredPlanFields: any[], corrections: string[]): { passed: boolean; proof: Record<string, any> } {
  const factMap = new Map(facts.map((fact) => [String(fact.id), fact]));
  const activeFacts = facts.filter((fact) => fact.status !== "retired");
  const activeConflicts = activeFacts.filter((fact) => fact.status === "conflicting");
  const proof: Record<string, any> = {};
  for (const key of COMPLETION_GATE_KEYS) {
    const item = asRecord(gate[key]);
    const ids = asArray(item.fact_ids).map(String);
    const roleRequirements = GATE_ROLE_REQUIREMENTS[key] ?? [];
    const requiredRoleFacts = activeFacts.filter((fact) => roleRequirements.includes(String(fact.role)) && fact.required && fact.applicable);
    const roleCoverage = roleRequirements.every((role) => {
      const matching = activeFacts.filter((fact) => fact.role === role);
      return matching.length > 0
        && matching.some((fact) => ids.includes(String(fact.id)) && confirmedFact(fact))
        && matching.filter((fact) => fact.required && fact.applicable).every((fact) => ids.includes(String(fact.id)) && confirmedFact(fact));
    });
    let proven = key === "contradictions_resolved"
      ? activeConflicts.length === 0 && (ids.length === 0 || ids.every((id) => confirmedFact(factMap.get(id))))
      : ids.length > 0 && ids.every((id) => confirmedFact(factMap.get(id)));
    if (roleRequirements.length) proven = proven && roleCoverage && requiredRoleFacts.every((fact) => ids.includes(String(fact.id)));
    if (key === "contradictions_resolved" && item.status === "passed" && activeConflicts.length) {
      throw new Error("contradictions_gate_passed_with_active_conflicts");
    }
    let status = String(item.status ?? "missing");
    if (status === "passed" && !proven) {
      corrections.push(`gate_downgraded_without_confirmed_evidence:${key}`);
      status = "missing";
    }
    proof[key] = {
      status,
      fact_ids: ids,
      evidence_ids: [...new Set(ids.flatMap((id) => asArray(factMap.get(id)?.evidence_ids).map(String)))],
      reason: String(item.reason ?? ""),
      deterministically_proven: status === "passed" && proven
    };
  }
  for (const field of requiredPlanFields) {
    const ids = asArray(field.fact_ids).map(String);
    if (field.required && field.status === "passed" && (!ids.length || !ids.every((id) => confirmedFact(factMap.get(id))))) {
      corrections.push(`plan_field_downgraded_without_confirmed_evidence:${field.field_key}`);
      field.status = "missing";
    }
  }
  const requiredFieldFactIds = [...new Set(requiredPlanFields.filter((field) => field.required).flatMap((field) => asArray(field.fact_ids).map(String)))];
  const planFieldGateIds = asArray(gate.required_plan_fields_evidenced?.fact_ids).map(String);
  if (proof.required_plan_fields_evidenced?.status === "passed" && (!requiredFieldFactIds.every((id) => planFieldGateIds.includes(id)) || requiredPlanFields.some((field) => field.required && field.status !== "passed"))) {
    corrections.push("required_plan_fields_gate_downgraded");
    proof.required_plan_fields_evidenced.status = "missing";
    proof.required_plan_fields_evidenced.deterministically_proven = false;
  }
  const requiredFieldsPassed = requiredPlanFields.filter((field) => field.required).every((field) => field.status === "passed");
  const passed = COMPLETION_GATE_KEYS.every((key) => proof[key].deterministically_proven === true) && requiredFieldsPassed && activeConflicts.length === 0;
  return { passed, proof };
}

function priorAnswerWasNonResolving(turn: any, targetFactStillUnresolved: boolean): boolean {
  // The live evidence map is authoritative: if the fact this question targets is still
  // not confirmed/not_applicable after the prior turn, the prior answer plainly didn't
  // resolve it, regardless of what the model self-reported about its own past answer.
  if (targetFactStillUnresolved) return true;
  const quality = asRecord(turn?.answer_quality ?? turn?.semantic_review);
  if (quality.specific_enough === false || quality.uncertainty_preserved === true || quality.answers_question === false || quality.non_contradictory === false) return true;
  const text = answerText(turn?.answer).toLowerCase();
  return /^(i just want it to be better|whatever is realistic|i am not sure yet|i do not know|not sure|unknown)\.?$/.test(text);
}

function validateQuestion(question: any, facts: any[], previousQuestionTexts: string[], previousTurns: any[]): void {
  if (!question) throw new Error("missing_next_question");
  const target = facts.find((fact) => fact.id === question.fact_id);
  if (!target || target.status === "confirmed" || target.status === "not_applicable" || target.status === "retired") {
    throw new Error("question_targets_resolved_fact");
  }
  const text = String(question.text ?? "");
  if (!text.endsWith("?") || (text.match(/\?/g) ?? []).length !== 1 || words(text).length > 22) {
    throw new Error("invalid_question_shape");
  }
  if (forbiddenQuestionPatterns.some((pattern) => pattern.test(text))) throw new Error("forbidden_question_pattern");
  for (const priorText of previousQuestionTexts) {
    const exactRepeat = normalized(text) === normalized(priorText);
    if (exactRepeat) throw new Error("duplicate_question_exact");
    if (overlap(text, priorText) < 0.85) continue;
    const priorTurn = previousTurns.find((turn) => String(turn.question_text ?? turn.question ?? "") === priorText);
    const priorFactId = String(priorTurn?.target_fact_id ?? priorTurn?.fact_id ?? "");
    const sameUnresolvedFact = !priorFactId || priorFactId === String(question.fact_id);
    const priorFactRecord = facts.find((fact) => String(fact.id) === priorFactId);
    const targetFactStillUnresolved = !priorFactRecord || !["confirmed", "not_applicable"].includes(String(priorFactRecord.status));
    if (!(sameUnresolvedFact && priorAnswerWasNonResolving(priorTurn, targetFactStillUnresolved))) throw new Error("duplicate_question_meaning");
  }
  const needsOptions = ["single_select", "multi_select"].includes(String(question.control));
  if (needsOptions !== (asArray(question.options).length >= 2)) throw new Error("question_control_options_mismatch");
}

function gateStatus(gateItem: any): { status: string; reason: string; evidence_keys: string[] } {
  const item = asRecord(gateItem);
  return {
    status: item.status === "passed" ? "known" : item.status === "conflicting" ? "conflicting" : "missing",
    reason: String(item.reason ?? ""),
    evidence_keys: asArray(item.fact_ids).map(String)
  };
}

export function validateAndBuildLiveResult(args: {
  goal: string;
  output: any;
  previousState: any;
  evidenceItems: EvidenceItem[];
  previousQuestionTexts: string[];
  previousTurns?: any[];
  questionCount: number;
  cap: number;
  intakeLevel: string;
}): any {
  const output = asRecord(args.output);
  const previousState = asRecord(args.previousState);
  const evidenceMap = new Map(args.evidenceItems.map((item) => [item.id, item]));
  const corrections: string[] = [];
  const facts = mergeFacts(asArray(previousState.facts), asArray(output.fact_mutations), evidenceMap, corrections);
  const requiredPlanFields = asArray(output.required_plan_fields).map((field) => structuredClone(field));
  const questionOutput = output.question ? structuredClone(output.question) : null;
  if (questionOutput) {
    const target = facts.find((fact) => String(fact.id) === String(questionOutput.fact_id));
    if (confirmedFact(target)) {
      let derivedId = `${String(target.id).slice(0, 45)}_detail_${args.questionCount + 1}`;
      while (facts.some((fact) => String(fact.id) === derivedId)) derivedId = `${derivedId.slice(0, 56)}_new`;
      facts.push({
        ...structuredClone(target),
        id: derivedId,
        label: `${String(target.label)} detail`,
        status: "uncertain",
        required: true,
        applicable: true,
        operation: "upsert",
        evidence_ids: [],
        exact_support: "",
        value: "",
        why_needed: String(questionOutput.why_needed ?? target.why_needed)
      });
      corrections.push(`resolved_question_target_split:${target.id}:${derivedId}`);
      questionOutput.fact_id = derivedId;
    }
  }
  const gateValidation = validateGate(output.completion_gate, facts, requiredPlanFields, corrections);
  const proof = gateValidation.proof;
  const unresolved = facts.filter((fact) => fact.status !== "retired" && fact.required && fact.applicable && fact.status !== "confirmed");
  const gatePassed = gateValidation.passed && unresolved.length === 0;
  const safetyStop = output.safety?.status === "stop_redirect";
  const capReached = args.questionCount >= args.cap;
  let nextAction = String(output.next_action ?? "");
  let nextQuestion = questionOutput;
  if (safetyStop) {
    nextAction = "stop_redirect";
    nextQuestion = null;
  } else if (gatePassed) {
    if (nextAction !== "complete") throw new Error("gate_passed_without_complete_action");
    nextAction = "build_plan";
    nextQuestion = null;
  } else if (capReached) {
    nextAction = "cautious_starter";
    nextQuestion = null;
  } else {
    if (nextAction !== "ask_question") throw new Error("incomplete_gate_without_question");
    validateQuestion(nextQuestion, facts, args.previousQuestionTexts, asArray(args.previousTurns));
  }
  if (!gatePassed && nextAction === "build_plan") throw new Error("completion_without_full_gate");
  if (nextAction === "ask_question" && capReached) throw new Error("question_cap_exceeded");
  const question = nextAction === "ask_question" ? {
    key: `q${args.questionCount + 1}`,
    text: String(nextQuestion.text),
    control: String(nextQuestion.control),
    options: asArray(nextQuestion.options),
    blueprint_link: `semantic_facts.${nextQuestion.fact_id}`,
    plan_impacts: [String(nextQuestion.why_needed)],
    activation_rule: "fact_unresolved",
    kind: String(nextQuestion.kind),
    repair_phase: nextQuestion.kind === "viability_repair" ? "proposal" : null,
    why_needed: String(nextQuestion.why_needed),
    brief: {
      missing_fact_key: String(nextQuestion.fact_id),
      missing_fact: String(facts.find((fact) => fact.id === nextQuestion.fact_id)?.label ?? nextQuestion.fact_id),
      main_topic: String(output.goal_understanding?.target_outcome ?? args.goal),
      known_context: [args.goal],
      why_it_changes_plan: String(nextQuestion.why_needed),
      evidence_keys_used: args.evidenceItems.map((item) => item.id),
      meaning_anchors: [String(output.goal_understanding?.target_outcome ?? args.goal).slice(0, 100)],
      facts_not_to_reask: args.previousQuestionTexts
    }
  } : null;
  const known = facts.filter((fact) => fact.status === "confirmed").map((fact) => ({
    key: fact.id,
    label: fact.label,
    value: fact.value,
    source: fact.evidence_ids?.[0] === "goal_text" ? "goal_text" : "user_answer",
    evidence_ids: fact.evidence_ids,
    exact_support: fact.exact_support,
    plan_impacts: [fact.why_needed],
    activation_rule: fact.applicable ? "required_for_this_goal" : "not_applicable"
  }));
  const essential = unresolved.map((fact) => ({
    key: fact.id,
    label: fact.label,
    value: fact.value || "Unknown",
    status: fact.status,
    source: fact.evidence_ids?.[0] === "goal_text" ? "goal_text" : fact.evidence_ids?.length ? "user_answer" : "none",
    evidence_ids: fact.evidence_ids,
    exact_support: fact.exact_support,
    plan_impacts: [fact.why_needed],
    activation_rule: "required_for_this_goal"
  }));
  const missingFacts = [...new Set([
    ...asArray(output.missing_facts).map(String),
    ...unresolved.map((fact) => String(fact.label)),
    ...COMPLETION_GATE_KEYS.filter((key) => proof[key].status !== "passed").map((key) => key)
  ])];
  const gate = Object.fromEntries(COMPLETION_GATE_KEYS.map((key) => [key, {
    ...asRecord(output.completion_gate?.[key]),
    status: proof[key].status,
    fact_ids: proof[key].fact_ids,
    reason: proof[key].reason
  }]));
  const state = {
    goal_understanding: output.goal_understanding,
    facts,
    completion_gate: gate,
    completion_gate_proof: proof,
    required_plan_fields: requiredPlanFields,
    evidence_ids: args.evidenceItems.map((item) => item.id),
    semantic_version: LIVE_SEMANTIC_INTAKE_VERSION
  };
  return {
    safety: {
      status: safetyStop ? "stop_redirect" : "pass",
      boundary_codes: safetyStop ? ["explicit_high_risk"] : [],
      short_user_message: String(output.safety?.message ?? ""),
      explicit_evidence: asArray(output.safety?.evidence_ids).map((id) => evidenceMap.get(String(id))?.text).filter(Boolean)
    },
    realism: {
      status: gatePassed ? "ready" : "needs_setup",
      constraints: proof.realism_viable.status === "conflicting" ? [proof.realism_viable.reason] : [],
      missing_setup: missingFacts
    },
    route: {
      bucket: output.goal_understanding?.bucket,
      bucket_confidence: 0.9,
      tag: output.goal_understanding?.tag,
      tag_confidence: 0.9,
      routing_question_needed: false
    },
    coverage: {
      universal: {
        outcome_definition: gateStatus(gate.outcome_defined),
        current_state: gateStatus(gate.current_state_known),
        success_definition: gateStatus(gate.success_measurable),
        time_or_cadence: gateStatus(gate.time_capacity_known),
        capacity: gateStatus(gate.time_capacity_known),
        access_resources: gateStatus(gate.access_resources_known),
        constraints_nonnegotiables: gateStatus(gate.constraints_nonnegotiables_known),
        barriers_risks: gateStatus(gate.barriers_risks_known),
        support_dependencies: gateStatus(gate.support_dependencies_known)
      },
      goal_specific: facts.filter((fact) => fact.role === "goal_specific").map((fact) => ({
        key: fact.id,
        label: fact.label,
        status: confirmedFact(fact) ? "known" : fact.status === "conflicting" ? "conflicting" : "missing",
        why_it_matters: fact.why_needed,
        evidence_keys: fact.evidence_ids
      })),
      gate_passed: gatePassed,
      completion_gate_proof: proof
    },
    viability: {
      status: proof.realism_viable.status === "passed" ? "viable" : proof.realism_viable.status === "conflicting" ? "needs_repair" : "pending",
      checks: COMPLETION_GATE_KEYS.map((key) => ({ type: key, status: proof[key].status === "passed" ? "pass" : proof[key].status === "conflicting" ? "fail" : "unknown", summary: proof[key].reason })),
      hard_issue: proof.realism_viable.status === "conflicting" ? proof.realism_viable.reason : null,
      repair_options: question?.kind === "viability_repair" ? question.options : []
    },
    goal_calibration: {
      status: gatePassed ? "realistic" : "pending",
      original_target: args.goal,
      recommended_target: null,
      committed_target: gatePassed ? output.goal_understanding?.normalized_goal : null,
      stretch_target: null,
      recommendation: null,
      reason: gatePassed ? "The full completion gate is proven by confirmed evidence." : "The completion gate still has missing or conflicting evidence.",
      assumptions: [],
      uncertainties: missingFacts,
      confirmed: gatePassed
    },
    blueprint: { semantic_intake_state: state, semantic_version: LIVE_SEMANTIC_INTAKE_VERSION },
    fact_ledger: {
      known,
      essential,
      conditional: facts.filter((fact) => ["not_applicable", "retired"].includes(String(fact.status))),
      optional: facts.filter((fact) => !fact.required && !["not_applicable", "retired"].includes(String(fact.status)))
    },
    next_action: nextAction,
    question,
    stop_reason: safetyStop ? String(output.safety?.message ?? "") : null,
    cautious_starter: nextAction === "cautious_starter",
    evidence_summary: {
      decision_basis: ["Literal goal text", "Direct user answers", "Live evidence-map reassessment"],
      missing_facts: missingFacts,
      guardrails_applied: [
        "One Luna question per turn",
        "Confirmed facts require immutable evidence references",
        "All completion-gate fields require deterministic proof",
        `${args.intakeLevel} question cap enforced at ${args.cap}`
      ],
      question_plan_exhausted: false,
      safety_cap_reached: capReached,
      done_definition_passed: gatePassed,
      completion_gate_proof: proof,
      required_plan_fields: requiredPlanFields,
      deterministic_corrections: corrections
    }
  };
}