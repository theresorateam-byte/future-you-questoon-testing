import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { prepareInitialPlanInput } from "../future-you-locked/plan-deriver.ts";

Deno.test("initial plan derivation bounds its frozen source input", () => {
  const prepared = prepareInitialPlanInput({
    normalizedGoal: { value: "x".repeat(2_100) },
    extra: Array.from({ length: 45 }, (_, index) => index),
    nested: { a: { b: { c: { d: { e: "discard" } } } } },
  });
  assertStringIncludes(String((prepared.normalizedGoal as Record<string, unknown>).value), "…");
  assertEquals((prepared.extra as unknown[]).length, 40);
  assertEquals((prepared.nested as Record<string, any>).a.b.c.d, "[truncated: nested data]");
});
