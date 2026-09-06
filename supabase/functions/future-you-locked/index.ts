import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { TARGET_CATALOG_VERSION } from "./intake-orchestrator.ts";
import { requirementsForTopic, TOPIC_REQUIREMENT_SEEDS } from "./topic-requirements.ts";

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

async function authorizedTester(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return { error: json({ error: "Unauthorized." }, 401) };

  const { user, admin } = clients(authorization);
  const token = authorization.slice("Bearer ".length);
  const { data: auth, error: authError } = await user.auth.getUser(token);
  if (authError || !auth.user) return { error: json({ error: "Unauthorized." }, 401) };

  const { data: access, error: accessError } = await admin
    .from("tester_access")
    .select("role")
    .eq("user_id", auth.user.id)
    .eq("active", true)
    .maybeSingle();
  if (accessError) throw accessError;
  if (!access) return { error: json({ error: "Tester access is required." }, 403) };

  return { admin, user: auth.user, role: access.role };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const context = await authorizedTester(req);
    if ("error" in context) return context.error;

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
        .select("id, goal_id, status, source_snapshot").eq("id", payload.intakeInstanceId).eq("user_id", context.user.id).maybeSingle();
      if (intakeError) throw intakeError;
      if (!intake) return json({ error: "Intake not found." }, 404);
      const [requirementsResult, factsResult, uncertaintiesResult] = await Promise.all([
        context.admin.from("intake_requirements").select("requirement_key, priority, applicability, resolution, target").eq("intake_instance_id", intake.id).eq("user_id", context.user.id),
        context.admin.from("intake_facts").select("fact_key, fact_value, status, provenance").eq("intake_instance_id", intake.id).eq("user_id", context.user.id),
        context.admin.from("intake_uncertainties").select("uncertainty_key, uncertainty_kind, status").eq("intake_instance_id", intake.id).eq("user_id", context.user.id).eq("status", "open"),
      ]);
      const error = [requirementsResult.error, factsResult.error, uncertaintiesResult.error].find(Boolean);
      if (error) throw error;
      const blockers = (requirementsResult.data ?? []).filter((item) => item.applicability === "active" && ["essential_now", "conditional"].includes(item.priority) && !["satisfied", "provisional", "not_applicable"].includes(item.resolution));
      if (intake.status !== "deriving" || blockers.length > 0) return json({ ready: false, blockers });
      return json({ ready: true, handoff: { goalId: intake.goal_id, intakeInstanceId: intake.id, sourceSnapshot: intake.source_snapshot, facts: factsResult.data ?? [], unresolvedUncertainties: uncertaintiesResult.data ?? [] } });
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

    if (payload.operation !== "contract_status") return json({ error: "Unknown operation. Use contract_status, start_intake, intake_state, record_intake_answer, intake_readiness, or source_handoff_preview." }, 400);

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
        activeVersionCount: scopes.length,
        topicCount: scopes.filter((scope) => scope === "topic").length,
        routingCount: scopes.filter((scope) => scope === "routing").length,
        missingRequiredScopes: requiredScopes.filter((scope) => !scopes.includes(scope)),
      },
    });
  } catch (error) {
    console.error("future-you-locked failed", error);
    return json({ error: "Unable to process this request." }, 500);
  }
});
