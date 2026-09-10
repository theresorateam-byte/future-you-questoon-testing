import { validateInitialPlanDraft } from "./plan-contract.ts";
import { requestOpenAiDraft, SafeDraftError } from "./openai-draft.ts";

type RecordValue = Record<string, unknown>;
const MAX_TEXT_LENGTH = 2_000;
const MAX_ARRAY_ITEMS = 40;
const MAX_OBJECT_KEYS = 40;

function bounded(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length <= MAX_TEXT_LENGTH ? value : `${value.slice(0, MAX_TEXT_LENGTH)}…`;
  if (depth >= 5) return "[truncated: nested data]";
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => bounded(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as RecordValue).slice(0, MAX_OBJECT_KEYS).map(([key, item]) => [key, bounded(item, depth + 1)]));
  return String(value);
}

/** Minimizes the frozen source before its authorized, server-side model use. */
export function prepareInitialPlanInput(sourceSnapshot: RecordValue) {
  return bounded(sourceSnapshot) as RecordValue;
}

const schema = { type: "object", additionalProperties: false, required: ["contractVersion","sourceReferences","goal","entryGate","mode","milestones","successMarkers","guardrails","firstTodayStep","prepareAction","completedPortion","remainingPlan"], properties: {
  contractVersion:{type:"string",const:"locked-v1"}, sourceReferences:{type:"array",items:{type:"string"}}, goal:{type:"object",additionalProperties:false,required:["intendedResult"],properties:{intendedResult:{type:"string"}}}, entryGate:{type:"string",enum:["active","prepare","not_ready"]}, mode:{type:"string",enum:["tiny_start","steady_build","challenge"]}, milestones:{type:"array",items:{type:"string"}}, successMarkers:{type:"array",items:{type:"string"}}, guardrails:{type:"array",items:{type:"string"}}, firstTodayStep:{type:["object","null"],additionalProperties:false,required:["action","minimumVersion","successMarker"],properties:{action:{type:"string"},minimumVersion:{type:"string"},successMarker:{type:"string"}}}, prepareAction:{type:["object","null"],additionalProperties:false,required:["action"],properties:{action:{type:"string"}}}, completedPortion:{type:"array",items:{type:"object"},maxItems:0}, remainingPlan:{type:"array",items:{type:"object"},minItems:1}
}};

export async function deriveInitialPlan(sourceSnapshot: Record<string, unknown>, safetyIdentifier?: string) {
  const key = Deno.env.get("OPENAI_API_KEY"); if (!key) throw new Error("AI plan derivation is not configured.");
  const prepared = prepareInitialPlanInput(sourceSnapshot);
  const instructions = "Create a cautious initial Future You plan from only the frozen Source handoff. Do not invent facts. This is a strict contract: goal.intendedResult must exactly equal normalizedGoal.value; entryGate and mode must exactly equal the Source values; sourceReferences must include normalizedGoal, safety, realism, capacity, initialMode, milestone, and guardrails; milestones, successMarkers, and guardrails must each contain concrete text; completedPortion must be []; remainingPlan must contain future-only plan units. If entryGate is active, firstTodayStep must include action, minimumVersion, and successMarker and prepareAction must be null. Otherwise firstTodayStep must be null and prepareAction must include action. No fixed day count or scores.";
  const request = (extra = "") => requestOpenAiDraft(key, { model:"gpt-5.6-terra", reasoning:{effort:"low"}, store:false, max_output_tokens:1_400, instructions:`${instructions}${extra}`, input:JSON.stringify({sourceSnapshot:prepared}), text:{format:{type:"json_schema",name:"locked_initial_plan",strict:true,schema}} }, "AI plan derivation", safetyIdentifier);
  let result = await request();
  let validation = validateInitialPlanDraft(result.draft, sourceSnapshot);
  // One correction attempt is allowed only when the model returned a structured
  // draft that missed the locked contract; provider failures are never retried.
  if (!validation.valid) {
    result = await request(` Correct the prior draft's contract errors: ${validation.errors.map((error) => error.path).join(", ")}.`);
    validation = validateInitialPlanDraft(result.draft, sourceSnapshot);
  }
  if (!validation.valid) throw new SafeDraftError("plan_contract_invalid", "AI plan did not satisfy the Locked v1 plan contract.");
  return { plan: result.draft, usage: result.usage };
}
