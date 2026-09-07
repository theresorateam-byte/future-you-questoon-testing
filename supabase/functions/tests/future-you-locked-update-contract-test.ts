import { assert, assertEquals } from "jsr:@std/assert@1.0.19";
import { buildVisibleUpdateChoices, currentTodayStep, validateAdjustmentCommit, validateProgressUpdateDraft } from "../future-you-locked/update-contract.ts";

const evidenceId = "11111111-1111-4111-8111-111111111111";
const plan = {
  firstTodayStep: {
    action: "Put the routine card beside the kettle",
    minimumVersion: "Put the card on the counter",
    successMarker: "The card is visible",
  },
};

Deno.test("Today’s Step and visible choices come from the current Live Plan", () => {
  assertEquals(currentTodayStep(plan)?.action, "Put the routine card beside the kettle");
  const choices = buildVisibleUpdateChoices(plan);
  assertEquals(choices.map((choice) => choice.normalizedState), ["completed", "partly_completed", "not_today"]);
  assert(choices.every((choice) => choice.label.includes("card")));
});

Deno.test("a partial update requires one locked reason category", () => {
  const choices = buildVisibleUpdateChoices(plan);
  const invalid = validateProgressUpdateDraft({
    selectedChoiceId: "completed_minimum_version", reasonCode: "shorter_window", variables: [],
  }, choices);
  assert(!invalid.valid);
  const valid = validateProgressUpdateDraft({
    selectedChoiceId: "completed_minimum_version", reasonCategory: "time", reasonCode: "shorter_window",
    variables: [{ key: "morning_window", status: "temporary" }], optionalNote: null,
  }, choices);
  assert(valid.valid);
  assertEquals(valid.selectedChoice?.normalizedState, "partly_completed");
});

Deno.test("adjustment commit must match the evidence-citing assessment and pass all checks", () => {
  const validationResult = Object.fromEntries(["safeAndRealistic", "protectedOutcome", "guardrails", "planFit", "expertFit"].map((key) => [key, { status: "pass", rationale: `${key} passed.` }]));
  const assessment = {
    evidenceReferences: [{ evidenceId, applicationType: "supports", rationale: "The update is direct evidence." }],
    planRecommendation: { outcome: "continue", rationale: "Hold through ordinary variation." },
  };
  assert(validateAdjustmentCommit({ adjustmentOutcome: "continue" }, assessment, evidenceId, validationResult, "The remaining plan held.").valid);
  assert(!validateAdjustmentCommit({ adjustmentOutcome: "build" }, assessment, evidenceId, validationResult, "Increase the next step.").valid);
  assert(!validateAdjustmentCommit({ adjustmentOutcome: "continue" }, assessment, evidenceId, { ...validationResult, planFit: { status: "fail", rationale: "It jumps ahead." } }, "The remaining plan held.").valid);
});
