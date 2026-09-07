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

/**
 * Locked Future You service, kept separate from the legacy future-you-engine.
 * This first deploy intentionally exposes only a contract health check. Intake,
 * progression, and plan-writing actions are added only after their immutable
 * ledgers and acceptance tests are in place.
 */
const corsHeaders = {
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

Deno.serve(async (req): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const context = await authorizedTester(req);
    if (!context.ok) return context.error;

    const payload = await req.json().catch(() => ({}));
    if (payload.operation === "start_intake") {
      const goalText = typeof payload.goalText === "string" ? payload.goalText : "";
      const topicKey = typeof payload.topicKey === "string" ? payload.topicKey : null;
      const requirementSeeds = requirementsForTopic(topicKey ?? "");
      if (requirementSeeds.length === 0) {
        return json({ error: "Choose one approved Future You topic before starting intake." }, 400);
      }
      const { data, error } = await context.admin.rpc("future_you_start_locked_intake", {
        p_user_id: context.user.id,
        p_goal_text: goalText,
        p_topic_key: topicKey,
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
      return json({ engine: "future-you-locked-v1", result: data });
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
        topicRequirementSetCount: Object.keys(TOPIC_REQUIREMENT_SEEDS).length,
        controlledTopicModelCount: Object.keys(TOPIC_PROGRESSION_CONFIGS).length,
        activeVersionCount: scopes.length,
        topicCount: scopes.filter((scope) => scope === "topic").length,
        routingCount: scopes.filter((scope) => scope === "routing").length,
        missingRequiredScopes: requiredScopes.filter((scope) => !scopes.includes(scope)),
      },
    });
  } catch (error) {
    console.error("future-you-locked request failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return json({ error: "Unable to process this request." }, 500);
  }
});
