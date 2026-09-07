import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { prepareEvidenceForAssessment, prepareProgressionAssessmentInput } from "../future-you-locked/progression-deriver.ts";

Deno.test("assessment derivation minimizes and bounds model evidence", () => {
  const prepared = prepareEvidenceForAssessment(Array.from({ length: 55 }, (_, index) => ({
    id: `evidence-${index}`,
    source_kind: "progress_update",
    evidence_content: { note: "x".repeat(2_100), nested: { a: { b: { c: { d: { e: "discard" } } } } } },
    quality: { confidence: "low" }, context: { source: "tester" }, occurred_at: null, recorded_at: "2026-09-07T00:00:00Z",
  })));
  assertEquals(prepared.length, 50);
  assertEquals(prepared[0].id, "evidence-0");
  assertStringIncludes(String((prepared[0].content as Record<string, unknown>).note), "…");
  const nested = (prepared[0].content as Record<string, any>).nested;
  assertEquals(nested.a.b.c.d, "[truncated: nested data]");
});

Deno.test("assessment derivation bounds current Level 3 state as well as evidence", () => {
  const prepared = prepareProgressionAssessmentInput({
    note: "x".repeat(2_100),
    nested: { a: { b: { c: { d: { e: "discard" } } } } },
  }, []);
  assertStringIncludes(String(prepared.currentState.note), "…");
  assertEquals((prepared.currentState.nested as Record<string, any>).a.b.c.d, "[truncated: nested data]");
});
