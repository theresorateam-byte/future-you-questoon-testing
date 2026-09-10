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
const guidedBegin = document.querySelector("#guided-begin");
const guidedReset = document.querySelector("#guided-reset");
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
const planDocument = document.querySelector("#plan-document");
const guidedUpdate = document.querySelector("#guided-update");
const guidedTodayStep = document.querySelector("#guided-today-step");
const guidedUpdateChoices = document.querySelector("#guided-update-choices");
const guidedUpdateReason = document.querySelector("#guided-update-reason");
const guidedUpdateNote = document.querySelector("#guided-update-note");
const guidedSaveUpdate = document.querySelector("#guided-save-update");
const guidedWeekly = document.querySelector("#guided-weekly");
const guidedWeeklyStatus = document.querySelector("#guided-weekly-status");
const guidedWeeklyStart = document.querySelector("#guided-weekly-start");
const guidedWeeklyQuestionWrap = document.querySelector("#guided-weekly-question-wrap");
const guidedWeeklyQuestion = document.querySelector("#guided-weekly-question");
const guidedWeeklyReason = document.querySelector("#guided-weekly-reason");
const guidedWeeklyOptions = document.querySelector("#guided-weekly-options");
const guidedWeeklyAnswer = document.querySelector("#guided-weekly-answer");
const guidedWeeklySubmit = document.querySelector("#guided-weekly-submit");
const guidedWeeklyComplete = document.querySelector("#guided-weekly-complete");
const topicPicker = document.querySelector("#topic-picker");
const loadActivePlans = document.querySelector("#load-active-plans");
const activePlanList = document.querySelector("#active-plan-list");
const sandboxPlanDocument = document.querySelector("#sandbox-plan-document");
const sandboxUpdate = document.querySelector("#sandbox-update");
const sandboxTodayStep = document.querySelector("#sandbox-today-step");
const sandboxUpdateChoices = document.querySelector("#sandbox-update-choices");
const sandboxUpdateReason = document.querySelector("#sandbox-update-reason");
const sandboxUpdateNote = document.querySelector("#sandbox-update-note");
const sandboxSaveUpdate = document.querySelector("#sandbox-save-update");
const batchEntry = document.querySelector("#batch-entry");
const runBatch = document.querySelector("#run-batch");
const batchReport = document.querySelector("#batch-report");
let guided = JSON.parse(localStorage.getItem("future-you-guided-test") || "null");
let sandbox = null;

const topics = [
  ["build_stronger_relationships", "Build stronger relationships"],
  ["communicate_better", "Communicate better"],
  ["set_better_boundaries", "Set better boundaries"],
  ["become_more_confident", "Become more confident"],
  ["get_more_done", "Get more done"],
  ["get_daily_life_in_order", "Get daily life in order"],
  ["feel_more_like_myself", "Feel more like myself"],
];
let selectedTopic = "get_more_done";

function renderTopics() {
  topicPicker.innerHTML = "";
  for (const [key, label] of topics) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.classList.toggle("selected", key === selectedTopic);
    button.addEventListener("click", () => { selectedTopic = key; renderTopics(); });
    topicPicker.append(button);
  }
}

