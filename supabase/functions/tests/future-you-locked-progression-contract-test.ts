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

Deno.test("accepts the Medium confidence vocabulary used by topic contracts", () => {
  const medium = { ...draft, stateConfidence: { level: "medium", rationale: "Evidence is useful but not broad enough for high confidence." } };
  assertEquals(validateProgressionAssessment(medium, "build_routines_that_work", [evidenceId]).valid, true);
});

Deno.test("locks relationship assessments to the seven relationship dimensions", () => {
  const relationship = {
    ...draft,
    topicKey: "build_stronger_relationships",
    currentState: {
      model: "relationship_dimensions_v1", route: "relationship",
      units: { understanding: { level: 3 }, responsiveness: { level: 3 } },
    },
    roles: [{ key: "understanding", role: "primary" }],
  };
  assertEquals(validateProgressionAssessment(relationship, "build_stronger_relationships", [evidenceId]).valid, true);
});

Deno.test("rejects invented relationship units", () => {
  const invalid = {
    ...draft,
    topicKey: "build_stronger_relationships",
    currentState: { model: "relationship_dimensions_v1", route: "relationship", units: { chemistry: { level: 5 } } },
  };
  assertEquals(validateProgressionAssessment(invalid, "build_stronger_relationships", [evidenceId]).valid, false);
});

Deno.test("keeps confidence state attached to a context and a controlled dimension", () => {
  const confidenceDraft = {
    ...draft,
    topicKey: "become_more_confident",
    currentState: {
      model: "confidence_context_dimension_v1", route: "confidence", contextKey: "work_leadership",
      units: { confident_action: { level: 3 }, confidence_recovery: { level: 2 } },
    },
    roles: [{ key: "confidence_recovery", role: "primary" }],
  };
  assertEquals(validateProgressionAssessment(confidenceDraft, "become_more_confident", [evidenceId]).valid, true);
  const missingContext = { ...confidenceDraft, currentState: { ...confidenceDraft.currentState, contextKey: "" } };
  assertEquals(validateProgressionAssessment(missingContext, "become_more_confident", [evidenceId]).valid, false);
});

Deno.test("uses the five locked self-trust dimensions", () => {
  const selfTrust = {
    ...draft,
    topicKey: "build_self_trust",
    currentState: { model: "self_trust_dimensions_v1", route: "self_trust", units: { judgment_calibration: { level: 3 } } },
    roles: [{ key: "judgment_calibration", role: "primary" }],
  };
  assertEquals(validateProgressionAssessment(selfTrust, "build_self_trust", [evidenceId]).valid, true);
});
