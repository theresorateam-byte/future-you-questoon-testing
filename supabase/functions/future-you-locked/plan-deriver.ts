import { validateInitialPlanDraft } from "./plan-contract.ts";
import { requestOpenAiDraft } from "./openai-draft.ts";

const schema = { type: "object", additionalProperties: false, required: ["contractVersion","sourceReferences","goal","entryGate","mode","milestones","successMarkers","guardrails","firstTodayStep","prepareAction","completedPortion","remainingPlan"], properties: {
  contractVersion:{type:"string",const:"locked-v1"}, sourceReferences:{type:"array",items:{type:"string"}}, goal:{type:"object",additionalProperties:false,required:["intendedResult"],properties:{intendedResult:{type:"string"}}}, entryGate:{type:"string",enum:["active","prepare","not_ready"]}, mode:{type:"string",enum:["tiny_start","steady_build","challenge"]}, milestones:{type:"array",items:{type:"string"}}, successMarkers:{type:"array",items:{type:"string"}}, guardrails:{type:"array",items:{type:"string"}}, firstTodayStep:{type:["object","null"],additionalProperties:false,required:["action","minimumVersion","successMarker"],properties:{action:{type:"string"},minimumVersion:{type:"string"},successMarker:{type:"string"}}}, prepareAction:{type:["object","null"],additionalProperties:false,required:["action"],properties:{action:{type:"string"}}}, completedPortion:{type:"array",items:{type:"object"},maxItems:0}, remainingPlan:{type:"array",items:{type:"object"},minItems:1}
}};

export async function deriveInitialPlan(sourceSnapshot: Record<string, unknown>, safetyIdentifier?: string) {
  const key = Deno.env.get("OPENAI_API_KEY"); if (!key) throw new Error("AI plan derivation is not configured.");
  const { draft: plan, usage } = await requestOpenAiDraft(key, { model:"gpt-5.6-terra", reasoning:{effort:"medium"}, store:false, max_output_tokens:900, instructions:"Create a cautious initial Future You plan from only the frozen Source handoff. Do not invent facts. Preserve goal, entry gate, and mode exactly. If gate is active use firstTodayStep and set prepareAction null; otherwise use prepareAction and set firstTodayStep null. Set completedPortion to an empty array. Put only future plan units in remainingPlan. No fixed day count or scores.", input:JSON.stringify({sourceSnapshot}), text:{format:{type:"json_schema",name:"locked_initial_plan",strict:true,schema}} }, "AI plan derivation", safetyIdentifier);
  const validation = validateInitialPlanDraft(plan, sourceSnapshot);
  if (!validation.valid) throw new Error(`AI plan did not satisfy Locked v1: ${validation.errors.map((e) => e.path).join(", ")}`);
  return { plan, usage };
}