const presets = {
  contract_status: { operation: "contract_status" },
  start_intake: { operation: "start_intake", topicKey: "get_more_done" },
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
function text(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function itemText(item) {
  if (text(item)) return item.trim();
  if (!item || typeof item !== "object") return null;
  const record = item;
  return [record.action, record.title, record.label, record.description, record.minimumVersion, record.successMarker].filter(text).join(" — ") || null;
}
function listHtml(items) {
  const values = (Array.isArray(items) ? items : []).map(itemText).filter(Boolean);
  return values.length ? `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : "<p class=\"plan-note\">Not specified yet.</p>";
}
function escapeHtml(value) { const element = document.createElement("span"); element.textContent = String(value); return element.innerHTML; }
function planHtml(plan, title = "Action plan") {
  if (!plan || typeof plan !== "object") return "<p class=\"plan-note\">No readable plan is available yet.</p>";
  const goal = text(plan.goal?.intendedResult) || "Your selected direction";
  const first = plan.firstTodayStep || plan.prepareAction;
  const step = first && typeof first === "object" ? `<h3>Start here</h3><p><strong>${escapeHtml(itemText(first) || "A first step will appear here.")}</strong></p>` : "";
  return `<h2>${escapeHtml(title)}</h2><h3>What you’re working on</h3><p>${escapeHtml(goal)}</p><h3>This week’s focus</h3>${listHtml(plan.remainingPlan)}${step}<h3>What progress looks like</h3>${listHtml(plan.successMarkers)}<h3>Important guardrails</h3>${listHtml(plan.guardrails)}<p class=\"plan-note\">Starting mode: ${escapeHtml(String(plan.mode || "not set").replaceAll("_", " "))}. This view translates the stored plan; it does not change it.</p>`;
}
function showPlan(target, plan, title) { target.innerHTML = planHtml(plan, title); target.classList.remove("hidden"); }
function batchHtml(cases) {
  return `<h2>Automatic example</h2>${cases.map((item) => `<section><h3>${escapeHtml(item.goal)}</h3><p><strong>Internal owner:</strong> ${escapeHtml(item.internalOwner)}</p><h3>Conversation transcript</h3>${(item.transcript || []).map((turn) => `<div class="plan-document"><p><strong>Future You:</strong> ${escapeHtml(turn.question)}</p><p><strong>Simulated user ${turn.control?.includes("select") ? "taps" : "answers"}:</strong> ${escapeHtml(turn.answer?.answer || "")}</p><p class="plan-note">${escapeHtml(turn.whyThisMatters || "")}</p></div>`).join("")}<h3>Action plan draft</h3>${item.plan ? planHtml(item.plan, "Action plan") : `<p class="error">${escapeHtml(item.sourceError ? `Source handoff failed: ${item.sourceError}` : item.planError || "No plan draft was created.")}</p>`}<h3>Progress example</h3>${listHtml((item.progressUpdates || []).map((update) => `${update.selectedChoice?.label || update.normalizedState} — ${update.optionalNote}`))}${item.weeklyQuestion ? `<h3>Weekly review question</h3><p>${escapeHtml(item.weeklyQuestion.question)}</p>` : ""}${item.assessment ? `<h3>Future You’s proposed direction</h3><p>${escapeHtml(item.assessment.planRecommendation?.outcome || "No plan change proposed")}: ${escapeHtml(item.assessment.planRecommendation?.rationale || "")}</p>` : `<p class="error">${escapeHtml(item.progressError || "Progress assessment was not available.")}</p>`}<h3>What to review</h3>${listHtml(item.findings)}</section>`).join("")}`;
}
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
  if (guided?.liveRevision && guided?.todayStep) {
    guidedUpdate.classList.remove("hidden");
    guidedTodayStep.textContent = `Today’s Step: ${guided.todayStep.action}\nSmallest version: ${guided.todayStep.minimumVersion}`;
    guidedUpdateChoices.innerHTML = "";
    for (const choice of guided.updateChoices || []) { const button = document.createElement("button"); button.type = "button"; button.textContent = choice.label; button.classList.toggle("selected", guided.selectedUpdateChoiceId === choice.id); button.addEventListener("click", () => { guided.selectedUpdateChoiceId = choice.id; renderGuided(); }); guidedUpdateChoices.append(button); }
  }
  if (guided?.goalId && guided?.planApproved) {
    guidedWeekly.classList.remove("hidden");
    const checkIn = guided.weeklyState?.weeklyCheckIn;
    guidedWeeklyStatus.textContent = checkIn?.note || "A weekly review looks at the past seven days of recorded updates and asks deeper follow-up questions.";
    const weeklyDraft = guided.weeklyQuestionDraft;
    if (weeklyDraft) {
      guidedWeeklyQuestionWrap.classList.remove("hidden");
      guidedWeeklyQuestion.textContent = weeklyDraft.question;
      guidedWeeklyReason.textContent = weeklyDraft.whyThisMatters;
      guidedWeeklyOptions.innerHTML = "";
      const selected = new Set(guided.weeklySelectedOptionIds || []);
      for (const option of weeklyDraft.options || []) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = option.label;
        button.classList.toggle("selected", selected.has(option.id));
        button.addEventListener("click", () => {
          const multi = weeklyDraft.control === "multi_select";
          if (multi) selected.has(option.id) ? selected.delete(option.id) : selected.add(option.id);
          else { selected.clear(); selected.add(option.id); }
          guided.weeklySelectedOptionIds = [...selected];
          guidedWeeklyAnswer.value = [...selected].map((id) => (weeklyDraft.options || []).find((item) => item.id === id)?.label).filter(Boolean).join(", ");
          saveGuided(); renderGuided();
        });
        guidedWeeklyOptions.append(button);
      }
      guidedWeeklyComplete.classList.add("hidden");
    } else {
      guidedWeeklyQuestionWrap.classList.add("hidden");
      const enoughAnswers = (guided.weeklyAnswerCount || 0) >= 3 && guided.weeklyCheckInId && !guided.weeklyCompleted;
      guidedWeeklyComplete.classList.toggle("hidden", !enoughAnswers);
    }
    guidedWeeklyStart.classList.toggle("hidden", Boolean(guided.weeklyCheckInId));
  }
}

