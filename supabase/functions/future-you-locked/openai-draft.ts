type RecordValue = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 25_000;

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
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(safetyIdentifier ? { ...body, safety_identifier: safetyIdentifier } : body),
      signal: controller.signal,
    });
  } catch {
    throw new Error(controller.signal.aborted ? `${label} timed out.` : `${label} failed.`);
  } finally {
    clearTimeout(timeout);
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error(`${label} failed.`);
  }
  if (!response.ok || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label} failed.`);
  const result = raw as RecordValue;
  if (typeof result.status === "string" && result.status !== "completed") throw new Error(`${label} did not complete.`);
  const text = outputText(result);
  if (typeof text !== "string" || text.trim().length === 0) throw new Error(`${label} returned no draft.`);
  let draft: unknown;
  try {
    draft = JSON.parse(text);
  } catch {
    throw new Error(`${label} returned an invalid draft.`);
  }
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new Error(`${label} returned an invalid draft.`);
  return { draft: draft as RecordValue, usage: result.usage ?? null };
}
