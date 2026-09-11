import "jsr:@supabase/functions-js@2.115.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.115.0";
import { TARGET_CATALOG_VERSION } from "./intake-orchestrator.ts";
import { requirementsForTopic, TOPIC_REQUIREMENT_SEEDS } from "./topic-requirements.ts";
import { validateSourceHandoffDraft } from "./source-contract.ts";
import { validateInitialPlanDraft, validateLivePlanRevision } from "./plan-contract.ts";
import { deriveInitialPlan } from "./plan-deriver.ts";
import { deriveLivePlanRevision } from "./live-plan-deriver.ts";
import { deriveProgressionAssessment } from "./progression-deriver.ts";
import { deriveSourceHandoff } from "./source-deriver.ts";
import { validateProgressionAssessment } from "./progression-contract.ts";
import { TOPIC_PROGRESSION_CONFIGS } from "./topic-progression-config.ts";
import { buildVisibleUpdateChoices, currentTodayStep, validateAdjustmentCommit, validateProgressUpdateDraft } from "./update-contract.ts";
import { unknownOperationMessage } from "./operation-contract.ts";
import { parseLockedRequestPayload } from "./request-contract.ts";
import { deriveIntakeQuestion } from "./intake-question-deriver.ts";
import { deriveNextIntakeTarget } from "./intake-turn-deriver.ts";
import { deriveWeeklyCheckinQuestion, WEEKLY_CHECKIN_KEYS } from "./weekly-checkin-deriver.ts";
import { UMBRELLA_ENTRIES, umbrellaEntry, umbrellaQuestionForTarget, routeUmbrellaAnswer } from "./umbrella-routing.ts";
import { deriveBatchTestReport } from "./batch-lab.ts";
import { simulateFlowBatch } from "./flow-batch-simulator.ts";
import { SafeDraftError } from "./openai-draft.ts";

/**
 * Locked Future You service, kept separate from the legacy future-you-engine.
 * This first deploy intentionally exposes only a contract health check. Intake,
 * progression, and plan-writing actions are added only after their immutable
 * ledgers and acceptance tests are in place.
 */
const corsHeaders = {
  // The endpoint authenticates every protected operation from the bearer token;
  // this permits browser clients (including the local test console) to read
  // the response after the required OPTIONS preflight succeeds.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function sha256Json(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function envKey(groupName: string, fallback: string) {
  try {
    const group = JSON.parse(Deno.env.get(groupName) ?? "{}");
    const mapped = group.default;
    if (typeof mapped === "string" && Deno.env.get(mapped)) return Deno.env.get(mapped) ?? "";
  } catch {
    // Fall through to the conventional Supabase environment variable.
  }
  return Deno.env.get(fallback) ?? "";
}