async function loadUpdateFlow() {
  const data = await callFutureYou({ operation: "progress_update_options", goalId: guided.goalId });
  guided.liveRevision = data.liveRevision; guided.todayStep = data.todayStep; guided.updateChoices = data.visibleChoices; saveGuided(); renderGuided();
}

function renderSandbox() {
  if (!sandbox?.plan || !sandbox?.todayStep) return;
  showPlan(sandboxPlanDocument, sandbox.plan, "Current action plan");
  sandboxUpdate.classList.remove("hidden");
  sandboxTodayStep.textContent = `Today’s Step: ${sandbox.todayStep.action}\nSmallest version: ${sandbox.todayStep.minimumVersion}`;
  sandboxUpdateChoices.innerHTML = "";
  for (const choice of sandbox.updateChoices || []) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = choice.label;
    button.classList.toggle("selected", sandbox.selectedChoiceId === choice.id);
    button.addEventListener("click", () => { sandbox.selectedChoiceId = choice.id; renderSandbox(); });
    sandboxUpdateChoices.append(button);
  }
}

async function openSandboxGoal(goalId) {
  const [state, updates] = await Promise.all([
    callFutureYou({ operation: "plan_state", goalId }),
    callFutureYou({ operation: "progress_update_options", goalId }),
  ]);
  sandbox = { goalId, plan: state.livePlan.plan, liveRevision: updates.liveRevision, todayStep: updates.todayStep, updateChoices: updates.visibleChoices };
  renderSandbox();
  show(result, "Approved plan opened. You can now test the update flow directly.");
}

