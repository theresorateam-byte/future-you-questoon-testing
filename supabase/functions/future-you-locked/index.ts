import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    if (payload.operation !== "contract_status") {
      return json({ error: "Unknown operation. Use contract_status." }, 400);
    }

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
