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
const guidedGoal = document.querySelector("#guided-goal");
const guidedBegin = document.querySelector("#guided-begin");
const guidedFlow = document.querySelector("#guided-flow");
const guidedStage = document.querySelector("#guided-stage");
const guidedQuestionWrap = document.querySelector("#guided-question-wrap");
const guidedQuestion = document.querySelector("#guided-question");
const guidedReason = document.querySelector("#guided-reason");
const guidedOptions = document.querySelector("#guided-options");
const guidedAnswer = document.querySelector("#guided-answer");
const guidedSubmit = document.querySelector("#guided-submit");
const guidedActions = document.querySelector("#guided-actions");
const guidedSource = document.querySelector("#guided-source");
const guidedFreeze = document.querySelector("#guided-freeze");
const guidedPlan = document.querySelector("#guided-plan");
const guidedApprove = document.querySelector("#guided-approve");
const guidedDraft = document.querySelector("#guided-draft");
const topicPicker = document.querySelector("#topic-picker");
let guided = JSON.parse(localStorage.getItem("future-you-guided-test") || "null");

const topics = [
  ["build_stronger_relationships", "Build stronger relationships", "I want to strengthen an important relationship."],
  ["communicate_better", "Communicate better", "I want to communicate more clearly in an important situation."],
  ["set_better_boundaries", "Set better boundaries", "I want to set a boundary I can follow through on."],
  ["become_more_confident", "Become more confident", "I want to act with more confidence in a specific situation."],
  ["build_self_trust", "Build self-trust", "I want to trust myself more when making decisions."],
  ["manage_my_time_better", "Manage my time better", "I want to manage my time in a way that feels realistic."],
  ["stop_putting_things_off", "Stop putting things off", "I want to stop delaying something important."],
  ["get_my_home_organized", "Get my home organized", "I want to make one part of my home work better."],
  ["build_routines_that_work", "Build routines that work", "I want to build a simple routine I can keep this week."],
  ["feel_more_like_myself", "Feel more like myself", "I want to feel more like myself in daily life."],
];
let selectedTopic = "build_routines_that_work";

function renderTopics() {
  topicPicker.innerHTML = "";
  for (const [key, label, suggestion] of topics) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.classList.toggle("selected", key === selectedTopic);
    button.addEventListener("click", () => { selectedTopic = key; guidedGoal.value = suggestion; renderTopics(); });
    topicPicker.append(button);
  }
}

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

