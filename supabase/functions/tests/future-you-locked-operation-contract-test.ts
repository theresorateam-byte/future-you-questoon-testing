import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { LOCKED_OPERATIONS, unknownOperationMessage } from "../future-you-locked/operation-contract.ts";

Deno.test("Locked API operation contract contains every protected lifecycle boundary", () => {
  assertEquals(new Set(LOCKED_OPERATIONS).size, LOCKED_OPERATIONS.length);
  for (const operation of [
    "derive_source_handoff", "freeze_source_handoff", "approve_initial_plan",
    "record_progress_update", "apply_progression_assessment", "revise_live_plan",
    "test_lab_active_goals", "batch_test_report", "simulate_flow_batch",
  ]) assertEquals(LOCKED_OPERATIONS.includes(operation as typeof LOCKED_OPERATIONS[number]), true);
  assertStringIncludes(unknownOperationMessage(), "derive_source_handoff");
  assertStringIncludes(unknownOperationMessage(), "revise_live_plan");
});
