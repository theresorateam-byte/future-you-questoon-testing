import { assertEquals } from "jsr:@std/assert@1";
import { validateProgressionAssessment } from "../future-you-locked/progression-contract.ts";

const evidenceId = "11111111-1111-4111-8111-111111111111";
const draft = {
  contractVersion: "locked-v1", topicKey: "build_routines_that_work",
  currentState: { routine_anchor: "emerging with mixed evidence" },
  stateConfidence: { level: "provisional", rationale: "One useful update is not enough to establish recurrence." },
  causalOwnership: { status: "unresolved", rationale: "The available evidence does not distinguish access from consistency." },
  roles: [{ key: "routine_anchor", role: "primary" }],
  unresolved: [{ key: "opportunity_pattern", note: "Need more evidence." }],
  nextEvidenceTarget: { question: "What opportunities existed this week?", decisionRelevance: "Separates no opportunity from a missed routine." },
  evidenceReferences: [{ evidenceId, applicationType: "requires_follow_up", rationale: "The update is incomplete." }],
  planRecommendation: { outcome: "continue", rationale: "No justified plan rewrite yet." },
};

Deno.test("allows a cited, uncertainty-preserving Level 3 assessment", () => {
  assertEquals(validateProgressionAssessment(draft, "build_routines_that_work", [evidenceId]).valid, true);
});

Deno.test("rejects a reference to evidence from another goal", () => {
  assertEquals(validateProgressionAssessment(draft, "build_routines_that_work", []).valid, false);
});
