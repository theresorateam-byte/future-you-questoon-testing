/**
 * Locked progress-update and adjustment boundary.
 *
 * Visible choices are generated from the current Live Plan step. They are
 * never generic status buttons, even though they normalize to the three
 * internal states used by the update engine.
 */

export const NORMALIZED_UPDATE_STATES = ["completed", "partly_completed", "not_today"] as const;
export const UPDATE_REASON_CATEGORIES = ["time", "capacity", "access", "emotion", "external_difficulty"] as const;
export const ADJUSTMENT_OUTCOMES = ["continue", "build", "ease", "switch"] as const;
export const VALIDATION_CHECKS = ["safeAndRealistic", "protectedOutcome", "guardrails", "planFit", "expertFit"] as const;

type RecordValue = Record<string, unknown>;

export type VisibleUpdateChoice = {
  id: string;
  label: string;
  normalizedState: typeof NORMALIZED_UPDATE_STATES[number];
};

export type UpdateValidationError = {
  path: string;
  code: "missing" | "invalid" | "mismatch";
  message: string;
};

const object = (value: unknown): RecordValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function currentTodayStep(plan: RecordValue) {
  const active = object(plan.currentStep) ?? object(plan.firstTodayStep);
  const prepare = object(plan.prepareAction);
  const source = active ?? prepare;
  if (!source || !text(source.action)) return null;
  const minimumVersion = text(source.minimumVersion) ? source.minimumVersion.trim() : source.action.trim();
  return {
    gate: active ? "active" : "prepare",
    action: source.action.trim(),
    minimumVersion,
    successMarker: text(source.successMarker) ? source.successMarker.trim() : null,
    why: text(source.why) ? source.why.trim() : null,
    how: text(source.how) ? source.how.trim() : null,
    note: text(source.note) ? source.note.trim() : null,
  };
}

/** Produces a small, step-specific first layer for Update Progress. */
export function buildVisibleUpdateChoices(plan: RecordValue): VisibleUpdateChoice[] {
  const step = currentTodayStep(plan);
  if (!step) return [];
  const partialLabel = step.minimumVersion === step.action
    ? `I made some progress on: ${step.action}`
    : `I did the smaller version: ${step.minimumVersion}`;
  return [
    { id: "completed_current_step", label: `I did: ${step.action}`, normalizedState: "completed" },
    { id: "completed_minimum_version", label: partialLabel, normalizedState: "partly_completed" },
    { id: "not_today_current_step", label: `I didn't get to: ${step.action}`, normalizedState: "not_today" },
  ];
}

export function validateProgressUpdateDraft(draft: RecordValue, visibleChoices: VisibleUpdateChoice[]) {
  const errors: UpdateValidationError[] = [];
  const selected = visibleChoices.find((choice) => choice.id === draft.selectedChoiceId);
  if (!selected) errors.push({ path: "selectedChoiceId", code: "invalid", message: "Choose one of the choices generated for the current step." });
  if (!text(draft.reasonCode)) errors.push({ path: "reasonCode", code: "missing", message: "Record one concise result or reason code." });

  const category = draft.reasonCategory;
  if (selected?.normalizedState !== "completed" && !UPDATE_REASON_CATEGORIES.includes(category as typeof UPDATE_REASON_CATEGORIES[number])) {
    errors.push({ path: "reasonCategory", code: "missing", message: "Partly Completed and Not Today updates require one of the five locked reason categories." });
  }
  if (category !== null && category !== undefined && !UPDATE_REASON_CATEGORIES.includes(category as typeof UPDATE_REASON_CATEGORIES[number])) {
    errors.push({ path: "reasonCategory", code: "invalid", message: "Use Time, Capacity, Access, Emotion, or External Difficulty." });
  }

  if (!Array.isArray(draft.variables)) {
    errors.push({ path: "variables", code: "missing", message: "Use an array for variable evidence, even when it is empty." });
  } else {
    for (let index = 0; index < draft.variables.length; index += 1) {
      const variable = object(draft.variables[index]);
      if (!variable || !text(variable.key) || !["temporary", "recurring", "resolved", "active", "unknown"].includes(String(variable.status))) {
        errors.push({ path: `variables[${index}]`, code: "invalid", message: "Each variable needs a key and a supported temporal status." });
      }
    }
  }
  if (draft.optionalNote !== undefined && draft.optionalNote !== null && typeof draft.optionalNote !== "string") {
    errors.push({ path: "optionalNote", code: "invalid", message: "The optional note must be text when provided." });
  }
  return { valid: errors.length === 0, errors, selectedChoice: selected ?? null };
}

export function validateAdjustmentCommit(
  draft: RecordValue,
  assessment: RecordValue,
  updateEvidenceId: string,
  validationResult: unknown,
  livePlanChange: unknown,
) {
  const errors: UpdateValidationError[] = [];
  const recommendation = object(assessment.planRecommendation);
  const outcome = String(draft.adjustmentOutcome ?? "");
  if (!ADJUSTMENT_OUTCOMES.includes(outcome as typeof ADJUSTMENT_OUTCOMES[number])) {
    errors.push({ path: "planDraft.adjustmentOutcome", code: "invalid", message: "Use Continue, Build, Ease, or Switch." });
  }
  if (!recommendation || recommendation.outcome !== outcome) {
    errors.push({ path: "planDraft.adjustmentOutcome", code: "mismatch", message: "The Live Plan outcome must match the applied Level 3 recommendation." });
  }

  const references = Array.isArray(assessment.evidenceReferences) ? assessment.evidenceReferences : [];
  if (!references.some((item) => object(item)?.evidenceId === updateEvidenceId)) {
    errors.push({ path: "assessment.evidenceReferences", code: "mismatch", message: "The applied assessment must cite this Progress Update's canonical evidence." });
  }

  const checks = object(validationResult);
  for (const key of VALIDATION_CHECKS) {
    const check = object(checks?.[key]);
    if (!check || check.status !== "pass" || !text(check.rationale)) {
      errors.push({ path: `validationResult.${key}`, code: "invalid", message: "Every locked validation check must pass with a rationale before saving." });
    }
  }
  if (!text(livePlanChange)) errors.push({ path: "livePlanChange", code: "missing", message: "Describe the smallest justified change, or state that the future plan held." });
  return { valid: errors.length === 0, errors };
}
