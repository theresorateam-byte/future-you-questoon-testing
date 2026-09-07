import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { prepareLivePlanRevisionInput } from "../future-you-locked/live-plan-deriver.ts";

Deno.test("Live Plan derivation bounds approved model context", () => {
  const prepared = prepareLivePlanRevisionInput({
    sourceSnapshot: { detail: "x".repeat(3_100) },
    currentPlan: { remainingPlan: Array.from({ length: 55 }, (_, index) => ({ index })) },
  });
  assertStringIncludes(String((prepared.sourceSnapshot as Record<string, unknown>).detail), "…");
  assertEquals(((prepared.currentPlan as Record<string, unknown>).remainingPlan as unknown[]).length, 50);
});
