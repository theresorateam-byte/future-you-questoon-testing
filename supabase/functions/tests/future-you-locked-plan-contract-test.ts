import { assert, assertEquals } from "jsr:@std/assert@1.0.19";
import { validateInitialPlanDraft, validateLivePlanRevision } from "../future-you-locked/plan-contract.ts";

const cited = (value: string) => ({ value, factKeys: ["routine_target"] });
const source = {
  normalizedGoal: cited("Build a workable morning routine"),
  safety: cited("No safety concern identified"),
  realism: cited("A short morning window is available"),
  capacity: cited("Low but usable capacity"),
  initialMode: "tiny_start",
  milestone: cited("Complete the routine twice this week"),
  guardrails: cited("Keep the step under five minutes"),
  entryGate: "active",
};

Deno.test("Locked initial plan preserves the frozen Source handoff", () => {
  const result = validateInitialPlanDraft({
    contractVersion: "locked-v1",
    sourceReferences: ["normalizedGoal", "safety", "realism", "capacity", "initialMode", "milestone", "guardrails"],
    goal: { intendedResult: "Build a workable morning routine" },
    entryGate: "active",
    mode: "tiny_start",
    milestones: ["Complete the routine twice this week"],
    successMarkers: ["Two completions are recorded"],
    guardrails: ["Keep the step under five minutes"],
    firstTodayStep: { action: "Lay out the materials tonight", minimumVersion: "Place one item where you will see it", successMarker: "One item is ready" },
    completedPortion: [],
    remainingPlan: [{ action: "Lay out the materials tonight" }],
  }, source);
  assert(result.valid);
  assertEquals(result.errors, []);
});

Deno.test("Locked initial plan rejects legacy fixed schedules", () => {
  const result = validateInitialPlanDraft({ plan_days: [] }, source);
  assert(!result.valid);
  assert(result.errors.some((error) => error.path === "plan_days"));
});

Deno.test("Locked initial plan starts with no completed history and a remaining plan", () => {
  const result = validateInitialPlanDraft({
    contractVersion: "locked-v1", sourceReferences: ["normalizedGoal", "safety", "realism", "capacity", "initialMode", "milestone", "guardrails"],
    goal: { intendedResult: "Build a workable morning routine" }, entryGate: "active", mode: "tiny_start",
    milestones: ["Complete the routine twice this week"], successMarkers: ["Two completions are recorded"], guardrails: ["Keep the step under five minutes"],
    firstTodayStep: { action: "Lay out the materials tonight", minimumVersion: "Place one item", successMarker: "One item is ready" }, prepareAction: null,
    completedPortion: [{ action: "Invented history" }], remainingPlan: [],
  }, source);
  assert(!result.valid);
  assert(result.errors.some((error) => error.path === "completedPortion"));
  assert(result.errors.some((error) => error.path === "remainingPlan"));
});

Deno.test("Locked Live Plan can enter prepare mode with evidence rationale", () => {
  const result = validateLivePlanRevision({
    contractVersion: "locked-v1", sourceReferences: ["normalizedGoal", "safety", "realism", "capacity", "initialMode", "milestone", "guardrails"],
    goal: { intendedResult: "Build a workable morning routine" }, entryGate: "prepare", mode: "tiny_start", adjustmentOutcome: "ease", evidenceRationale: "The recorded evidence shows the morning window is unavailable this week.",
    milestones: ["Restore a workable morning window"], successMarkers: ["A realistic window is identified"], guardrails: ["Keep the step under five minutes"], firstTodayStep: null, prepareAction: { action: "Identify one workable morning window" },
    completedPortion: [], remainingPlan: [{ action: "Identify one workable morning window" }],
  }, source, { completedPortion: [] });
  assert(result.valid);
});

Deno.test("Locked Live Plan rejects a rewrite of completed history", () => {
  const result = validateLivePlanRevision({
    contractVersion: "locked-v1", sourceReferences: ["normalizedGoal", "safety", "realism", "capacity", "initialMode", "milestone", "guardrails"],
    goal: { intendedResult: "Build a workable morning routine" }, entryGate: "active", mode: "tiny_start", adjustmentOutcome: "continue", evidenceRationale: "The update supports holding the plan.",
    milestones: ["Complete the routine twice this week"], successMarkers: ["Two completions are recorded"], guardrails: ["Keep the step under five minutes"],
    firstTodayStep: { action: "Lay out the materials tonight", minimumVersion: "Place one item", successMarker: "One item is ready" }, prepareAction: null,
    completedPortion: [{ action: "Changed historical step" }], remainingPlan: [{ action: "Lay out the materials tonight" }],
  }, source, { completedPortion: [{ action: "Original historical step" }] });
  assert(!result.valid);
  assert(result.errors.some((error) => error.path === "completedPortion" && error.code === "mismatch"));
});
