import { assertEquals } from "jsr:@std/assert@1";
import { MAX_LOCKED_REQUEST_BYTES, parseLockedRequestPayload } from "../future-you-locked/request-contract.ts";

Deno.test("Locked request parsing accepts only bounded JSON objects", async () => {
  const accepted = await parseLockedRequestPayload(new Request("https://example.test", {
    method: "POST", body: JSON.stringify({ operation: "contract_status" }), headers: { "content-type": "application/json" },
  }));
  assertEquals(accepted, { ok: true, payload: { operation: "contract_status" } });

  const array = await parseLockedRequestPayload(new Request("https://example.test", { method: "POST", body: "[]" }));
  assertEquals(array, { ok: false, reason: "invalid_json" });

  const oversized = await parseLockedRequestPayload(new Request("https://example.test", {
    method: "POST", body: JSON.stringify({ operation: "x", padding: "a".repeat(MAX_LOCKED_REQUEST_BYTES) }),
  }));
  assertEquals(oversized, { ok: false, reason: "payload_too_large" });
});