function clients(authHeader: string) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publishableKey || !secretKey) throw new Error("Supabase function secrets are not configured.");

  return {
    user: createClient(url, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    admin: createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

async function sourceFactKeys(admin: any, userId: string, intake: { id: string; intake_kind?: string; parent_intake_instance_id?: string | null }): Promise<string[]> {
  const ids = [intake.id];
  if (intake.intake_kind === "change_path" && intake.parent_intake_instance_id) ids.unshift(intake.parent_intake_instance_id);
  const { data, error } = await admin.from("intake_facts").select("fact_key").in("intake_instance_id", ids).eq("user_id", userId);
  if (error) throw error;
  const keys: string[] = [];
  for (const fact of data ?? []) if (typeof fact.fact_key === "string" && fact.fact_key.length > 0) keys.push(fact.fact_key);
  return [...new Set(keys)];
}

async function authorizedTester(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return { ok: false as const, error: json({ error: "Unauthorized." }, 401) };

  const { user, admin } = clients(authorization);
  const token = authorization.slice("Bearer ".length);
  const { data: auth, error: authError } = await user.auth.getUser(token);
  if (authError || !auth.user) return { ok: false as const, error: json({ error: "Unauthorized." }, 401) };

  const { data: access, error: accessError } = await admin
    .from("tester_access")
    .select("role")
    .eq("user_id", auth.user.id)
    .eq("active", true)
    .maybeSingle();
  if (accessError) throw accessError;
  if (!access) return { ok: false as const, error: json({ error: "Tester access is required." }, 403) };

  return { ok: true as const, admin, user: auth.user, role: access.role };
}

const WEEKLY_MINIMUM_ANSWERS = 3;
const WEEKLY_MAXIMUM_ANSWERS = 5;
type WeeklyEvidenceRow = { id: string; evidence_content: unknown; context: unknown; recorded_at: string };

// A topic card establishes the starting intent. The actual subject and desired
// result are collected by the conversation, not typed into a goal field.
const TOPIC_START_INTENTS: Record<string, string> = {
  build_stronger_relationships: "Build stronger relationships",
  communicate_better: "Communicate better",
  set_better_boundaries: "Set better boundaries",
  become_more_confident: "Become more confident",
  feel_more_like_myself: "Feel more like myself",
};

// The routing layer is versioned independently from the topic it ultimately
// selects, so a completed plan always retains the rule that chose its owner.
const UMBRELLA_ROUTING_CONTRACTS: Record<string, string> = {
  get_more_done: "time_procrastination",
  get_daily_life_in_order: "home_routines",
};
const NATURAL_SAFETY_TARGETS = new Set([
  "relationship_safety_viability", "communication_safety_power", "boundary_safety_power", "confidence_safety_power",
  "home_safety_reality", "routine_safety_reality", "identity_safety_gate",
]);

function selectedOptionIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const ids = (value as Record<string, unknown>).selectedOptionIds;
  return Array.isArray(ids) ? ids.filter((item): item is string => typeof item === "string") : [];
}

const UPDATE_TEST_SOURCE = {
  engine_version: "future-you-locked-v1",
  test_fixture: true,
  selected_entry_key: "get_more_done",
  selected_topic_key: "manage_my_time_better",
  normalizedGoal: { value: "Make a 10-minute start on one important task this week." },
  safety: { value: "The task is personally appropriate and can be paused if circumstances change." },
  realism: { value: "A short start fits better than a large catch-up session." },
  capacity: { value: "Ten minutes is available on one weekday." },
  initialMode: "tiny_start",
  milestone: { value: "Choose one task and begin it for ten minutes." },
  guardrails: { value: "Keep the step small; do not turn it into an all-or-nothing test." },
  entryGate: "active",
  l3InitialState: {
    model: "time_architecture_v1", route: "time_management",
    units: {
      time_capacity_awareness: { level: 1 }, priority_scope_control: { level: 1 }, planning_allocation: { level: 1 },
      capture_externalization: { level: 1 }, time_protection_efficiency: { level: 1 }, adaptation_recovery: { level: 1 },
    },
  },
};

const UPDATE_TEST_PLAN = {
  contractVersion: "locked-v1",
  sourceReferences: ["normalizedGoal", "safety", "realism", "capacity", "initialMode", "milestone", "guardrails"],
  goal: { intendedResult: "Make a 10-minute start on one important task this week." },
  entryGate: "active",
  mode: "tiny_start",
  milestones: ["Choose one task that matters this week.", "Begin it for ten minutes on one weekday."],
  successMarkers: ["You begin the chosen task, even if you stop after ten minutes.", "You can name what made the start easier or harder."],
  guardrails: ["Keep the step to ten minutes.", "If the task becomes unrealistic, record that instead of forcing it."],
  firstTodayStep: { action: "Choose one important task and work on it for ten minutes.", minimumVersion: "Open the task and stay with it for two minutes.", successMarker: "You started the chosen task." },
  prepareAction: null,
  completedPortion: [],
  remainingPlan: [
    { action: "Choose one important task for this week." },
    { action: "Make one ten-minute start and notice what affected it." },
  ],
};

function weeklyCheckinContent(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function weeklyCheckinContext(admin: any, userId: string, goalId: string, checkInId?: string) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [goalResult, updatesResult, checkInsResult] = await Promise.all([
    admin.from("goals").select("goal_text").eq("id", goalId).eq("user_id", userId).maybeSingle(),
    admin.from("future_you_progress_updates").select("id, normalized_state, reason_category, reason_code, optional_note, occurred_at").eq("goal_id", goalId).eq("user_id", userId).gte("occurred_at", weekAgo).order("occurred_at", { ascending: false }).limit(30),
    admin.from("canonical_evidence").select("id, evidence_content, context, recorded_at").eq("goal_id", goalId).eq("user_id", userId).eq("source_kind", "check_in").order("recorded_at", { ascending: false }).limit(100),
  ]);
  const error = [goalResult.error, updatesResult.error, checkInsResult.error].find(Boolean);
  if (error) throw error;
  if (!goalResult.data) return null;
  const allCheckIns: WeeklyEvidenceRow[] = checkInsResult.data ?? [];
  const answers = allCheckIns.filter((item) => {
    const content = weeklyCheckinContent(item.evidence_content);
    return content?.flow === "weekly_checkin" && content?.phase === "answer" && (!checkInId || content?.checkInId === checkInId);
  });
  const latestCompleted = allCheckIns.find((item) => {
    const content = weeklyCheckinContent(item.evidence_content);
    return content?.flow === "weekly_checkin" && content?.phase === "complete";
  });
  return { weekAgo, goalText: goalResult.data.goal_text, dailyUpdates: updatesResult.data ?? [], allCheckIns, answers, latestCompleted };
}

Deno.serve(async (req): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const context = await authorizedTester(req);
    if (!context.ok) return context.error;

    const parsed = await parseLockedRequestPayload(req);
    if (!parsed.ok) {
      return json({ error: parsed.reason === "payload_too_large" ? "Request payload is too large." : "A JSON object request body is required." }, 400);
    }
    const payload = parsed.payload;
    if (payload.operation === "start_intake") {
      const topicKey = typeof payload.topicKey === "string" ? payload.topicKey : null;
      const umbrella = topicKey ? umbrellaEntry(topicKey) : null;
      const requirementSeeds = umbrella
        ? [{ key: umbrella.initialKey, priority: "essential_now" as const, decisionArea: "routing" as const }]
        : requirementsForTopic(topicKey ?? "");
      const goalText = umbrella?.label ?? (topicKey ? TOPIC_START_INTENTS[topicKey] : null);
      if (requirementSeeds.length === 0 || !goalText) {
        return json({ error: "Choose one approved Future You topic before starting intake." }, 400);
      }
      const { data, error } = await context.admin.rpc("future_you_start_locked_intake", {
        p_user_id: context.user.id,
        p_goal_text: goalText,
        // Umbrellas deliberately begin without a topic binding. The first
        // route answer chooses the bounded internal topic owner.
        p_topic_key: umbrella ? null : topicKey,
      });
      if (error) {
        const clientErrors = new Set([
          "future_you_goal_text_invalid",
          "future_you_topic_not_found",
          "future_you_topic_not_available_for_direct_start",
        ]);
        const message = clientErrors.has(error.message) ? error.message : "Unable to start this intake.";
        return json({ error: message }, 400);
      }

      const intake = Array.isArray(data) ? data[0] : data;
      if (!intake?.intake_instance_id) throw new Error("Future You intake starter returned no intake ID.");
      if (umbrella) {
        const routingContractKey = UMBRELLA_ROUTING_CONTRACTS[topicKey ?? ""];
        const { data: routingContract, error: routingContractError } = await context.admin
          .from("future_you_contract_versions")
          .select("id")
          .eq("scope", "routing")
          .eq("contract_key", routingContractKey)
          .eq("status", "locked")
          .maybeSingle();
        if (routingContractError) throw routingContractError;
        if (!routingContract) throw new Error("Future You umbrella routing contract is unavailable.");
        const { error: routingBindingError } = await context.admin.from("goal_contract_bindings").insert({
          goal_id: intake.goal_id,
          user_id: context.user.id,
          contract_version_id: routingContract.id,
          binding_role: "routing",
        });
        if (routingBindingError) throw routingBindingError;
      }
      const { error: entryError } = await context.admin.from("intake_instances").update({
        source_snapshot: { engine_version: "future-you-locked-v1", selected_entry_key: topicKey, selected_topic_key: umbrella ? null : topicKey, umbrella_key: umbrella ? topicKey : null },
      }).eq("id", intake.intake_instance_id).eq("user_id", context.user.id);
      if (entryError) throw entryError;
      const { error: seedError } = await context.admin.rpc("future_you_seed_locked_requirements", {
        p_user_id: context.user.id,
        p_intake_instance_id: intake.intake_instance_id,
        p_requirements: requirementSeeds.map((requirement) => ({
          requirement_key: requirement.key,
          priority: requirement.priority,
          decision_area: requirement.decisionArea,
          target: { key: requirement.key, decisionArea: requirement.decisionArea },
        })),
      });
      if (seedError) throw seedError;
      const { data: firstRequirement, error: firstRequirementError } = await context.admin
        .from("intake_requirements").select("target").eq("intake_instance_id", intake.intake_instance_id)
        .eq("applicability", "active").eq("resolution", "missing").eq("priority", "essential_now").order("id").limit(1).maybeSingle();
      if (firstRequirementError) throw firstRequirementError;
      if (!firstRequirement?.target) throw new Error("Future You topic has no initial target.");
      const { error: targetError } = await context.admin.from("intake_instances")
        .update({ next_information_target: firstRequirement.target }).eq("id", intake.intake_instance_id).eq("user_id", context.user.id);
      if (targetError) throw targetError;
      intake.next_information_target = firstRequirement.target;
      if (intake?.next_information_target?.key === "goal_meaning") {
        intake.next_information_target = {
          key: "i1_a2_desired_direction",
          type: "user_input",
          reason: "The goal statement establishes intent. Confirm the direction and outcome the user wants before route or readiness decisions.",
        };
      }
      return json({ engine: "future-you-locked-v1", intake });
    }

    if (payload.operation === "start_change_path") {
      if (!isUuid(payload.goalId) || !payload.requestedChange || typeof payload.requestedChange !== "object" || Array.isArray(payload.requestedChange)) return json({ error: "A valid goalId and requestedChange object are required." }, 400);
      const { data, error } = await context.admin.rpc("future_you_start_locked_change_path", { p_user_id: context.user.id, p_goal_id: payload.goalId, p_requested_change: payload.requestedChange });
      if (error) return json({ error: "Unable to start this Change Path." }, 400);
      return json({ engine: "future-you-locked-v1", result: data, note: "The original intake and Original Plan remain unchanged." });
    }

    if (payload.operation === "intake_state") {
      if (!isUuid(payload.goalId)) return json({ error: "A valid goalId is required." }, 400);

      const { data: intake, error: intakeError } = await context.admin
        .from("intake_instances")
        .select("id, goal_id, intake_kind, status, readiness, next_information_target, source_snapshot, created_at, updated_at")
        .eq("goal_id", payload.goalId)
        .eq("user_id", context.user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (intakeError) throw intakeError;
      if (!intake) return json({ error: "No Locked v1 intake was found for this goal." }, 404);

      const [facts, requirements, uncertainties, candidates] = await Promise.all([
        context.admin.from("intake_facts").select("fact_key, fact_value, status, stability, current_event_id, provenance, updated_at").eq("intake_instance_id", intake.id).eq("user_id", context.user.id).order("fact_key"),
        context.admin.from("intake_requirements").select("requirement_key, priority, applicability, resolution, activation_reason, target, supporting_fact_ids, updated_at").eq("intake_instance_id", intake.id).eq("user_id", context.user.id).order("requirement_key"),
        context.admin.from("intake_uncertainties").select("uncertainty_key, uncertainty_kind, status, related_event_ids, resolution_note, created_at, resolved_at").eq("intake_instance_id", intake.id).eq("user_id", context.user.id).order("created_at"),
        context.admin.from("route_candidate_evidence").select("candidate_topic_key, candidate_role, evidence_event_id, rationale, status, created_at").eq("intake_instance_id", intake.id).eq("user_id", context.user.id).order("created_at"),
      ]);
      const queryError = [facts.error, requirements.error, uncertainties.error, candidates.error].find(Boolean);
      if (queryError) throw queryError;

      return json({
        engine: "future-you-locked-v1",
        intake,
        ledgers: {
          facts: facts.data ?? [],
          requirements: requirements.data ?? [],
          uncertainties: uncertainties.data ?? [],
          routeCandidates: candidates.data ?? [],
        },
      });
    }

    if (payload.operation === "intake_readiness") {
      if (!isUuid(payload.intakeInstanceId)) return json({ error: "A valid intakeInstanceId is required." }, 400);
      const { data: intake, error: intakeError } = await context.admin.from("intake_instances")
        .select("id, status, next_information_target").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle();
      if (intakeError) throw intakeError;
      if (!intake) return json({ error: "Intake not found." }, 404);
      const { data: requirements, error: requirementsError } = await context.admin.from("intake_requirements")
        .select("requirement_key, priority, applicability, resolution").eq("intake_instance_id", intake.id).eq("user_id", context.user.id);
      if (requirementsError) throw requirementsError;
      const blocking = (requirements ?? []).filter((item) => item.applicability === "active" && ["essential_now", "conditional"].includes(item.priority) && !["satisfied", "provisional", "not_applicable"].includes(item.resolution));
      return json({ readyForSource: blocking.length === 0 && intake.status === "deriving", status: intake.status, nextTarget: intake.next_information_target, blockingRequirements: blocking });
    }

    if (payload.operation === "derive_intake_question") {
      if (!isUuid(payload.intakeInstanceId)) return json({ error: "A valid intakeInstanceId is required." }, 400);
      const { data: intake, error: intakeError } = await context.admin.from("intake_instances")
        .select("id, goal_id, status, next_information_target").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle();
      if (intakeError) throw intakeError;
      if (!intake || intake.status !== "collecting" || !intake.next_information_target) return json({ error: "There is no active intake question to word." }, 409);
      const [goalResult, factsResult] = await Promise.all([
        context.admin.from("goals").select("goal_text").eq("id", intake.goal_id).eq("user_id", context.user.id).maybeSingle(),
        context.admin.from("intake_facts").select("fact_key, fact_value").eq("intake_instance_id", intake.id).eq("user_id", context.user.id).order("updated_at"),
      ]);
      if (goalResult.error || factsResult.error || !goalResult.data) throw goalResult.error ?? factsResult.error ?? new Error("Goal not found.");
      const umbrellaQuestion = umbrellaQuestionForTarget(String((intake.next_information_target as Record<string, unknown>)?.key ?? ""));
      if (umbrellaQuestion) {
        return json({ engine: "future-you-locked-v1", intakeInstanceId: intake.id, questionDraft: umbrellaQuestion, note: "This locked route question chooses an internal topic owner. It is not saved until Continue." });
      }
      const result = await deriveIntakeQuestion({ goalText: goalResult.data.goal_text, target: intake.next_information_target, facts: factsResult.data ?? [], safetyIdentifier: await sha256Json(context.user.id) });
      return json({ engine: "future-you-locked-v1", intakeInstanceId: intake.id, questionDraft: result.question, usage: result.usage, note: "This question wording is a non-persisted draft. The locked intake target remains authoritative." });
    }

    if (payload.operation === "source_handoff_preview") {
      if (!isUuid(payload.intakeInstanceId)) return json({ error: "A valid intakeInstanceId is required." }, 400);
      const { data: intake, error: intakeError } = await context.admin.from("intake_instances")
        .select("id, goal_id, intake_kind, parent_intake_instance_id, status, source_snapshot").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle();
      if (intakeError) throw intakeError;
      if (!intake) return json({ error: "Intake not found." }, 404);
      const [requirementsResult, factsResult, uncertaintiesResult, priorFactsResult] = await Promise.all([
        context.admin.from("intake_requirements").select("requirement_key, priority, applicability, resolution, target").eq("intake_instance_id", intake.id).eq("user_id", context.user.id),
        context.admin.from("intake_facts").select("fact_key, fact_value, status, provenance").eq("intake_instance_id", intake.id).eq("user_id", context.user.id),
        context.admin.from("intake_uncertainties").select("uncertainty_key, uncertainty_kind, status").eq("intake_instance_id", intake.id).eq("user_id", context.user.id).eq("status", "open"),
        intake.intake_kind === "change_path" && intake.parent_intake_instance_id
          ? context.admin.from("intake_facts").select("fact_key, fact_value, status, provenance").eq("intake_instance_id", intake.parent_intake_instance_id).eq("user_id", context.user.id)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const error = [requirementsResult.error, factsResult.error, uncertaintiesResult.error, priorFactsResult.error].find(Boolean);
      if (error) throw error;
      const blockers = (requirementsResult.data ?? []).filter((item) => item.applicability === "active" && ["essential_now", "conditional"].includes(item.priority) && !["satisfied", "provisional", "not_applicable"].includes(item.resolution));
      if (intake.status !== "deriving" || blockers.length > 0) return json({ ready: false, blockers });
      return json({ ready: true, handoff: { goalId: intake.goal_id, intakeInstanceId: intake.id, sourceSnapshot: intake.source_snapshot, facts: [...(priorFactsResult.data ?? []).map((fact) => ({ ...fact, intakeInstanceId: intake.parent_intake_instance_id })), ...(factsResult.data ?? []).map((fact) => ({ ...fact, intakeInstanceId: intake.id }))], unresolvedUncertainties: uncertaintiesResult.data ?? [], note: intake.intake_kind === "change_path" ? "Parent facts are reference context; re-entry facts remain separately recorded." : undefined } });
    }

    if (payload.operation === "derive_source_handoff") {
      if (!isUuid(payload.intakeInstanceId)) return json({ error: "A valid intakeInstanceId is required." }, 400);
      const { data: intake, error: intakeError } = await context.admin.from("intake_instances")
        .select("id, goal_id, intake_kind, parent_intake_instance_id, status").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle();
      if (intakeError) throw intakeError;
      if (!intake) return json({ error: "Intake not found." }, 404);
      const [requirementsResult, factsResult, uncertaintiesResult, priorFactsResult] = await Promise.all([
        context.admin.from("intake_requirements").select("requirement_key, priority, applicability, resolution").eq("intake_instance_id", intake.id).eq("user_id", context.user.id),
        context.admin.from("intake_facts").select("fact_key, fact_value, status, stability, provenance, intake_instance_id").eq("intake_instance_id", intake.id).eq("user_id", context.user.id).order("fact_key"),
        context.admin.from("intake_uncertainties").select("uncertainty_key, uncertainty_kind, status").eq("intake_instance_id", intake.id).eq("user_id", context.user.id).eq("status", "open").order("created_at"),
        intake.intake_kind === "change_path" && intake.parent_intake_instance_id
          ? context.admin.from("intake_facts").select("fact_key, fact_value, status, stability, provenance, intake_instance_id").eq("intake_instance_id", intake.parent_intake_instance_id).eq("user_id", context.user.id).order("fact_key")
          : Promise.resolve({ data: [], error: null }),
      ]);
      const queryError = [requirementsResult.error, factsResult.error, uncertaintiesResult.error, priorFactsResult.error].find(Boolean);
      if (queryError) throw queryError;
      const blockers = (requirementsResult.data ?? []).filter((item) => item.applicability === "active" && ["essential_now", "conditional"].includes(item.priority) && !["satisfied", "provisional", "not_applicable"].includes(item.resolution));
      if (intake.status !== "deriving" || blockers.length > 0) return json({ ready: false, blockers, error: "Complete the active intake requirements before deriving a Source handoff." }, 409);
      const result = await deriveSourceHandoff({ facts: [...(priorFactsResult.data ?? []), ...(factsResult.data ?? [])], unresolvedUncertainties: uncertaintiesResult.data ?? [], safetyIdentifier: await sha256Json(context.user.id) });
      return json({ engine: "future-you-locked-v1", sourceDraft: result.sourceDraft, usage: result.usage, note: "This is a draft only. It has not frozen a Source handoff or created a plan." });
    }

    if (payload.operation === "validate_source_handoff") {
      if (!isUuid(payload.intakeInstanceId) || !payload.sourceDraft || typeof payload.sourceDraft !== "object" || Array.isArray(payload.sourceDraft)) {
        return json({ error: "A valid intakeInstanceId and sourceDraft object are required." }, 400);
      }
      const { data: intake, error: intakeError } = await context.admin.from("intake_instances")
        .select("id, intake_kind, parent_intake_instance_id, status").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle();
      if (intakeError) throw intakeError;
      if (!intake) return json({ error: "Intake not found." }, 404);
      const [requirementsResult, factsResult, uncertaintiesResult, factKeys] = await Promise.all([
        context.admin.from("intake_requirements").select("requirement_key, priority, applicability, resolution").eq("intake_instance_id", intake.id).eq("user_id", context.user.id),
        context.admin.from("intake_facts").select("fact_key").eq("intake_instance_id", intake.id).eq("user_id", context.user.id),
        context.admin.from("intake_uncertainties").select("uncertainty_key").eq("intake_instance_id", intake.id).eq("user_id", context.user.id).eq("status", "open"),
        sourceFactKeys(context.admin, context.user.id, intake),
      ]);
      const queryError = [requirementsResult.error, factsResult.error, uncertaintiesResult.error].find(Boolean);
      if (queryError) throw queryError;
      const blockers = (requirementsResult.data ?? []).filter((item) => item.applicability === "active" && ["essential_now", "conditional"].includes(item.priority) && !["satisfied", "provisional", "not_applicable"].includes(item.resolution));
      if (intake.status !== "deriving" || blockers.length > 0) return json({ valid: false, stage: "intake", blockers, errors: [{ path: "intake", code: "missing", message: "Complete the active intake requirements before validating a Source handoff." }] });
      const validation = validateSourceHandoffDraft(payload.sourceDraft, factKeys);
      return json({
        ...validation,
        stage: "source_handoff",
        unresolvedUncertainties: (uncertaintiesResult.data ?? []).map((item) => item.uncertainty_key),
        note: validation.valid ? "Validated structure only. This does not yet create an Original Plan or Live Plan." : "Fix the listed fields or collect the missing intake evidence.",
      });
    }

    if (payload.operation === "freeze_source_handoff") {
      if (!isUuid(payload.intakeInstanceId) || !payload.sourceDraft || typeof payload.sourceDraft !== "object" || Array.isArray(payload.sourceDraft)) {
        return json({ error: "A valid intakeInstanceId and sourceDraft object are required." }, 400);
      }
      const { data: intake, error: intakeError } = await context.admin.from("intake_instances")
        .select("id, intake_kind, parent_intake_instance_id, status").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle();
      if (intakeError) throw intakeError;
      if (!intake) return json({ error: "Intake not found." }, 404);
      const [requirementsResult, factsResult, factKeys] = await Promise.all([
        context.admin.from("intake_requirements").select("requirement_key, priority, applicability, resolution").eq("intake_instance_id", intake.id).eq("user_id", context.user.id),
        context.admin.from("intake_facts").select("fact_key").eq("intake_instance_id", intake.id).eq("user_id", context.user.id),
        sourceFactKeys(context.admin, context.user.id, intake),
      ]);
      const queryError = [requirementsResult.error, factsResult.error].find(Boolean);
      if (queryError) throw queryError;
      const blockers = (requirementsResult.data ?? []).filter((item) => item.applicability === "active" && ["essential_now", "conditional"].includes(item.priority) && !["satisfied", "provisional", "not_applicable"].includes(item.resolution));
      const validation = validateSourceHandoffDraft(payload.sourceDraft, factKeys);
      if (intake.status !== "deriving" || blockers.length > 0 || !validation.valid) {
        return json({ valid: false, stage: "source_handoff", blockers, errors: intake.status !== "deriving" ? [{ path: "intake", code: "invalid", message: "This intake is not available to freeze." }] : validation.errors });
      }
      const { data, error } = await context.admin.rpc("future_you_freeze_locked_source_handoff", {
        p_user_id: context.user.id,
        p_intake_instance_id: intake.id,
        p_source_handoff: payload.sourceDraft,
      });
      if (error) {
        const clientErrors = new Set(["future_you_source_handoff_not_ready", "future_you_source_handoff_already_frozen", "future_you_source_handoff_has_blockers"]);
        return json({ error: clientErrors.has(error.message) ? error.message : "Unable to freeze this Source handoff." }, 400);
      }
      return json({ engine: "future-you-locked-v1", result: data, note: "The Source handoff is frozen. No plan has been created yet." });
    }

    if (payload.operation === "validate_initial_plan") {
      if (!isUuid(payload.intakeInstanceId) || !payload.planDraft || typeof payload.planDraft !== "object" || Array.isArray(payload.planDraft)) {
        return json({ error: "A valid intakeInstanceId and planDraft object are required." }, 400);
      }
      const { data: intake, error: intakeError } = await context.admin.from("intake_instances")
        .select("id, intake_kind, status, source_snapshot").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle();
      if (intakeError) throw intakeError;
      if (!intake) return json({ error: "Intake not found." }, 404);
      if (intake.intake_kind !== "initial") return json({ error: "Initial-plan validation is not available for a Change Path. A Change Path can only prepare a future-only Live Plan revision." }, 400);
      if (intake.status !== "validated" || !intake.source_snapshot || Object.keys(intake.source_snapshot).length === 0) {
        return json({ valid: false, stage: "initial_plan", errors: [{ path: "sourceSnapshot", code: "missing", message: "Freeze a validated Source handoff before validating an initial plan." }] });
      }
      const validation = validateInitialPlanDraft(payload.planDraft, intake.source_snapshot);
      return json({
        ...validation,
        stage: "initial_plan",
        note: validation.valid ? "Validated structure only. Plan creation and approval remain a separate step." : "Fix the listed plan fields without introducing unsupported assumptions.",
      });
    }

    if (payload.operation === "approve_initial_plan") {
      if (!isUuid(payload.intakeInstanceId) || !payload.planDraft || typeof payload.planDraft !== "object" || Array.isArray(payload.planDraft)) {
        return json({ error: "A valid intakeInstanceId and planDraft object are required." }, 400);
      }
      const { data: intake, error: intakeError } = await context.admin.from("intake_instances")
        .select("id, intake_kind, status, source_snapshot").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle();
      if (intakeError) throw intakeError;
      if (!intake) return json({ error: "Intake not found." }, 404);
      if (intake.intake_kind !== "initial") return json({ error: "An Original Plan cannot be approved from a Change Path." }, 400);
      if (intake.status !== "validated" || !intake.source_snapshot || Object.keys(intake.source_snapshot).length === 0) {
        return json({ error: "Freeze a validated Source handoff before approving an initial plan." }, 400);
      }
      const validation = validateInitialPlanDraft(payload.planDraft, intake.source_snapshot);
      if (!validation.valid) return json({ valid: false, stage: "initial_plan", errors: validation.errors });
      const integrityHash = await sha256Json(payload.planDraft);
      const { data, error } = await context.admin.rpc("future_you_approve_locked_initial_plan", {
        p_user_id: context.user.id,
        p_intake_instance_id: intake.id,
        p_plan: payload.planDraft,
        p_integrity_hash: integrityHash,
      });
      if (error) {
        const clientErrors = new Set(["future_you_initial_plan_not_ready", "future_you_original_plan_already_exists"]);
        return json({ error: clientErrors.has(error.message) ? error.message : "Unable to approve this initial plan." }, 400);
      }
      return json({ engine: "future-you-locked-v1", result: data, integrityHash, note: "Original Plan is immutable. Live Plan begins at revision 1." });
    }

    if (payload.operation === "derive_initial_plan") {
      if (!isUuid(payload.intakeInstanceId)) return json({ error: "A valid intakeInstanceId is required." }, 400);
      const { data: intake, error: intakeError } = await context.admin.from("intake_instances").select("intake_kind, source_snapshot, status").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle();
      if (intakeError) throw intakeError;
      if (!intake || intake.status !== "validated" || !intake.source_snapshot || Object.keys(intake.source_snapshot).length === 0) return json({ error: "A frozen Source handoff is required." }, 400);
      if (intake.intake_kind !== "initial") return json({ error: "Initial-plan derivation is not available for a Change Path. A Change Path can only prepare a future-only Live Plan revision." }, 400);
      const result = await deriveInitialPlan(intake.source_snapshot, await sha256Json(context.user.id));
      return json({ engine:"future-you-locked-v1", planDraft:result.plan, usage:result.usage, note:"This is a draft. It is not saved until approved." });
    }

    if (payload.operation === "plan_state") {
      if (!isUuid(payload.goalId)) return json({ error: "A valid goalId is required." }, 400);
      const [originalResult, liveResult, l3Result] = await Promise.all([
        context.admin.from("original_action_plans").select("id, plan, schema_version, prompt_version, engine_version, integrity_hash, created_at").eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
        context.admin.from("live_action_plans").select("id, plan, revision, completed_checksum, source_event_id, created_at, updated_at").eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
        context.admin.from("progression_l3_states").select("state, state_confidence, roles, unresolved, next_evidence_target, audit_status, revision, updated_at").eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
      ]);
      const queryError = [originalResult.error, liveResult.error, l3Result.error].find(Boolean);
      if (queryError) throw queryError;
      if (!originalResult.data || !liveResult.data) return json({ error: "No Locked v1 plan was found for this goal." }, 404);
      return json({ engine: "future-you-locked-v1", originalPlan: originalResult.data, livePlan: liveResult.data, l3State: l3Result.data ?? null });
    }

    if (payload.operation === "create_update_test_scenario") {
      // This is deliberately a separate, plainly labelled fixture. It gives a
      // tester a real Locked-v1 Original Plan, Live Plan, L3 state, and update
      // ledger without making them complete an intake first. It never reads or
      // reuses another goal, plan, or answer from the tester account.
      const { data: started, error: startError } = await context.admin.rpc("future_you_start_locked_intake", {
        p_user_id: context.user.id,
        p_goal_text: "[Future You update test] Make a 10-minute start on one important task this week.",
        p_topic_key: null,
      });
      if (startError || !Array.isArray(started) || !started[0]?.goal_id || !started[0]?.intake_instance_id) {
        const knownStartError = startError?.message;
        const safeStartCodes = new Set([
          "future_you_user_required", "future_you_goal_text_invalid", "future_you_required_contracts_unavailable",
          "future_you_topic_not_found", "future_you_topic_not_available_for_direct_start",
        ]);
        return json({
          error: "The separate update test could not be started.",
          code: knownStartError && safeStartCodes.has(knownStartError) ? knownStartError : "update_test_start_failed",
          stage: "update_test_setup",
        }, 502);
      }
      const fixture = started[0] as { goal_id: string; intake_instance_id: string };
      const { data: topic, error: topicError } = await context.admin.from("future_you_contract_versions")
        .select("id").eq("contract_key", "manage_my_time_better").eq("scope", "topic").eq("status", "locked").maybeSingle();
      if (topicError || !topic) return json({ error: "The update-test topic setup is unavailable.", code: "update_test_topic_unavailable", stage: "update_test_setup" }, 502);
      const [{ error: bindingError }, { error: intakeError }] = await Promise.all([
        context.admin.from("goal_contract_bindings").insert({ goal_id: fixture.goal_id, user_id: context.user.id, contract_version_id: topic.id, binding_role: "topic" }),
        context.admin.from("intake_instances").update({ status: "validated", next_information_target: null, source_snapshot: UPDATE_TEST_SOURCE }).eq("id", fixture.intake_instance_id).eq("user_id", context.user.id),
      ]);
      if (bindingError || intakeError) return json({ error: "The separate update test could not be prepared.", code: bindingError ? "update_test_topic_binding_failed" : "update_test_source_setup_failed", stage: "update_test_setup" }, 502);
      const integrityHash = await sha256Json(UPDATE_TEST_PLAN);
      const { data: approved, error: approveError } = await context.admin.rpc("future_you_approve_locked_initial_plan", {
        p_user_id: context.user.id, p_intake_instance_id: fixture.intake_instance_id, p_plan: UPDATE_TEST_PLAN, p_integrity_hash: integrityHash,
      });
      if (approveError) return json({ error: "The separate update test plan could not be prepared.", code: "update_test_plan_setup_failed", stage: "update_test_setup" }, 502);
      const todayStep = currentTodayStep(UPDATE_TEST_PLAN);
      return json({
        engine: "future-you-locked-v1",
        testFixture: true,
        goalId: fixture.goal_id,
        plan: UPDATE_TEST_PLAN,
        liveRevision: 1,
        todayStep,
        visibleChoices: buildVisibleUpdateChoices(UPDATE_TEST_PLAN),
        l3Revision: 1,
        result: approved,
        note: "A separate Future You update-test plan was created. It uses the same protected progress, assessment, and Live Plan revision operations as the product path.",
      });
    }

    if (payload.operation === "test_lab_active_goals") {
      const [goalsResult, livePlansResult] = await Promise.all([
        context.admin.from("goals").select("id, goal_text").eq("user_id", context.user.id).order("created_at", { ascending: false }).limit(50),
        context.admin.from("live_action_plans").select("goal_id, revision, updated_at").eq("user_id", context.user.id).order("updated_at", { ascending: false }).limit(50),
      ]);
      const queryError = [goalsResult.error, livePlansResult.error].find(Boolean);
      if (queryError) throw queryError;
      const goalText = new Map((goalsResult.data ?? []).map((goal) => [goal.id, goal.goal_text]));
      return json({ engine: "future-you-locked-v1", activeGoals: (livePlansResult.data ?? []).map((plan) => ({ goalId: plan.goal_id, goalText: goalText.get(plan.goal_id) ?? "Untitled test plan", liveRevision: plan.revision, updatedAt: plan.updated_at })) });
    }

    if (payload.operation === "batch_test_report") {
      const requestedSize = Number(payload.batchSize);
      const batchSize = Number.isInteger(requestedSize) && requestedSize >= 3 && requestedSize <= 10 ? requestedSize : 6;
      const result = await deriveBatchTestReport(batchSize, await sha256Json(context.user.id));
      return json({ engine: "future-you-locked-v1", batch: result.report, note: "Synthetic batch only. Nothing was saved and no real user content was used." });
    }

    if (payload.operation === "simulate_flow_batch") {
      const entryKey = typeof payload.entryKey === "string" ? payload.entryKey : "";
      const requestedCount = Number(payload.caseCount);
      const caseCount = Number.isInteger(requestedCount) && requestedCount >= 1 && requestedCount <= 3 ? requestedCount : 1;
      const result = await simulateFlowBatch(entryKey, caseCount, await sha256Json(context.user.id));
      return json({ engine: "future-you-locked-v1", ...result });
    }

    if (payload.operation === "today_step" || payload.operation === "progress_update_options") {
      if (!isUuid(payload.goalId)) return json({ error: "A valid goalId is required." }, 400);
      const { data: live, error } = await context.admin.from("live_action_plans")
        .select("plan, revision, updated_at").eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle();
      if (error) throw error;
      if (!live) return json({ error: "No Locked v1 Live Plan was found for this goal." }, 404);
      const todayStep = currentTodayStep(live.plan);
      if (!todayStep) return json({ error: "The current Live Plan has no valid Today’s Step." }, 422);
      const result: Record<string, unknown> = { engine: "future-you-locked-v1", liveRevision: live.revision, todayStep };
      if (payload.operation === "progress_update_options") result.visibleChoices = buildVisibleUpdateChoices(live.plan);
      return json(result);
    }

    if (payload.operation === "record_progress_update") {
      if (!isUuid(payload.goalId) || !isUuid(payload.clientUpdateId) || !Number.isInteger(payload.expectedLiveRevision)) {
        return json({ error: "A valid goalId, clientUpdateId, and expectedLiveRevision are required." }, 400);
      }
      if (payload.correctionOfId !== undefined && payload.correctionOfId !== null && !isUuid(payload.correctionOfId)) {
        return json({ error: "correctionOfId must be a valid progress update ID." }, 400);
      }
      const { data: existingUpdate, error: existingUpdateError } = await context.admin.from("future_you_progress_updates")
        .select("id, goal_id, canonical_evidence_id, normalized_state").eq("user_id", context.user.id).eq("client_update_id", payload.clientUpdateId).maybeSingle();
      if (existingUpdateError) throw existingUpdateError;
      if (existingUpdate) {
        if (existingUpdate.goal_id !== payload.goalId) return json({ error: "future_you_client_update_id_conflict" }, 409);
        return json({ engine: "future-you-locked-v1", result: { progress_update_id: existingUpdate.id, evidence_id: existingUpdate.canonical_evidence_id, idempotent_replay: true }, normalizedState: existingUpdate.normalized_state });
      }
      const { data: live, error: liveError } = await context.admin.from("live_action_plans")
        .select("plan, revision").eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle();
      if (liveError) throw liveError;
      if (!live) return json({ error: "No Locked v1 Live Plan was found for this goal." }, 404);
      if (live.revision !== payload.expectedLiveRevision) return json({ error: "future_you_live_plan_stale" }, 409);
      const todayStep = currentTodayStep(live.plan);
      const visibleChoices = buildVisibleUpdateChoices(live.plan);
      if (!todayStep || visibleChoices.length === 0) return json({ error: "The current Live Plan has no valid Today’s Step." }, 422);
      const updateDraft = {
        selectedChoiceId: payload.selectedChoiceId,
        reasonCategory: payload.reasonCategory ?? null,
        reasonCode: payload.reasonCode,
        variables: payload.variables,
        optionalNote: payload.optionalNote ?? null,
      };
      const validation = validateProgressUpdateDraft(updateDraft, visibleChoices);
      if (!validation.valid || !validation.selectedChoice) return json({ valid: false, stage: "progress_update", errors: validation.errors }, 400);
      const occurredAt = typeof payload.occurredAt === "string" && !Number.isNaN(Date.parse(payload.occurredAt))
        ? payload.occurredAt
        : new Date().toISOString();
      const { data, error } = await context.admin.rpc("future_you_record_locked_progress_update", {
        p_user_id: context.user.id, p_goal_id: payload.goalId, p_client_update_id: payload.clientUpdateId,
        p_expected_live_revision: payload.expectedLiveRevision, p_today_step: todayStep,
        p_visible_choices: visibleChoices, p_selected_choice: validation.selectedChoice,
        p_normalized_state: validation.selectedChoice.normalizedState, p_reason_category: payload.reasonCategory ?? null,
        p_reason_code: payload.reasonCode, p_variables: payload.variables, p_optional_note: payload.optionalNote ?? null,
        p_occurred_at: occurredAt, p_correction_of_id: payload.correctionOfId ?? null,
      });
      if (error) {
        if (error.message === "future_you_live_plan_stale") return json({ error: error.message }, 409);
        return json({ error: "Unable to record this Progress Update." }, 400);
      }
      return json({ engine: "future-you-locked-v1", result: data, normalizedState: validation.selectedChoice.normalizedState, note: "The raw Progress Update and canonical evidence were saved before any plan decision." });
    }

    if (payload.operation === "progress_update_state") {
      if (!isUuid(payload.goalId)) return json({ error: "A valid goalId is required." }, 400);
      const [updatesResult, decisionsResult] = await Promise.all([
        context.admin.from("future_you_progress_updates").select("id, client_update_id, live_plan_revision, today_step, visible_choices, selected_choice, normalized_state, reason_category, reason_code, variables, optional_note, canonical_evidence_id, correction_of_id, occurred_at, recorded_at").eq("goal_id", payload.goalId).eq("user_id", context.user.id).order("occurred_at", { ascending: false }).limit(100),
        context.admin.from("future_you_adjustment_decisions").select("id, progress_update_id, progression_assessment_id, outcome, prior_live_revision, resulting_live_revision, live_plan_change, validation_result, live_plan_integrity_hash, created_at").eq("goal_id", payload.goalId).eq("user_id", context.user.id).order("created_at", { ascending: false }).limit(100),
      ]);
      const queryError = [updatesResult.error, decisionsResult.error].find(Boolean);
      if (queryError) throw queryError;
      return json({ engine: "future-you-locked-v1", updates: updatesResult.data ?? [], decisions: decisionsResult.data ?? [] });
    }

    if (payload.operation === "weekly_checkin_state") {
      if (!isUuid(payload.goalId)) return json({ error: "A valid goalId is required." }, 400);
      const data = await weeklyCheckinContext(context.admin, context.user.id, payload.goalId);
      if (!data) return json({ error: "No Future You goal was found." }, 404);
      const lastCompletedAt = data.latestCompleted?.recorded_at ?? null;
      const due = !lastCompletedAt || new Date(lastCompletedAt).getTime() < Date.now() - 7 * 24 * 60 * 60 * 1000;
      return json({
        engine: "future-you-locked-v1",
        weeklyCheckIn: {
          due,
          lastCompletedAt,
          dailyUpdateCount: data.dailyUpdates.length,
          note: due ? "Your weekly review is ready. It looks at the past seven days of recorded updates." : "Your next weekly review becomes available seven days after the last one.",
        },
      });
    }

    if (payload.operation === "derive_weekly_checkin_question") {
      if (!isUuid(payload.goalId) || !isUuid(payload.checkInId)) return json({ error: "A valid goalId and checkInId are required." }, 400);
      const data = await weeklyCheckinContext(context.admin, context.user.id, payload.goalId, payload.checkInId);
      if (!data) return json({ error: "No Future You goal was found." }, 404);
      const completedKeys = new Set(data.answers.map((item) => String(weeklyCheckinContent(item.evidence_content)?.informationKey ?? "")));
      const candidates = WEEKLY_CHECKIN_KEYS.filter((key) => !completedKeys.has(key));
      if (data.answers.length >= WEEKLY_MAXIMUM_ANSWERS || candidates.length === 0) {
        return json({ engine: "future-you-locked-v1", complete: true, answerCount: data.answers.length, note: "The weekly review has enough information to finish." });
      }
      const result = await deriveWeeklyCheckinQuestion({
        goalText: data.goalText,
        dailyUpdates: data.dailyUpdates,
        previousAnswers: data.answers.map((item) => weeklyCheckinContent(item.evidence_content) ?? {}),
        candidates,
        safetyIdentifier: await sha256Json(context.user.id),
      });
      return json({ engine: "future-you-locked-v1", checkInId: payload.checkInId, answerCount: data.answers.length, minimumAnswers: WEEKLY_MINIMUM_ANSWERS, questionDraft: result?.question ?? null, usage: result?.usage, note: "This is a non-persisted weekly question draft. An answer is saved only after Continue." });
    }

    if (payload.operation === "record_weekly_checkin_answer") {
      if (!isUuid(payload.goalId) || !isUuid(payload.checkInId) || !WEEKLY_CHECKIN_KEYS.includes(payload.informationKey)) {
        return json({ error: "A valid goalId, checkInId, and weekly information key are required." }, 400);
      }
      if (typeof payload.answer !== "string" || payload.answer.trim().length === 0 || payload.answer.length > 2000) {
        return json({ error: "Provide a weekly answer of up to 2,000 characters." }, 400);
      }
      const data = await weeklyCheckinContext(context.admin, context.user.id, payload.goalId, payload.checkInId);
      if (!data) return json({ error: "No Future You goal was found." }, 404);
      if (data.answers.length >= WEEKLY_MAXIMUM_ANSWERS) return json({ error: "This weekly review already has enough answers to finish." }, 409);
      const existing = data.answers.some((item) => weeklyCheckinContent(item.evidence_content)?.informationKey === payload.informationKey);
      if (existing) return json({ error: "That weekly review area was already answered." }, 409);
      const { data: evidenceId, error } = await context.admin.rpc("future_you_record_locked_evidence_v2", {
        p_user_id: context.user.id,
        p_goal_id: payload.goalId,
        p_source_kind: "check_in",
        p_content: { flow: "weekly_checkin", phase: "answer", checkInId: payload.checkInId, informationKey: payload.informationKey, answer: payload.answer.trim(), selectedOptionIds: Array.isArray(payload.selectedOptionIds) ? payload.selectedOptionIds.slice(0, 8) : [] },
        p_quality: { kind: "direct_user_report" },
        p_context: { cadence: "weekly", weekStartedAt: data.weekAgo },
        p_occurred_at: new Date().toISOString(),
      });
      if (error) return json({ error: "Unable to save this weekly answer." }, 400);
      return json({ engine: "future-you-locked-v1", evidenceId, answerCount: data.answers.length + 1, note: "This answer is now canonical evidence for the weekly review and later assessment." });
    }

    if (payload.operation === "complete_weekly_checkin") {
      if (!isUuid(payload.goalId) || !isUuid(payload.checkInId)) return json({ error: "A valid goalId and checkInId are required." }, 400);
      const data = await weeklyCheckinContext(context.admin, context.user.id, payload.goalId, payload.checkInId);
      if (!data) return json({ error: "No Future You goal was found." }, 404);
      if (data.answers.length < WEEKLY_MINIMUM_ANSWERS) return json({ error: `Answer at least ${WEEKLY_MINIMUM_ANSWERS} weekly questions before finishing.` }, 409);
      const alreadyComplete = data.allCheckIns.some((item) => {
        const content = weeklyCheckinContent(item.evidence_content);
        return content?.flow === "weekly_checkin" && content?.phase === "complete" && content?.checkInId === payload.checkInId;
      });
      if (alreadyComplete) return json({ engine: "future-you-locked-v1", idempotentReplay: true, answerCount: data.answers.length, note: "This weekly review was already completed." });
      const { data: evidenceId, error } = await context.admin.rpc("future_you_record_locked_evidence_v2", {
        p_user_id: context.user.id,
        p_goal_id: payload.goalId,
        p_source_kind: "check_in",
        p_content: { flow: "weekly_checkin", phase: "complete", checkInId: payload.checkInId, answerCount: data.answers.length },
        p_quality: { kind: "direct_user_report" },
        p_context: { cadence: "weekly", weekStartedAt: data.weekAgo },
        p_occurred_at: new Date().toISOString(),
      });
      if (error) return json({ error: "Unable to finish this weekly review." }, 400);
      return json({ engine: "future-you-locked-v1", evidenceId, answerCount: data.answers.length, note: "Weekly review complete. Its answers are now available to the Level 3 assessment and future-only plan revision flow." });
    }

    if (payload.operation === "record_evidence") {
      if (!isUuid(payload.goalId) || typeof payload.sourceKind !== "string" || !payload.content || typeof payload.content !== "object" || Array.isArray(payload.content) || Object.keys(payload.content).length === 0) return json({ error: "A valid goalId, sourceKind, and non-empty evidence content object are required." }, 400);
      if (payload.quality !== undefined && (!payload.quality || typeof payload.quality !== "object" || Array.isArray(payload.quality))) return json({ error: "Evidence quality must be an object." }, 400);
      if (payload.context !== undefined && (!payload.context || typeof payload.context !== "object" || Array.isArray(payload.context))) return json({ error: "Evidence context must be an object." }, 400);
      const occurredAt = typeof payload.occurredAt === "string" && !Number.isNaN(Date.parse(payload.occurredAt)) ? payload.occurredAt : null;
      const { data, error } = await context.admin.rpc("future_you_record_locked_evidence_v2", { p_user_id: context.user.id, p_goal_id: payload.goalId, p_source_kind: payload.sourceKind, p_content: payload.content, p_quality: payload.quality ?? {}, p_context: payload.context ?? {}, p_occurred_at: occurredAt });
      if (error) return json({ error: "Unable to record this evidence." }, 400);
      return json({ engine: "future-you-locked-v1", evidenceId: data });
    }

    if (payload.operation === "evidence_state") {
      if (!isUuid(payload.goalId)) return json({ error: "A valid goalId is required." }, 400);
      const { data: original, error: originalError } = await context.admin.from("original_action_plans")
        .select("id").eq("goal_id", payload.goalId).eq("user_id", context.user.id).eq("schema_version", "locked-v1").maybeSingle();
      if (originalError) throw originalError;
      if (!original) return json({ error: "No Locked v1 plan was found for this goal." }, 404);
      const { data: evidence, error: evidenceError } = await context.admin.from("canonical_evidence")
        .select("id, source_kind, evidence_content, quality, context, occurred_at, recorded_at, correction_of_id")
        .eq("goal_id", payload.goalId).eq("user_id", context.user.id).order("recorded_at", { ascending: false }).limit(100);
      if (evidenceError) throw evidenceError;
      const evidenceIds = (evidence ?? []).map((item) => item.id);
      const { data: applications, error: applicationsError } = evidenceIds.length === 0
        ? { data: [], error: null }
        : await context.admin.from("evidence_applications").select("canonical_evidence_id, target_scope, target_key, application_type, rationale, created_at").in("canonical_evidence_id", evidenceIds).order("created_at", { ascending: false });
      if (applicationsError) throw applicationsError;
      return json({ engine: "future-you-locked-v1", evidence: evidence ?? [], applications: applications ?? [] });
    }

    if (payload.operation === "progression_assessment_state") {
      if (!isUuid(payload.goalId)) return json({ error: "A valid goalId is required." }, 400);
      const [stateResult, assessmentsResult] = await Promise.all([
        context.admin.from("progression_l3_states").select("state, state_confidence, roles, unresolved, next_evidence_target, audit_status, revision, updated_at").eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
        context.admin.from("progression_l3_assessments").select("id, assessment, prior_revision, resulting_revision, created_at").eq("goal_id", payload.goalId).eq("user_id", context.user.id).order("created_at", { ascending: false }).limit(100),
      ]);
      const queryError = [stateResult.error, assessmentsResult.error].find(Boolean);
      if (queryError) throw queryError;
      if (!stateResult.data) return json({ error: "No Level 3 state exists for this goal." }, 404);
      return json({ engine: "future-you-locked-v1", currentState: stateResult.data, assessments: assessmentsResult.data ?? [] });
    }

    if (payload.operation === "change_path_state") {
      if (!isUuid(payload.goalId)) return json({ error: "A valid goalId is required." }, 400);
      const { data, error } = await context.admin.from("change_path_links")
        .select("id, prior_intake_instance_id, reentry_intake_instance_id, requested_change, status, created_at, completed_at")
        .eq("goal_id", payload.goalId).eq("user_id", context.user.id).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return json({ engine: "future-you-locked-v1", changePaths: data ?? [] });
    }

    if (payload.operation === "change_path_handoff_context") {
      if (!isUuid(payload.goalId) || !isUuid(payload.changePathId)) return json({ error: "A valid goalId and changePathId are required." }, 400);
      const { data: link, error: linkError } = await context.admin.from("change_path_links")
        .select("id, prior_intake_instance_id, reentry_intake_instance_id, requested_change, status, created_at")
        .eq("id", payload.changePathId).eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle();
      if (linkError) throw linkError;
      if (!link) return json({ error: "Change Path not found." }, 404);
      const [priorResult, reentryResult, factsResult, uncertaintiesResult] = await Promise.all([
        context.admin.from("intake_instances").select("id, source_snapshot, status, created_at").eq("id", link.prior_intake_instance_id).eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
        context.admin.from("intake_instances").select("id, intake_kind, status, readiness, next_information_target, source_snapshot, created_at, updated_at").eq("id", link.reentry_intake_instance_id).eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
        context.admin.from("intake_facts").select("fact_key, fact_value, status, stability, current_event_id, provenance, updated_at").eq("intake_instance_id", link.reentry_intake_instance_id).eq("user_id", context.user.id).order("fact_key"),
        context.admin.from("intake_uncertainties").select("uncertainty_key, uncertainty_kind, status, related_event_ids, resolution_note, created_at, resolved_at").eq("intake_instance_id", link.reentry_intake_instance_id).eq("user_id", context.user.id).order("created_at"),
      ]);
      const queryError = [priorResult.error, reentryResult.error, factsResult.error, uncertaintiesResult.error].find(Boolean);
      if (queryError) throw queryError;
      if (!priorResult.data || !reentryResult.data) return json({ error: "The Change Path intake context is incomplete." }, 409);
      return json({
        engine: "future-you-locked-v1",
        changePath: link,
        priorFrozenSource: priorResult.data.source_snapshot ?? null,
        reentryIntake: reentryResult.data,
        reentryFacts: factsResult.data ?? [],
        reentryUncertainties: uncertaintiesResult.data ?? [],
        note: "The prior Source is reference context only. Re-entry facts remain separate and cannot create another Original Plan.",
      });
    }

    if (payload.operation === "derive_progression_assessment") {
      if (!isUuid(payload.goalId)) return json({ error: "A valid goalId is required." }, 400);
      const [bindingResult, evidenceResult, stateResult] = await Promise.all([
        context.admin.from("goal_contract_bindings").select("contract_version_id, future_you_contract_versions!inner(contract_key, scope, status)").eq("goal_id", payload.goalId).eq("user_id", context.user.id).eq("binding_role", "topic").maybeSingle(),
        context.admin.from("canonical_evidence").select("id, source_kind, evidence_content, quality, context, occurred_at, recorded_at").eq("goal_id", payload.goalId).eq("user_id", context.user.id).order("recorded_at", { ascending: false }).limit(100),
        context.admin.from("progression_l3_states").select("state, state_confidence, roles, unresolved, next_evidence_target, audit_status, revision, updated_at").eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
      ]);
      const queryError = [bindingResult.error, evidenceResult.error, stateResult.error].find(Boolean);
      if (queryError) throw queryError;
      const binding = bindingResult.data as unknown as { future_you_contract_versions?: { contract_key?: string; scope?: string; status?: string } } | null;
      const topicKey = binding?.future_you_contract_versions?.contract_key;
      if (!topicKey || binding?.future_you_contract_versions?.scope !== "topic" || binding?.future_you_contract_versions?.status !== "locked") return json({ error: "This goal has no locked topic binding." }, 400);
      if (!stateResult.data) return json({ error: "No Level 3 state exists for this goal." }, 404);
      if ((evidenceResult.data ?? []).length === 0) return json({ error: "Canonical evidence is required before an assessment can be derived." }, 422);
      const result = await deriveProgressionAssessment({
        topicKey,
        currentState: stateResult.data,
        evidence: evidenceResult.data ?? [], safetyIdentifier: await sha256Json(context.user.id),
      });
      return json({ engine: "future-you-locked-v1", assessmentDraft: result.assessment, usage: result.usage, l3Revision: stateResult.data.revision, note: "This is a draft only. It has not changed Level 3 state or the Live Plan." });
    }

    if (payload.operation === "derive_live_plan_revision") {
      if (!isUuid(payload.goalId) || !isUuid(payload.progressUpdateId) || !isUuid(payload.assessmentId) || !Number.isInteger(payload.expectedRevision)) {
        return json({ error: "A valid goalId, progressUpdateId, assessmentId, and expectedRevision are required." }, 400);
      }
      if (payload.changePathId !== undefined && payload.changePathId !== null && !isUuid(payload.changePathId)) return json({ error: "changePathId must be a valid Change Path ID." }, 400);
      let changePath: { id: string; reentry_intake_instance_id: string; requested_change: Record<string, unknown>; status: string } | null = null;
      if (payload.changePathId) {
        const { data, error } = await context.admin.from("change_path_links").select("id, reentry_intake_instance_id, requested_change, status")
          .eq("id", payload.changePathId).eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: "Change Path not found." }, 404);
        changePath = data;
      }
      const sourceQuery = context.admin.from("intake_instances").select("source_snapshot, intake_kind, status")
        .eq("user_id", context.user.id).eq("status", "validated");
      if (changePath) sourceQuery.eq("id", changePath.reentry_intake_instance_id).eq("goal_id", payload.goalId);
      else sourceQuery.eq("goal_id", payload.goalId).order("created_at", { ascending: false }).limit(1);
      const [sourceResult, liveResult, updateResult, assessmentResult, stateResult] = await Promise.all([
        sourceQuery.maybeSingle(),
        context.admin.from("live_action_plans").select("plan, revision").eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
        context.admin.from("future_you_progress_updates").select("id, canonical_evidence_id, today_step, selected_choice, normalized_state, reason_category, reason_code, variables, optional_note, occurred_at, live_plan_revision").eq("id", payload.progressUpdateId).eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
        context.admin.from("progression_l3_assessments").select("id, assessment, resulting_revision").eq("id", payload.assessmentId).eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
        context.admin.from("progression_l3_states").select("revision").eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
      ]);
      const queryError = [sourceResult.error, liveResult.error, updateResult.error, assessmentResult.error, stateResult.error].find(Boolean);
      if (queryError) throw queryError;
      if (!sourceResult.data?.source_snapshot || Object.keys(sourceResult.data.source_snapshot).length === 0 || !liveResult.data || !updateResult.data || !assessmentResult.data || !stateResult.data) return json({ error: "The required frozen source, Live Plan, Progress Update, assessment, or Level 3 state was not found." }, 404);
      if (liveResult.data.revision !== payload.expectedRevision || updateResult.data.live_plan_revision !== payload.expectedRevision) return json({ error: "future_you_live_plan_stale" }, 409);
      if (assessmentResult.data.resulting_revision !== stateResult.data.revision) return json({ error: "future_you_progression_assessment_stale" }, 409);
      const result = await deriveLivePlanRevision({ sourceSnapshot: sourceResult.data.source_snapshot, currentPlan: liveResult.data.plan, progressUpdate: updateResult.data, assessment: assessmentResult.data.assessment, changePathContext: changePath, safetyIdentifier: await sha256Json(context.user.id) });
      return json({ engine: "future-you-locked-v1", planDraft: result.planDraft, livePlanChange: result.livePlanChange, validationResult: result.validationResult, usage: result.usage, note: "This is a draft only. It has not changed the Live Plan or Change Path status." });
    }

    if (payload.operation === "validate_progression_assessment" || payload.operation === "apply_progression_assessment") {
      if (!isUuid(payload.goalId) || !payload.assessment || typeof payload.assessment !== "object" || Array.isArray(payload.assessment)) {
        return json({ error: "A valid goalId and assessment object are required." }, 400);
      }
      const [bindingResult, evidenceResult, stateResult] = await Promise.all([
        context.admin.from("goal_contract_bindings").select("contract_version_id, future_you_contract_versions!inner(contract_key, scope, status)").eq("goal_id", payload.goalId).eq("user_id", context.user.id).eq("binding_role", "topic").maybeSingle(),
        context.admin.from("canonical_evidence").select("id").eq("goal_id", payload.goalId).eq("user_id", context.user.id),
        context.admin.from("progression_l3_states").select("revision").eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
      ]);
      const queryError = [bindingResult.error, evidenceResult.error, stateResult.error].find(Boolean);
      if (queryError) throw queryError;
      const binding = bindingResult.data as unknown as { future_you_contract_versions?: { contract_key?: string; scope?: string; status?: string } } | null;
      const topicKey = binding?.future_you_contract_versions?.contract_key;
      if (!topicKey || binding?.future_you_contract_versions?.scope !== "topic" || binding?.future_you_contract_versions?.status !== "locked") {
        return json({ error: "This goal has no locked topic binding." }, 400);
      }
      if (!stateResult.data) return json({ error: "No Level 3 state exists for this goal." }, 404);
      const validation = validateProgressionAssessment(payload.assessment, topicKey, (evidenceResult.data ?? []).map((item) => item.id));
      if (payload.operation === "validate_progression_assessment") return json({ ...validation, stage: "progression_assessment", note: "Validation only. No Level 3 state or Action Plan changes were made." });
      if (!validation.valid) return json({ valid: false, stage: "progression_assessment", errors: validation.errors });
      if (!Number.isInteger(payload.expectedRevision)) return json({ error: "expectedRevision is required to apply an assessment." }, 400);
      const { data, error } = await context.admin.rpc("future_you_apply_locked_progression_assessment", {
        p_user_id: context.user.id, p_goal_id: payload.goalId, p_expected_revision: payload.expectedRevision, p_assessment: payload.assessment,
      });
      if (error) return json({ error: "Unable to apply this Level 3 assessment." }, 400);
      return json({ engine: "future-you-locked-v1", result: data, note: "Level 3 was updated from cited evidence. This creates only a plan recommendation; it does not change the Live Plan." });
    }

    if (payload.operation === "revise_live_plan") {
      if (!isUuid(payload.goalId) || !isUuid(payload.progressUpdateId) || !isUuid(payload.assessmentId) || !Number.isInteger(payload.expectedRevision) || !payload.planDraft || typeof payload.planDraft !== "object" || Array.isArray(payload.planDraft)) {
        return json({ error: "A valid goalId, progressUpdateId, assessmentId, expectedRevision, and planDraft are required." }, 400);
      }
      if (payload.changePathId !== undefined && payload.changePathId !== null && !isUuid(payload.changePathId)) return json({ error: "changePathId must be a valid Change Path ID." }, 400);
      let changePath: { reentry_intake_instance_id: string } | null = null;
      if (payload.changePathId) {
        const { data, error } = await context.admin.from("change_path_links").select("reentry_intake_instance_id")
          .eq("id", payload.changePathId).eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: "Change Path not found." }, 404);
        changePath = data;
      }
      const sourceQuery = context.admin.from("intake_instances").select("source_snapshot")
        .eq("user_id", context.user.id).eq("status", "validated");
      if (changePath) sourceQuery.eq("id", changePath.reentry_intake_instance_id).eq("goal_id", payload.goalId);
      else sourceQuery.eq("goal_id", payload.goalId).order("created_at", { ascending: false }).limit(1);
      const [sourceResult, liveResult, updateResult, assessmentResult] = await Promise.all([
        sourceQuery.maybeSingle(),
        context.admin.from("live_action_plans").select("plan, revision").eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
        context.admin.from("future_you_progress_updates").select("canonical_evidence_id, live_plan_revision").eq("id", payload.progressUpdateId).eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
        context.admin.from("progression_l3_assessments").select("assessment, resulting_revision").eq("id", payload.assessmentId).eq("goal_id", payload.goalId).eq("user_id", context.user.id).maybeSingle(),
      ]);
      const queryError = [sourceResult.error, liveResult.error, updateResult.error, assessmentResult.error].find(Boolean);
      if (queryError) throw queryError;
      const sourceIntake = sourceResult.data;
      if (!sourceIntake?.source_snapshot || Object.keys(sourceIntake.source_snapshot).length === 0) return json({ error: "A frozen Source handoff is required." }, 400);
      if (!liveResult.data || !updateResult.data || !assessmentResult.data) return json({ error: "The current plan, Progress Update, or assessment was not found." }, 404);
      if (liveResult.data.revision !== payload.expectedRevision || updateResult.data.live_plan_revision !== payload.expectedRevision) return json({ error: "future_you_live_plan_stale" }, 409);
      const validation = validateLivePlanRevision(payload.planDraft, sourceIntake.source_snapshot, liveResult.data.plan);
      if (!validation.valid) return json({ valid: false, stage: "live_plan_revision", errors: validation.errors });
      const commitValidation = validateAdjustmentCommit(payload.planDraft, assessmentResult.data.assessment, updateResult.data.canonical_evidence_id, payload.validationResult, payload.livePlanChange);
      if (!commitValidation.valid) return json({ valid: false, stage: "adjustment_commit", errors: commitValidation.errors });
      const integrityHash = await sha256Json(payload.planDraft);
      const completedChecksum = await sha256Json(payload.planDraft.completedPortion);
      const { data, error } = await context.admin.rpc("future_you_revise_locked_live_plan_v3", {
        p_user_id: context.user.id, p_goal_id: payload.goalId, p_progress_update_id: payload.progressUpdateId,
        p_assessment_id: payload.assessmentId, p_expected_revision: payload.expectedRevision, p_plan: payload.planDraft,
        p_integrity_hash: integrityHash, p_completed_checksum: completedChecksum, p_live_plan_change: payload.livePlanChange,
        p_validation_result: payload.validationResult, p_change_path_id: payload.changePathId ?? null,
      });
      if (error) {
        const conflicts = new Set(["future_you_live_plan_stale", "future_you_progression_assessment_stale", "future_you_progress_update_already_decided", "future_you_change_path_not_available", "future_you_change_path_source_not_validated"]);
        return json({ error: conflicts.has(error.message) ? error.message : "Unable to revise this Live Plan." }, conflicts.has(error.message) ? 409 : 400);
      }
      return json({ engine: "future-you-locked-v1", result: data, integrityHash, completedChecksum, todayStep: currentTodayStep(payload.planDraft), note: "The Original Plan and completed Live Plan history were not changed." });
    }

    if (payload.operation === "record_intake_answer") {
      if (!isUuid(payload.intakeInstanceId) || typeof payload.informationKey !== "string" || !payload.rawValue || typeof payload.rawValue !== "object" || Array.isArray(payload.rawValue)) {
        return json({ error: "A valid intakeInstanceId, informationKey, and answer object are required." }, 400);
      }
      const { data, error } = await context.admin.rpc("future_you_record_locked_intake_answer", {
        p_user_id: context.user.id,
        p_intake_instance_id: payload.intakeInstanceId,
        p_information_key: payload.informationKey,
        p_raw_value: payload.rawValue,
      });
      if (error) {
        const clientErrors = new Set(["future_you_intake_not_available", "future_you_answer_not_for_current_target", "future_you_answer_object_required"]);
        return json({ error: clientErrors.has(error.message) ? error.message : "Unable to record this intake answer." }, 400);
      }
      const result = data as { status?: string; next_target?: Record<string, unknown> };
      const { data: currentIntake, error: currentIntakeError } = await context.admin.from("intake_instances")
        .select("id, goal_id, source_snapshot").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle();
      if (currentIntakeError || !currentIntake) throw currentIntakeError ?? new Error("Intake not found.");
      const snapshot = currentIntake.source_snapshot && typeof currentIntake.source_snapshot === "object" && !Array.isArray(currentIntake.source_snapshot)
        ? currentIntake.source_snapshot as Record<string, unknown> : {};
      const needsWorkabilityFollowUp = NATURAL_SAFETY_TARGETS.has(payload.informationKey)
        && selectedOptionIds(payload.rawValue).some((id) => id === "bigger_problem" || id === "not_sure");
      if (needsWorkabilityFollowUp) {
        const nextTarget = { key: "safety_followup_workability", decisionArea: "safety", requiredSpecificity: "brief", sensitivity: "minimize", reason: "A practical follow-up is needed before Future You assumes that an action is workable." };
        const { error: followUpError } = await context.admin.from("intake_instances").update({
          status: "collecting", next_information_target: nextTarget,
          source_snapshot: { ...snapshot, safety_followup_required: true },
        }).eq("id", currentIntake.id).eq("user_id", context.user.id);
        if (followUpError) throw followUpError;
        result.status = "collecting"; result.next_target = nextTarget;
      }
      const entryKey = typeof snapshot.selected_entry_key === "string" ? snapshot.selected_entry_key : "";
      const umbrella = umbrellaEntry(entryKey);
      if (umbrella?.initialKey === payload.informationKey) {
        const selectedTopic = routeUmbrellaAnswer(entryKey, payload.rawValue);
        if (!selectedTopic) throw new Error("Unable to select an internal umbrella route.");
        const { data: topic, error: topicError } = await context.admin.from("future_you_contract_versions")
          .select("id").eq("scope", "topic").eq("contract_key", selectedTopic).eq("status", "locked").maybeSingle();
        if (topicError || !topic) throw topicError ?? new Error("The selected internal topic is unavailable.");
        const { error: bindingError } = await context.admin.from("goal_contract_bindings").insert({
          goal_id: currentIntake.goal_id, user_id: context.user.id, contract_version_id: topic.id, binding_role: "topic",
        });
        if (bindingError) throw bindingError;
        const internalRequirements = requirementsForTopic(selectedTopic);
        const { error: seedError } = await context.admin.rpc("future_you_seed_locked_requirements", {
          p_user_id: context.user.id, p_intake_instance_id: currentIntake.id,
          p_requirements: internalRequirements.map((requirement) => ({ requirement_key: requirement.key, priority: requirement.priority, decision_area: requirement.decisionArea, target: { key: requirement.key, decisionArea: requirement.decisionArea } })),
        });
        if (seedError) throw seedError;
        const { data: firstRequirement, error: firstRequirementError } = await context.admin.from("intake_requirements")
          .select("target").eq("intake_instance_id", currentIntake.id).eq("applicability", "active").eq("resolution", "missing").eq("priority", "essential_now").order("id").limit(1).maybeSingle();
        if (firstRequirementError || !firstRequirement?.target) throw firstRequirementError ?? new Error("The selected route has no intake target.");
        const { error: routeUpdateError } = await context.admin.from("intake_instances").update({
          status: "collecting", next_information_target: firstRequirement.target,
          source_snapshot: { ...snapshot, selected_topic_key: selectedTopic, routed_from_umbrella: entryKey },
        }).eq("id", currentIntake.id).eq("user_id", context.user.id);
        if (routeUpdateError) throw routeUpdateError;
        result.status = "collecting"; result.next_target = firstRequirement.target;
      }
      if (result?.status === "collecting" && !needsWorkabilityFollowUp) {
        const [intakeResult, goalResult, factsResult, requirementsResult] = await Promise.all([
          context.admin.from("intake_instances").select("id, goal_id").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle(),
          context.admin.from("intake_instances").select("goals!inner(goal_text)").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle(),
          context.admin.from("intake_facts").select("fact_key, fact_value").eq("intake_instance_id", payload.intakeInstanceId).eq("user_id", context.user.id),
          context.admin.from("intake_requirements").select("requirement_key, priority, decision_area, target").eq("intake_instance_id", payload.intakeInstanceId).eq("applicability", "active").eq("resolution", "missing").in("priority", ["essential_now", "conditional"]),
        ]);
        const queryError = [intakeResult.error, goalResult.error, factsResult.error, requirementsResult.error].find(Boolean);
        if (queryError || !intakeResult.data || !goalResult.data) throw queryError ?? new Error("Intake not found.");
        const goal = goalResult.data as unknown as { goals?: { goal_text?: string } };
        const selected = await deriveNextIntakeTarget({ goalText: String(goal.goals?.goal_text ?? ""), facts: factsResult.data ?? [], candidates: requirementsResult.data ?? [], safetyIdentifier: await sha256Json(context.user.id) });
        if (selected) {
          const nextTarget = { ...(selected.target as Record<string, unknown>), key: selected.requirement_key, reason: "Selected from the remaining decision-relevant information." };
          const { error: updateError } = await context.admin.from("intake_instances").update({ next_information_target: nextTarget }).eq("id", intakeResult.data.id).eq("user_id", context.user.id);
          if (updateError) throw updateError;
          result.next_target = nextTarget;
        }
      }
      return json({ engine: "future-you-locked-v1", result });
    }

    if (payload.operation !== "contract_status") return json({ error: unknownOperationMessage() }, 400);

    const { data: versions, error } = await context.admin
      .from("future_you_contract_versions")
      .select("scope, version, status")
      .eq("status", "locked")
      .order("scope");
    if (error) throw error;

    const scopes = versions?.map((row) => row.scope) ?? [];
    const requiredScopes = ["action_plan_master", "intake_source", "i1", "i2", "i3", "level_1", "level_2", "level_3"];
    return json({
      engine: "future-you-locked-v1",
      tester: { email: context.user.email ?? null, role: context.role },
      contract: {
        intakeTargetCatalogVersion: TARGET_CATALOG_VERSION,
        directEntryCount: Object.keys(TOPIC_START_INTENTS).length,
        umbrellaEntryCount: Object.keys(UMBRELLA_ENTRIES).length,
        userFacingEntryCount: Object.keys(TOPIC_START_INTENTS).length + Object.keys(UMBRELLA_ENTRIES).length,
        topicRequirementSetCount: Object.keys(TOPIC_REQUIREMENT_SEEDS).length,
        controlledTopicModelCount: Object.keys(TOPIC_PROGRESSION_CONFIGS).length,
        activeVersionCount: scopes.length,
        topicCount: scopes.filter((scope) => scope === "topic").length,
        routingCount: scopes.filter((scope) => scope === "routing").length,
        missingRequiredScopes: requiredScopes.filter((scope) => !scopes.includes(scope)),
      },
    });
  } catch (error) {
    const safe = error instanceof SafeDraftError ? error : null;
    console.error("future-you-locked request failed", { name: error instanceof Error ? error.name : "UnknownError", code: safe?.code ?? null });
    if (safe) {
      const actionPlan = safe.code === "plan_contract_invalid" || safe.message.startsWith("AI plan derivation");
      return json({ error: actionPlan ? "Action-plan draft could not be made." : "AI draft could not be made.", code: safe.code, stage: actionPlan ? "action_plan" : "ai_draft" }, 502);
    }
    return json({ error: "Unable to process this request." }, 500);
  }
});
