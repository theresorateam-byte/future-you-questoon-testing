import { createClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";

// Publishable keys are intentionally safe for a browser. The server role and
// OpenAI key stay only in Supabase Edge Function secrets.
const supabase = createClient(
  "https://oyehxaislcxfnqqehdro.supabase.co",
  "sb_publishable_DUTbDnveriN-t4bbLxM87g_QOad9saX",
  { auth: { detectSessionInUrl: true, persistSession: true } },
);
const functionUrl = "https://oyehxaislcxfnqqehdro.supabase.co/functions/v1/future-you-locked";

const email = document.querySelector("#email");
const session = document.querySelector("#session");
const signOut = document.querySelector("#sign-out");
const sendLink = document.querySelector("#send-link");
const preset = document.querySelector("#preset");
const payload = document.querySelector("#payload");
const run = document.querySelector("#run");
const result = document.querySelector("#result");

const presets = {
  contract_status: { operation: "contract_status" },
  start_intake: { operation: "start_intake", topicKey: "build_routines_that_work", goalText: "Build a simple routine I can keep this week." },
  today_step: { operation: "today_step", goalId: "replace-with-goal-id" },
  progress_update_options: { operation: "progress_update_options", goalId: "replace-with-goal-id" },
  custom: { operation: "contract_status" },
};

function show(target, message, isError = false) {
  target.textContent = message;
  target.classList.toggle("error", isError);
}

function setPayload() { payload.value = JSON.stringify(presets[preset.value], null, 2); }

async function refreshSession() {
  const { data: { session: activeSession } } = await supabase.auth.getSession();
  if (activeSession) {
    show(session, `Signed in as ${activeSession.user.email}`);
    signOut.classList.remove("hidden");
  } else {
    show(session, "Not signed in yet.", true);
    signOut.classList.add("hidden");
  }
  return activeSession;
}

sendLink.addEventListener("click", async () => {
  sendLink.disabled = true;
  const { error } = await supabase.auth.signInWithOtp({
    email: email.value.trim(),
    options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
  });
  show(result, error ? `Could not send sign-in link: ${error.message}` : "Sign-in link sent. Open it in this browser, then return here.", Boolean(error));
  sendLink.disabled = false;
});

signOut.addEventListener("click", async () => { await supabase.auth.signOut(); await refreshSession(); });
preset.addEventListener("change", setPayload);

run.addEventListener("click", async () => {
  let body;
  try { body = JSON.parse(payload.value); } catch { show(result, "Operation JSON is not valid.", true); return; }
  const activeSession = await refreshSession();
  if (!activeSession) { show(result, "Sign in with the tester email before calling Future You.", true); return; }
  run.disabled = true;
  try {
    const response = await fetch(functionUrl, {
      method: "POST", headers: { Authorization: `Bearer ${activeSession.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const text = await response.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    show(result, `HTTP ${response.status}\n${JSON.stringify(parsed, null, 2)}`, !response.ok);
  } catch (error) {
    show(result, `Request failed: ${error instanceof Error ? error.message : "Unknown error"}`, true);
  } finally { run.disabled = false; }
});

document.querySelector("#copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(result.textContent ?? "");
  show(result, `${result.textContent}\n\nCopied to clipboard.`);
});

setPayload();
refreshSession();
