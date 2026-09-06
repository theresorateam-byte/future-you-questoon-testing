/**
 * Locked Source (I3) handoff contract.
 *
 * This is deliberately a validator, not a plan generator. A source handoff may
 * describe only what the intake ledger supports. The later plan writer must use
 * a validated handoff as its input, which prevents a model or UI from silently
 * inventing a person's constraints, capacity, or readiness.
 */

export type SourceValidationError = {
  path: string;
  code: "missing" | "invalid" | "unsupported";
  message: string;
};

export type SourceHandoffDraft = Record<string, unknown>;

const buckets = new Set(["finish", "rhythm", "shift"]);
const modes = new Set(["tiny_start", "steady_build", "challenge"]);
const gates = new Set(["active", "prepare", "not_ready"]);
const confidence = new Set(["high", "provisional", "low"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function cited(value: unknown, path: string, knownFactKeys: Set<string>, errors: SourceValidationError[]) {
  const item = record(value);
  if (!item || !string(item.value)) {
    errors.push({ path, code: "missing", message: "Provide a concrete value." });
    return;
  }
  const factKeys = item.factKeys;
  if (!Array.isArray(factKeys) || factKeys.length === 0 || !factKeys.every(string)) {
    errors.push({ path: `${path}.factKeys`, code: "missing", message: "Cite at least one intake fact." });
    return;
  }
  for (const factKey of factKeys) {
    if (!knownFactKeys.has(factKey)) errors.push({ path: `${path}.factKeys`, code: "unsupported", message: `Fact '${factKey}' is not present in this intake.` });
  }
}

function enumValue(value: unknown, path: string, allowed: Set<string>, errors: SourceValidationError[]) {
  if (!string(value)) {
    errors.push({ path, code: "missing", message: "Choose a value." });
  } else if (!allowed.has(value)) {
    errors.push({ path, code: "invalid", message: `Unsupported value '${value}'.` });
  }
}

/**
 * Check the parts of the Source contract that must be decided before any
 * original/live plan exists. Values that make person-specific claims require
 * fact-key citations from the immutable/current intake ledger.
 */
export function validateSourceHandoffDraft(draft: SourceHandoffDraft, knownFactKeys: string[]) {
  const errors: SourceValidationError[] = [];
  const facts = new Set(knownFactKeys);

  cited(draft.normalizedGoal, "normalizedGoal", facts, errors);
  enumValue(draft.goalBucket, "goalBucket", buckets, errors);
  cited(draft.goalDomain, "goalDomain", facts, errors);
  cited(draft.routeBinding, "routeBinding", facts, errors);
  cited(draft.safety, "safety", facts, errors);
  cited(draft.realism, "realism", facts, errors);
  enumValue(draft.entryGate, "entryGate", gates, errors);
  cited(draft.goalGap, "goalGap", facts, errors);
  cited(draft.capacity, "capacity", facts, errors);
  enumValue(draft.initialMode, "initialMode", modes, errors);
  cited(draft.l3InitialState, "l3InitialState", facts, errors);
  enumValue(record(draft.l3InitialState)?.confidence, "l3InitialState.confidence", confidence, errors);
  cited(draft.milestone, "milestone", facts, errors);
  if (draft.entryGate === "active") cited(draft.firstTodayStep, "firstTodayStep", facts, errors);
  else cited(draft.prepareAction, "prepareAction", facts, errors);
  cited(draft.successMarkers, "successMarkers", facts, errors);
  cited(draft.guardrails, "guardrails", facts, errors);

  if (draft.entryGate !== "active" && string(record(draft.firstTodayStep)?.value)) {
    errors.push({ path: "firstTodayStep", code: "invalid", message: "Do not prescribe an active first step while the entry gate is not active." });
  }

  return { valid: errors.length === 0, errors };
}
