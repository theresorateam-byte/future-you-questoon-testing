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

Deno.test("source handoff derivation prefers re-entry facts over duplicate parent keys", () => {
  const prepared = prepareSourceHandoffInput([
    { fact_key: "current_capacity", fact_value: "parent value", intake_instance_id: "parent" },
    { fact_key: "current_capacity", fact_value: "re-entry value", intake_instance_id: "re-entry" },
    { fact_key: "goal_meaning", fact_value: "still valid", intake_instance_id: "parent" },
  ], []);
  assertEquals(prepared.facts.length, 2);
  assertEquals(prepared.facts[0], {
    factKey: "current_capacity", value: "re-entry value", status: "undefined", stability: "undefined", provenance: "undefined", intakeInstanceId: "re-entry",
  });
});
