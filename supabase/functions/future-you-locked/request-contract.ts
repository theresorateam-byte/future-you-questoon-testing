/**
 * Bounded JSON parsing for the authenticated Locked v1 Edge Function.
 * The bound applies before any draft can reach a model or database mutation.
 */
export const MAX_LOCKED_REQUEST_BYTES = 256 * 1024;

export type LockedRequestParseResult =
  // Individual operation branches perform their own narrow validation. `any`
  // preserves that existing validation flow without trusting parsed input.
  | { ok: true; payload: Record<string, any> }
  | { ok: false; reason: "invalid_json" | "payload_too_large" };

export async function parseLockedRequestPayload(req: Request): Promise<LockedRequestParseResult> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LOCKED_REQUEST_BYTES) {
    return { ok: false, reason: "payload_too_large" };
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_LOCKED_REQUEST_BYTES) {
    return { ok: false, reason: "payload_too_large" };
  }

  try {
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, reason: "invalid_json" };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}