async function callFutureYou(body) {
  const activeSession = await refreshSession();
  if (!activeSession) throw new Error("Sign in with the tester email before calling Future You.");
  const response = await fetch(functionUrl, {
    method: "POST", headers: { Authorization: `Bearer ${activeSession.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
  return data;
}

const questionCopy = (target) => {
  const key = String(target?.key || "").replaceAll("_", " ");
  const prompts = {
    routine_target: "What routine would you like to build?",
    routine_function: "What would this routine help you do or feel?",
    routine_dose_window: "When and how often could you realistically do it this week?",
    routine_current_pattern: "What happens now when you try to do this?",
    routine_time_energy_access_fit: "What time, energy, or access limits should this plan respect?",
    routine_cue_structure: "What could remind or prompt you to begin?",
    routine_after_disruption: "What usually happens after the routine is interrupted?",
    routine_dimension: "Which part needs the most support right now: starting, repeating, recovering, or adapting?",
    routine_cross_goal_route: "Is another goal or situation affecting this routine?",
    routine_safety_reality: "Is there anything important that would make this unsafe or unrealistic to pursue right now?",
  };
  return prompts[target?.key] || `Please tell us about ${key}.`;
};
function saveGuided() { localStorage.setItem("future-you-guided-test", JSON.stringify(guided)); }
function draft(value) { guidedDraft.textContent = JSON.stringify(value, null, 2); guidedDraft.classList.remove("hidden"); }
function renderGuided() {
  if (!guided?.intakeId) return;
  guidedFlow.classList.remove("hidden");
  const target = guided.nextTarget;
  if (target?.key) {
    guidedStage.textContent = `Intake in progress • ${target.decisionArea || "context"} information`;
    const draftQuestion = guided.questionDraft;
    guidedQuestion.textContent = draftQuestion?.question || questionCopy(target);
    guidedReason.textContent = draftQuestion?.whyThisMatters || target.reason || "This answer helps Future You make a realistic plan instead of guessing.";
    guidedOptions.innerHTML = "";
    const selected = new Set(guided.selectedOptionIds || []);
    for (const option of draftQuestion?.options || []) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = option.label;
      button.classList.toggle("selected", selected.has(option.id));
      button.addEventListener("click", () => {
        const multi = draftQuestion?.control === "multi_select";
        if (multi) selected.has(option.id) ? selected.delete(option.id) : selected.add(option.id);
        else { selected.clear(); selected.add(option.id); }
        guided.selectedOptionIds = [...selected];
        guidedAnswer.value = [...selected].map((id) => (draftQuestion.options || []).find((item) => item.id === id)?.label).filter(Boolean).join(", ");
        renderGuided();
      });
      guidedOptions.append(button);
    }
    guidedQuestionWrap.classList.remove("hidden"); guidedActions.classList.add("hidden");
  } else {
    guidedStage.textContent = "Intake complete • you can now inspect the AI's Source draft before any plan is made.";
    guidedQuestionWrap.classList.add("hidden"); guidedActions.classList.remove("hidden");
    guidedFreeze.classList.toggle("hidden", !guided.sourceDraft);
    guidedPlan.classList.toggle("hidden", !guided.sourceFrozen);
    guidedApprove.classList.toggle("hidden", !guided.planDraft);
  }
}

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
    const parsed = await callFutureYou(body);
    show(result, `HTTP 200\n${JSON.stringify(parsed, null, 2)}`);
  } catch (error) {
    show(result, `Request failed: ${error instanceof Error ? error.message : "Unknown error"}`, true);
  } finally { run.disabled = false; }
});

guidedBegin.addEventListener("click", async () => {
  guidedBegin.disabled = true;
  try {
    const data = await callFutureYou({ operation: "start_intake", topicKey: selectedTopic, goalText: guidedGoal.value.trim() });
    guided = { intakeId: data.intake.intake_instance_id, goalId: data.intake.goal_id, topicKey: selectedTopic, nextTarget: data.intake.next_information_target };
    guided.questionDraft = (await callFutureYou({ operation: "derive_intake_question", intakeInstanceId: guided.intakeId })).questionDraft;
    saveGuided(); renderGuided(); show(result, "Guided intake started successfully.");
  } catch (error) { show(result, error instanceof Error ? error.message : "Unable to start the guided intake.", true); }
  finally { guidedBegin.disabled = false; }
});
guidedSubmit.addEventListener("click", async () => {
  const answer = guidedAnswer.value.trim(); if (!answer) return;
  guidedSubmit.disabled = true;
  try {
    const data = await callFutureYou({ operation: "record_intake_answer", intakeInstanceId: guided.intakeId, informationKey: guided.nextTarget.key, rawValue: { answer, selectedOptionIds: guided.selectedOptionIds || [] } });
    guided.nextTarget = data.result.next_target; guidedAnswer.value = ""; guided.selectedOptionIds = []; guided.questionDraft = guided.nextTarget ? (await callFutureYou({ operation: "derive_intake_question", intakeInstanceId: guided.intakeId })).questionDraft : null; saveGuided(); renderGuided();
  } catch (error) { show(result, error instanceof Error ? error.message : "Unable to save this answer.", true); }
  finally { guidedSubmit.disabled = false; }
});
guidedSource.addEventListener("click", async () => {
  guidedSource.disabled = true;
  try { const data = await callFutureYou({ operation: "derive_source_handoff", intakeInstanceId: guided.intakeId }); guided.sourceDraft = data.sourceDraft; saveGuided(); draft({ stage: "AI Source draft — review this before accepting", draft: data.sourceDraft }); renderGuided(); }
  catch (error) { show(result, error instanceof Error ? error.message : "Unable to create Source draft.", true); } finally { guidedSource.disabled = false; }
});
guidedFreeze.addEventListener("click", async () => {
  guidedFreeze.disabled = true;
  try { const data = await callFutureYou({ operation: "freeze_source_handoff", intakeInstanceId: guided.intakeId, sourceDraft: guided.sourceDraft }); guided.sourceFrozen = true; saveGuided(); draft({ stage: "Source accepted for this test", result: data }); renderGuided(); }
  catch (error) { show(result, error instanceof Error ? error.message : "Unable to accept Source draft.", true); } finally { guidedFreeze.disabled = false; }
});
guidedPlan.addEventListener("click", async () => {
  guidedPlan.disabled = true;
  try { const data = await callFutureYou({ operation: "derive_initial_plan", intakeInstanceId: guided.intakeId }); guided.planDraft = data.planDraft; saveGuided(); draft({ stage: "AI action-plan draft — review before approving", draft: data.planDraft }); renderGuided(); }
  catch (error) { show(result, error instanceof Error ? error.message : "Unable to create action-plan draft.", true); } finally { guidedPlan.disabled = false; }
});
guidedApprove.addEventListener("click", async () => {
  guidedApprove.disabled = true;
  try { const data = await callFutureYou({ operation: "approve_initial_plan", intakeInstanceId: guided.intakeId, planDraft: guided.planDraft }); guided.planApproved = true; saveGuided(); draft({ stage: "Action plan saved — this is the plan a user would see", result: data, plan: guided.planDraft }); }
  catch (error) { show(result, error instanceof Error ? error.message : "Unable to approve action plan.", true); } finally { guidedApprove.disabled = false; }
});

document.querySelector("#copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(result.textContent ?? "");
  show(result, `${result.textContent}\n\nCopied to clipboard.`);
});

setPayload();
refreshSession();
renderTopics();
renderGuided();
