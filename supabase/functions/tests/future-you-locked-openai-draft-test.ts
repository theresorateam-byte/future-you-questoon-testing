import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import { requestOpenAiDraft } from "../future-you-locked/openai-draft.ts";

Deno.test("model draft boundary accepts only completed JSON object responses", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = ((request: Request | string | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return Promise.resolve(new Response(JSON.stringify({ status: "completed", output_text: '{"ok":true}', usage: { total_tokens: 4 } }), { status: 200 }));
  }) as typeof fetch;
  try {
    const result = await requestOpenAiDraft("test-key", { model: "test" }, "AI draft", "hashed-user-id");
    assertEquals(result.draft, { ok: true });
    assertEquals(result.usage, { total_tokens: 4 });
    assertEquals(requestBody, { model: "test", safety_identifier: "hashed-user-id" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("model draft boundary rejects incomplete and non-JSON outputs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ status: "incomplete", output_text: '{"ok":true}' }), { status: 200 }))) as typeof fetch;
  try {
    await assertRejects(() => requestOpenAiDraft("test-key", { model: "test" }, "AI draft"), Error, "did not complete");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
