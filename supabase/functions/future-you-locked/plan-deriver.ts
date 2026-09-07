import { validateInitialPlanDraft } from "./plan-contract.ts";

const schema = { type: "object", additionalProperties: false, required: ["contractVersion","sourceReferences","goal","entryGate","mode","milestones","successMarkers","guardrails","firstTodayStep","prepareAction","completedPortion","remainingPlan"], properties: {
  contractVersion:{type:"string",const:"locked-v1"}, sourceReferences:{type:"array",items:{type:"string"}}, goal:{type:"object",additionalProperties:false,required:["intendedResult"],properties:{intendedResult:{type:"string"}}}, entryGate:{type:"string",enum:["active","prepare","not_ready"]}, mode:{type:"string",enum:["tiny_start","steady_build","challenge"]}, milestones:{type:"array",items:{type:"string"}}, successMarkers:{type:"array",items:{type:"string"}}, guardrails:{type:"array",items:{type:"string"}}, firstTodayStep:{type:["object","null"],additionalProperties:false,required:["action","minimumVersion","successMarker"],properties:{action:{type:"string"},minimumVersion:{type:"string"},successMarker:{type:"string"}}}, prepareAction:{type:["object","null"],additionalProperties:false,required:["action"],properties:{action:{type:"string"}}}, completedPortion:{type:"array",items:{type:"object"},maxItems:0}, remainingPlan:{type:"array",items:{type:"object"},minItems:1}
}};

function outputText(raw: any) { return raw.output_text ?? raw.output?.flatMap((item: any) => item.content ?? []).find((item: any) => item.type === "output_text")?.text; }

export async function deriveInitialPlan(sourceSnapshot: Record<string, unknown>) {
  const key = Deno.env.get("OPENAI_API_KEY"); if (!key) throw new Error("AI plan derivation is not configured.");
  const response = await fetch("https://api.openai.com/v1/responses", { method:"POST", headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"}, body:JSON.stringify({ model:"gpt-5.6-terra", reasoning:{effort:"medium"}, store:false, max_output_tokens:900, instructions:"Create a cautious initial Future You plan from only the frozen Source handoff. Do not invent facts. Preserve goal, entry gate, and mode exactly. If gate is active use firstTodayStep and set prepareAction null; otherwise use prepareAction and set firstTodayStep null. Set completedPortion to an empty array. Put only future plan units in remainingPlan. No fixed day count or scores.", input:JSON.stringify({sourceSnapshot}), text:{format:{type:"json_schema",name:"locked_initial_plan",strict:true,schema}} }) });
  const raw = await response.json(); if (!response.ok) throw new Error("AI plan derivation failed.");
  const plan = JSON.parse(outputText(raw)); const validation = validateInitialPlanDraft(plan, sourceSnapshot);
  if (!validation.valid) throw new Error(`AI plan did not satisfy Locked v1: ${validation.errors.map((e) => e.path).join(", ")}`);
  return { plan, usage: raw.usage ?? null };
}
