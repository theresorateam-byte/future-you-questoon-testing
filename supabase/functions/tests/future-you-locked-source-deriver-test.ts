import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { prepareSourceHandoffInput } from "../future-you-locked/source-deriver.ts";

Deno.test("source handoff derivation minimizes and bounds raw intake data", () => {
  const prepared = prepareSourceHandoffInput(
    Array.from({ length: 85 }, (_, index) => ({ fact_key: `fact-${index}`, fact_value: { answer: "x".repeat(2_100), nested: { a: { b: { c: { d: { e: "discard" } } } } } }, status: "current", stability: "unknown", provenance: { source: "tester" }, intake_instance_id: "intake" })),
    Array.from({ length: 45 }, (_, index) => ({ uncertainty_key: `uncertainty-${index}`, uncertainty_kind: "unknown", status: "open" })),
  );
  assertEquals(prepared.facts.length, 80);
  assertEquals(prepared.unresolvedUncertainties.length, 40);
  assertEquals(prepared.facts[0].factKey, "fact-0");
  assertStringIncludes(String((prepared.facts[0].value as Record<string, unknown>).answer), "…");
  assertEquals((prepared.facts[0].value as Record<string, any>).nested.a.b.c.d, "[truncated: nested data]");
});
