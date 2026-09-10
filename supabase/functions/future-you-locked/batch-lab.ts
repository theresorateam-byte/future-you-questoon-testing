import { requestOpenAiDraft } from "./openai-draft.ts";

export const BATCH_LAB_ENTRIES = [
  "build_stronger_relationships",
  "communicate_better",
  "set_better_boundaries",
  "become_more_confident",
  "get_more_done",
  "get_daily_life_in_order",
  "feel_more_like_myself",
] as const;

const schema = {
  type: "object", additionalProperties: false,
  required: ["summary", "productionReadiness", "cases", "crossCaseFindings", "recommendedChanges"],
  properties: {
    summary: { type: "string", minLength: 20, maxLength: 700 },
    productionReadiness: { type: "object", additionalProperties: false, required: ["score", "reason"], properties: { score: { type: "integer", minimum: 0, maximum: 100 }, reason: { type: "string", minLength: 10, maxLength: 500 } } },
    cases: { type: "array", minItems: 3, maxItems: 10, items: { type: "object", additionalProperties: false, required: ["id", "entryKey", "syntheticSituation", "firstQuestionCheck", "expectedInternalOwner", "questionOrderChecks", "planChecks", "verdict"], properties: {
      id: { type: "string", minLength: 1, maxLength: 32 }, entryKey: { type: "string", enum: BATCH_LAB_ENTRIES }, syntheticSituation: { type: "string", minLength: 20, maxLength: 500 },
      firstQuestionCheck: { type: "string", minLength: 10, maxLength: 300 }, expectedInternalOwner: { type: ["string", "null"] },
      questionOrderChecks: { type: "array", minItems: 2, maxItems: 5, items: { type: "string", minLength: 5, maxLength: 200 } },
      planChecks: { type: "array", minItems: 2, maxItems: 5, items: { type: "string", minLength: 5, maxLength: 200 } },
      verdict: { type: "string", enum: ["pass", "watch", "gap"] },
    } } },
    crossCaseFindings: { type: "array", maxItems: 8, items: { type: "string", minLength: 8, maxLength: 300 } },
    recommendedChanges: { type: "array", maxItems: 8, items: { type: "string", minLength: 8, maxLength: 300 } },
  },
};

/** Generates a non-persisted, synthetic quality-review batch. It does not run or alter user goals. */
export async function deriveBatchTestReport(batchSize: number, safetyIdentifier?: string) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("AI batch testing is not configured.");
  const { draft, usage } = await requestOpenAiDraft(key, {
    model: "gpt-5.6-terra", reasoning: { effort: "medium" }, store: false, max_output_tokens: 2_400,
    instructions: "Create a synthetic Future You quality-review batch. This is an offline test artifact, not a user conversation and not a clinical assessment. Never use real people, journals, messages, account data, diagnoses, or advice. Make varied, ordinary fictional situations. Test whether the first question would obtain the decisive context before later details, whether Get More Done routes to Time or Putting Things Off, and whether Get Daily Life in Order routes to Home Organization or Routines. For direct entries expectedInternalOwner must be null. Be demanding: call out vague wording, needless questions, unsupported plan claims, unsafe assumptions, and places where multiple answers are needed. Do not claim a feature works when it has not been executed. Use pass only when the stated checks are genuinely sufficient. Return only the schema.",
    input: JSON.stringify({ batchSize, userFacingEntries: BATCH_LAB_ENTRIES, routeRules: { get_more_done: { time: "manage_my_time_better", procrastination: "stop_putting_things_off", tie: "manage_my_time_better" }, get_daily_life_in_order: { home: "get_my_home_organized", routines: "build_routines_that_work", tie: "get_my_home_organized" } } }),
    text: { format: { type: "json_schema", name: "future_you_synthetic_batch_report", strict: true, schema } },
  }, "AI batch test report", safetyIdentifier);
  return { report: draft, usage };
}
