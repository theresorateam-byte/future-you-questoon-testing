/**
 * Locked Level 3 assessment gate.
 *
 * This keeps interpretation distinct from plan writing: an assessment may
 * state what the topic-specific system currently knows and recommend a
 * Continue/Build/Ease/Switch response, but it cannot change a Live Plan.
 */
export type ProgressionValidationError = {
  path: string;
  code: "missing" | "invalid";
  message: string;
};

type RecordValue = Record<string, unknown>;
const outcomes = new Set(["continue", "build", "ease", "switch"]);
const applications = new Set(["supports", "limits", "contradicts", "requires_follow_up"]);
const roles = new Set(["primary", "secondary", "tertiary", "monitor", "maintain"]);
// Topic contracts use Low / Medium / High; the intake contract additionally
// uses Provisional. Keep all of those distinct from a fabricated score.
const confidence = new Set(["high", "medium", "provisional", "low", "unresolved"]);

function object(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Validates structure without assigning a universal score or inventing topic states. */
export function validateProgressionAssessment(
  draft: RecordValue,
  topicKey: string,
  knownEvidenceIds: string[],
) {
  const errors: ProgressionValidationError[] = [];
  const evidenceIds = new Set(knownEvidenceIds);
  if (draft.contractVersion !== "locked-v1") errors.push({ path: "contractVersion", code: "invalid", message: "Use the locked-v1 progression contract." });
  if (draft.topicKey !== topicKey) errors.push({ path: "topicKey", code: "invalid", message: "The assessment topic must match the goal's locked topic binding." });

  const state = object(draft.currentState);
  if (!state || Object.keys(state).length === 0) errors.push({ path: "currentState", code: "missing", message: "Provide the topic-specific current state; do not use a universal score." });
  const stateConfidence = object(draft.stateConfidence);
  if (!stateConfidence || !confidence.has(String(stateConfidence.level)) || !text(stateConfidence.rationale)) {
    errors.push({ path: "stateConfidence", code: "missing", message: "Provide a supported confidence level and rationale." });
  }
  const causalOwnership = object(draft.causalOwnership);
  if (!causalOwnership || !text(causalOwnership.status) || !text(causalOwnership.rationale)) {
    errors.push({ path: "causalOwnership", code: "missing", message: "State causal ownership or uncertainty and explain it." });
  }
  const roleEntries = draft.roles;
  if (!Array.isArray(roleEntries) || roleEntries.length === 0 || !roleEntries.every((item) => {
    const entry = object(item);
    return !!entry && text(entry.key) && roles.has(String(entry.role));
  })) errors.push({ path: "roles", code: "missing", message: "Provide one or more topic-unit roles using the locked role vocabulary." });

  const unresolved = draft.unresolved;
  if (!Array.isArray(unresolved)) errors.push({ path: "unresolved", code: "missing", message: "Use an array; preserve uncertainties and contradictions rather than averaging them away." });
  const nextTarget = object(draft.nextEvidenceTarget);
  if (!nextTarget || !text(nextTarget.question) || !text(nextTarget.decisionRelevance)) {
    errors.push({ path: "nextEvidenceTarget", code: "missing", message: "Name the decision-relevant next evidence target." });
  }

  const references = draft.evidenceReferences;
  if (!Array.isArray(references) || references.length === 0) {
    errors.push({ path: "evidenceReferences", code: "missing", message: "Cite one or more canonical evidence records." });
  } else {
    for (let index = 0; index < references.length; index += 1) {
      const reference = object(references[index]);
      if (!reference || !uuid(reference.evidenceId) || !evidenceIds.has(String(reference.evidenceId)) || !applications.has(String(reference.applicationType)) || !text(reference.rationale)) {
        errors.push({ path: `evidenceReferences[${index}]`, code: "invalid", message: "Each reference needs an evidence ID from this goal, an application type, and a rationale." });
      }
    }
  }

  const recommendation = draft.planRecommendation;
  if (recommendation !== null && recommendation !== undefined) {
    const item = object(recommendation);
    if (!item || !outcomes.has(String(item.outcome)) || !text(item.rationale)) {
      errors.push({ path: "planRecommendation", code: "invalid", message: "A plan recommendation may only propose Continue, Build, Ease, or Switch with rationale." });
    }
  }
  return { valid: errors.length === 0, errors };
}
