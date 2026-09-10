type RecordValue = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 25_000;

/** A deliberately small error vocabulary that is safe to return to a tester.
 * It never includes provider text, prompts, or a person's answers. */
export class SafeDraftError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "SafeDraftError"; }
}

function outputText(raw: RecordValue): unknown {
  if (typeof raw.output_text === "string") return raw.output_text;
  const output = Array.isArray(raw.output) ? raw.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const content: unknown[] = Array.isArray((item as RecordValue).content) ? (item as RecordValue).content as unknown[] : [];
    for (const part of content) {
      if (part && typeof part === "object" && !Array.isArray(part) && (part as RecordValue).type === "output_text" && typeof (part as RecordValue).text === "string") return (part as RecordValue).text;
    }
  }
  return null;
}

/**
 * Calls Responses with a bounded deadline and returns only a JSON object.
 * It deliberately discards provider error details so raw personal input cannot
 * be copied into a function error or log by accident.
 */
export async function requestOpenAiDraft(apiKey: string, body: RecordValue, label: string, safetyIdentifier?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Drafts are never provider-persisted, even if a future caller accidentally
  // supplies a conflicting request option.
  const requestBody = { ...body, store: false, ...(safetyIdentifier ? { safety_identifier: safetyIdentifier } : {}) };
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch {
    throw new SafeDraftError(controller.signal.aborted ? "draft_timeout" : "draft_transport", controller.signal.aborted ? `${label} timed out.` : `${label} could not be reached.`);
  } finally {
    clearTimeout(timeout);
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new SafeDraftError("draft_response_unreadable", `${label} returned an unreadable response.`);
  }
  if (!response.ok || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new SafeDraftError("draft_provider_rejected", `${label} failed.`);
  const result = raw as RecordValue;
  if (typeof result.status === "string" && result.status !== "completed") throw new SafeDraftError("draft_incomplete", `${label} did not complete.`);
  const text = outputText(result);
  if (typeof text !== "string" || text.trim().length === 0) throw new SafeDraftError("draft_empty", `${label} returned no draft.`);
  let draft: unknown;
  try {
    draft = JSON.parse(text);
  } catch {
    throw new SafeDraftError("draft_invalid_json", `${label} returned an invalid draft.`);
  }
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new SafeDraftError("draft_invalid_shape", `${label} returned an invalid draft.`);
  return { draft: draft as RecordValue, usage: result.usage ?? null };
}