async function syncGuidedIntake() {
  if (!guided?.goalId || !guided?.intakeId) return false;
  const state = await callFutureYou({ operation: "intake_state", goalId: guided.goalId });
  const current = state.intake;
  if (!current || current.id !== guided.intakeId) throw new Error("This browser test is no longer the current intake. Reset the browser test and begin again.");
  const serverTarget = current.next_information_target;
  if (!serverTarget?.key || serverTarget.key === guided.nextTarget?.key) return false;
  guided.nextTarget = serverTarget;
  guided.selectedOptionIds = [];
  guidedAnswer.value = "";
  guided.questionDraft = (await callFutureYou({ operation: "derive_intake_question", intakeInstanceId: guided.intakeId })).questionDraft;
  saveGuided(); renderGuided();
  show(result, "The server had moved to the next question. The correct question is now loaded; your previous saved answer was not changed.");
  return true;
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
    const data = await callFutureYou({ operation: "start_intake", topicKey: selectedTopic });
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
    if (await syncGuidedIntake()) return;
    const data = await callFutureYou({ operation: "record_intake_answer", intakeInstanceId: guided.intakeId, informationKey: guided.nextTarget.key, rawValue: { answer, selectedOptionIds: guided.selectedOptionIds || [] } });
    guided.nextTarget = data.result.next_target; guidedAnswer.value = ""; guided.selectedOptionIds = []; guided.questionDraft = guided.nextTarget ? (await callFutureYou({ operation: "derive_intake_question", intakeInstanceId: guided.intakeId })).questionDraft : null; saveGuided(); renderGuided();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save this answer.";
    if (message.includes("future_you_answer_not_for_current_target")) {
      try { if (await syncGuidedIntake()) return; } catch { /* The original error remains useful. */ }
    }
    show(result, message, true);
  }
  finally { guidedSubmit.disabled = false; }
});
guidedReset.addEventListener("click", () => {
  localStorage.removeItem("future-you-guided-test");
  guided = null; guidedFlow.classList.add("hidden"); guidedWeekly.classList.add("hidden");
  show(result, "This browser’s saved test state was cleared. No Supabase records were deleted. Choose a topic and begin a fresh test.");
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
  try { const data = await callFutureYou({ operation: "derive_initial_plan", intakeInstanceId: guided.intakeId }); guided.planDraft = data.planDraft; saveGuided(); draft({ stage: "AI action-plan draft — review before approving", draft: data.planDraft }); showPlan(planDocument, data.planDraft, "Action plan draft"); renderGuided(); }
  catch (error) { show(result, error instanceof Error ? error.message : "Unable to create action-plan draft.", true); } finally { guidedPlan.disabled = false; }
});
guidedApprove.addEventListener("click", async () => {
  guidedApprove.disabled = true;
  try { const data = await callFutureYou({ operation: "approve_initial_plan", intakeInstanceId: guided.intakeId, planDraft: guided.planDraft }); guided.planApproved = true; guided.weeklyState = await callFutureYou({ operation: "weekly_checkin_state", goalId: guided.goalId }); saveGuided(); draft({ stage: "Action plan saved — this is the plan a user would see", result: data, plan: guided.planDraft }); showPlan(planDocument, guided.planDraft, "Your action plan"); await loadUpdateFlow(); }
  catch (error) { show(result, error instanceof Error ? error.message : "Unable to approve action plan.", true); } finally { guidedApprove.disabled = false; }
});
guidedSaveUpdate.addEventListener("click", async () => {
  if (!guided.selectedUpdateChoiceId) return;
  guidedSaveUpdate.disabled = true;
  try {
    const choice = (guided.updateChoices || []).find((item) => item.id === guided.selectedUpdateChoiceId);
    const data = await callFutureYou({ operation: "record_progress_update", goalId: guided.goalId, clientUpdateId: crypto.randomUUID(), expectedLiveRevision: guided.liveRevision, selectedChoiceId: guided.selectedUpdateChoiceId, reasonCategory: choice?.normalizedState === "completed" ? null : guidedUpdateReason.value, reasonCode: guidedUpdateNote.value.trim() || choice?.normalizedState || "completed", variables: [], optionalNote: guidedUpdateNote.value.trim() || null });
    draft({ stage: "Update saved", update: data, next: "The next step is to review the evidence and generate the Level 3 assessment draft." });
    if (guided.planApproved) {
      guided.weeklyState = await callFutureYou({ operation: "weekly_checkin_state", goalId: guided.goalId });
      saveGuided(); renderGuided();
    }
  } catch (error) { show(result, error instanceof Error ? error.message : "Unable to save this update.", true); } finally { guidedSaveUpdate.disabled = false; }
});

async function loadWeeklyQuestion() {
  const data = await callFutureYou({ operation: "derive_weekly_checkin_question", goalId: guided.goalId, checkInId: guided.weeklyCheckInId });
  guided.weeklyAnswerCount = data.answerCount || 0;
  guided.weeklyQuestionDraft = data.questionDraft || null;
  if (data.complete) guided.weeklyQuestionDraft = null;
  saveGuided(); renderGuided();
}

guidedWeeklyStart.addEventListener("click", async () => {
  guidedWeeklyStart.disabled = true;
  try {
    guided.weeklyCheckInId = crypto.randomUUID(); guided.weeklyAnswerCount = 0; guided.weeklyCompleted = false;
    await loadWeeklyQuestion();
    draft({ stage: "Weekly review started", note: "The next question is based on this goal's recorded daily updates. Nothing is finished until you press Finish weekly review." });
  } catch (error) { show(result, error instanceof Error ? error.message : "Unable to start the weekly review.", true); }
  finally { guidedWeeklyStart.disabled = false; }
});

