/**
 * Locked Action Plan gate. This intentionally rejects the legacy engine's
 * fixed 30-day schedule and composite "goal gap" score: neither is part of
 * the locked Future You contract. The first plan is a human-reviewable draft
 * rooted in the frozen I3 Source snapshot.
 */

export type PlanValidationError = {
  path: string;
  code: "missing" | "invalid" | "mismatch";
  message: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function draftText(value: unknown, path: string, errors: PlanValidationError[]) {
  if (!text(value)) errors.push({ path, code: "missing", message: "Provide a concrete value." });
}

function sourceValue(snapshot: Record<string, unknown>, key: string) {
  const item = record(snapshot[key]);
  return item && text(item.value) ? item.value.trim() : null;
}

export function validateInitialPlanDraft(draft: Record<string, unknown>, sourceSnapshot: Record<string, unknown>) {
  const errors: PlanValidationError[] = [];
  const requiredSourceFields = ["normalizedGoal", "safety", "realism", "capacity", "initialMode", "milestone", "guardrails"];
  const gate = sourceSnapshot.entryGate;
  const mode = sourceSnapshot.initialMode;

  if (draft.contractVersion !== "locked-v1") errors.push({ path: "contractVersion", code: "invalid", message: "Use the locked-v1 plan contract." });
  const references = draft.sourceReferences;
  if (!Array.isArray(references) || !references.every(text)) {
    errors.push({ path: "sourceReferences", code: "missing", message: "Name the Source fields this plan uses." });
  } else {
    const sourceReferences = references as string[];
    for (const field of requiredSourceFields) {
      if (!sourceReferences.includes(field)) errors.push({ path: "sourceReferences", code: "missing", message: `Reference Source field '${field}'.` });
    }
    for (const field of sourceReferences) {
      if (!(field in sourceSnapshot)) errors.push({ path: "sourceReferences", code: "invalid", message: `Source field '${field}' is not in the frozen handoff.` });
    }
  }

  const goal = record(draft.goal);
  draftText(goal?.intendedResult, "goal.intendedResult", errors);
  const normalizedGoal = sourceValue(sourceSnapshot, "normalizedGoal");
  if (normalizedGoal && goal?.intendedResult !== normalizedGoal) {
    errors.push({ path: "goal.intendedResult", code: "mismatch", message: "The plan must preserve the Source handoff's intended result." });
  }
  if (draft.entryGate !== gate) errors.push({ path: "entryGate", code: "mismatch", message: "The plan entry gate must match the frozen Source handoff." });
  if (draft.mode !== mode) errors.push({ path: "mode", code: "mismatch", message: "The starting mode must match the frozen Source handoff." });

  const milestones = draft.milestones;
  if (!Array.isArray(milestones) || milestones.length === 0 || !milestones.every(text)) {
    errors.push({ path: "milestones", code: "missing", message: "Provide at least one observable milestone." });
  }
  const successMarkers = draft.successMarkers;
  if (!Array.isArray(successMarkers) || successMarkers.length === 0 || !successMarkers.every(text)) {
    errors.push({ path: "successMarkers", code: "missing", message: "Provide observable success markers." });
  }
  const guardrails = draft.guardrails;
  if (!Array.isArray(guardrails) || guardrails.length === 0 || !guardrails.every(text)) {
    errors.push({ path: "guardrails", code: "missing", message: "Preserve the Source safety and reality guardrails." });
  }

  if (gate === "active") {
    const step = record(draft.firstTodayStep);
    draftText(step?.action, "firstTodayStep.action", errors);
    draftText(step?.minimumVersion, "firstTodayStep.minimumVersion", errors);
    draftText(step?.successMarker, "firstTodayStep.successMarker", errors);
  } else {
    const prepare = record(draft.prepareAction);
    draftText(prepare?.action, "prepareAction.action", errors);
    if (record(draft.firstTodayStep)) errors.push({ path: "firstTodayStep", code: "invalid", message: "A non-active gate may only define a prepare action." });
  }

  for (const legacyField of ["plan_days", "goal_gap", "thirtyDayPlan"]) {
    if (legacyField in draft) errors.push({ path: legacyField, code: "invalid", message: "Fixed day schedules and composite goal scores are not part of Locked v1." });
  }
  return { valid: errors.length === 0, errors };
}

/** A Live Plan may change only forward, with recorded evidence; Original Plan never changes. */
export function validateLivePlanRevision(draft: Record<string, unknown>, sourceSnapshot: Record<string, unknown>) {
  const liveSnapshot = { ...sourceSnapshot, entryGate: draft.entryGate, initialMode: draft.mode };
  const result = validateInitialPlanDraft(draft, liveSnapshot);
  const errors = result.errors;
  if (!text(draft.evidenceRationale)) errors.push({ path: "evidenceRationale", code: "missing", message: "Explain why the recorded evidence supports this Live Plan change." });
  if (!["active", "prepare", "not_ready"].includes(String(draft.entryGate))) errors.push({ path: "entryGate", code: "invalid", message: "Choose a valid entry gate." });
  if (!["tiny_start", "steady_build", "challenge"].includes(String(draft.mode))) errors.push({ path: "mode", code: "invalid", message: "Choose a valid mode." });
  return { valid: errors.length === 0, errors };
}