guidedWeeklySubmit.addEventListener("click", async () => {
  const answer = guidedWeeklyAnswer.value.trim(); if (!answer || !guided.weeklyQuestionDraft) return;
  guidedWeeklySubmit.disabled = true;
  try {
    const data = await callFutureYou({ operation: "record_weekly_checkin_answer", goalId: guided.goalId, checkInId: guided.weeklyCheckInId, informationKey: guided.weeklyQuestionDraft.informationKey, answer, selectedOptionIds: guided.weeklySelectedOptionIds || [] });
    guided.weeklyAnswerCount = data.answerCount; guided.weeklyQuestionDraft = null; guided.weeklySelectedOptionIds = []; guidedWeeklyAnswer.value = "";
    await loadWeeklyQuestion();
  } catch (error) { show(result, error instanceof Error ? error.message : "Unable to save this weekly answer.", true); }
  finally { guidedWeeklySubmit.disabled = false; }
});

guidedWeeklyComplete.addEventListener("click", async () => {
  guidedWeeklyComplete.disabled = true;
  try {
    const data = await callFutureYou({ operation: "complete_weekly_checkin", goalId: guided.goalId, checkInId: guided.weeklyCheckInId });
    guided.weeklyCompleted = true; guided.weeklyQuestionDraft = null; guided.weeklyState = await callFutureYou({ operation: "weekly_checkin_state", goalId: guided.goalId }); saveGuided(); renderGuided();
    draft({ stage: "Weekly review complete", result: data, next: "These answers are canonical evidence. The assessment and future-only plan revision can use them; the Original Plan remains unchanged." });
  } catch (error) { show(result, error instanceof Error ? error.message : "Unable to finish this weekly review.", true); }
  finally { guidedWeeklyComplete.disabled = false; }
});

loadActivePlans.addEventListener("click", async () => {
  loadActivePlans.disabled = true;
  try {
    const data = await callFutureYou({ operation: "test_lab_active_goals" });
    activePlanList.innerHTML = "";
    for (const goal of data.activeGoals || []) {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = `${goal.goalText} (revision ${goal.liveRevision})`;
      button.addEventListener("click", async () => { button.disabled = true; try { await openSandboxGoal(goal.goalId); } catch (error) { show(result, error instanceof Error ? error.message : "Unable to open this plan.", true); } finally { button.disabled = false; } });
      activePlanList.append(button);
    }
    activePlanList.classList.remove("hidden");
    if ((data.activeGoals || []).length === 0) activePlanList.textContent = "No approved test plans yet. Finish one guided intake once, then it will appear here for direct update testing.";
  } catch (error) { show(result, error instanceof Error ? error.message : "Unable to find approved plans.", true); }
  finally { loadActivePlans.disabled = false; }
});

sandboxSaveUpdate.addEventListener("click", async () => {
  if (!sandbox?.selectedChoiceId) return;
  sandboxSaveUpdate.disabled = true;
  try {
    const choice = (sandbox.updateChoices || []).find((item) => item.id === sandbox.selectedChoiceId);
    const data = await callFutureYou({ operation: "record_progress_update", goalId: sandbox.goalId, clientUpdateId: crypto.randomUUID(), expectedLiveRevision: sandbox.liveRevision, selectedChoiceId: sandbox.selectedChoiceId, reasonCategory: choice?.normalizedState === "completed" ? null : sandboxUpdateReason.value, reasonCode: sandboxUpdateNote.value.trim() || choice?.normalizedState || "completed", variables: [], optionalNote: sandboxUpdateNote.value.trim() || null });
    show(result, `Test update saved. ${data.note || ""}`);
    sandboxUpdateNote.value = ""; sandbox.selectedChoiceId = null;
  } catch (error) { show(result, error instanceof Error ? error.message : "Unable to save test update.", true); }
  finally { sandboxSaveUpdate.disabled = false; }
});

runBatch.addEventListener("click", async () => {
  runBatch.disabled = true;
  try {
    const data = await callFutureYou({ operation: "simulate_flow_batch", entryKey: batchEntry.value, caseCount: 1 });
    batchReport.innerHTML = batchHtml(data.cases); batchReport.classList.remove("hidden");
    show(result, data.note || "Real-flow simulation completed.");
  } catch (error) { show(result, error instanceof Error ? error.message : "Unable to create batch report.", true); }
  finally { runBatch.disabled = false; }
});

document.querySelector("#copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(result.textContent ?? "");
  show(result, `${result.textContent}\n\nCopied to clipboard.`);
});

setPayload();
refreshSession();
renderTopics();
renderGuided();
