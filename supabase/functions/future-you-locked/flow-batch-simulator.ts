import { deriveIntakeQuestion } from "./intake-question-deriver.ts";
import { deriveNextIntakeTarget } from "./intake-turn-deriver.ts";
import { deriveInitialPlan } from "./plan-deriver.ts";
import { deriveSourceHandoff } from "./source-deriver.ts";
import { buildVisibleUpdateChoices, currentTodayStep } from "./update-contract.ts";
import { requirementsForTopic } from "./topic-requirements.ts";
import { umbrellaEntry, umbrellaQuestionForTarget, routeUmbrellaAnswer } from "./umbrella-routing.ts";

const ENTRY_GOALS: Record<string, string[]> = {
  build_stronger_relationships: ["Feel closer to a friend after growing apart.", "Make more room for a relationship that matters."],
  communicate_better: ["Speak more clearly with a coworker when work gets stressful.", "Handle hard conversations without shutting down."],
  set_better_boundaries: ["Set a limit with a family member who contacts me during work.", "Say no to last-minute requests without overexplaining."],
  become_more_confident: ["Speak up in meetings when I have an idea.", "Feel more able to take the lead in a work conversation."],
  get_more_done: ["Get through my important tasks without leaving them until the last minute.", "Make room for the work that keeps being pushed back."],
  get_daily_life_in_order: ["Keep my home workable during a busy week.", "Create a daily routine that does not fall apart after one hard day."],
  feel_more_like_myself: ["Reconnect with the parts of myself that I have been neglecting.", "Feel less disconnected from my own priorities."],
};

const MAX_TURNS = 8;

function syntheticAnswer(question: Record<string, unknown>, caseNumber: number) {
  const control = String(question.control ?? "text");
  const options = Array.isArray(question.options) ? question.options as Record<string, unknown>[] : [];
  if (control === "single_select") {
    const real = options.find((option) => String(option.id) !== "other") ?? options[0];
    return { selectedOptionIds: real ? [String(real.id)] : [], answer: real ? String(real.label) : "I am not sure." };
  }
  if (control === "multi_select") {
    const real = options.filter((option) => String(option.id) !== "other").slice(0, caseNumber % 2 === 0 ? 2 : 1);
    return { selectedOptionIds: real.map((option) => String(option.id)), answer: real.map((option) => String(option.label)).join(", ") || "I am not sure." };
  }
  if (control === "number") return { selectedOptionIds: [], answer: String(caseNumber % 2 === 0 ? 20 : 30) };
  if (control === "date") return { selectedOptionIds: [], answer: "2026-10-01" };
  if (control === "time") return { selectedOptionIds: [], answer: "18:00" };
  return { selectedOptionIds: [], answer: "I need a small change that fits around my current responsibilities." };
}

function finding(transcript: Record<string, unknown>[]) {
  const questions = transcript.map((turn) => String(turn.question ?? "").toLowerCase());
  const repeated = questions.some((question, index) => questions.indexOf(question) !== index);
  const noChoices = transcript.filter((turn) => String(turn.control).includes("select") && (!Array.isArray(turn.options) || turn.options.length === 0)).length;
  return [
    ...(repeated ? ["Repeated question wording appeared in this run."] : []),
    ...(noChoices ? [`${noChoices} selectable question(s) had no visible choices.`] : []),
    ...(!repeated && !noChoices ? ["No mechanical issue was found in this preview. Review whether each question feels necessary and well-timed."] : []),
  ];
}

/** Runs real Locked-v1 wording, sequencing, plan, and update-choice code in memory. Nothing is written to Supabase. */
export async function simulateFlowBatch(entryKey: string, caseCount: number, safetyIdentifier: string) {
  const umbrella = umbrellaEntry(entryKey);
  const goals = ENTRY_GOALS[entryKey];
  if (!goals) throw new Error("Choose a valid user-facing Future You entry.");
  const cases: Record<string, unknown>[] = [];
  for (let caseNumber = 0; caseNumber < caseCount; caseNumber += 1) {
    const goal = goals[caseNumber % goals.length];
    const transcript: Record<string, unknown>[] = [];
    let internalTopic = entryKey;
    const facts: Record<string, unknown>[] = [{ fact_key: "simulated_goal", fact_value: goal, status: "confirmed", stability: "current", provenance: { source: "simulation" } }];
    if (umbrella) {
      const routeQuestion = umbrellaQuestionForTarget(umbrella.initialKey)!;
      const routeOption = caseNumber % 3 === 1 ? umbrella.options[1] : umbrella.options[0];
      const answer = { selectedOptionIds: [routeOption.id], answer: routeOption.label };
      internalTopic = routeUmbrellaAnswer(entryKey, answer)!;
      transcript.push({ sequence: 1, question: routeQuestion.question, control: routeQuestion.control, options: routeQuestion.options, answer, internalOwner: internalTopic, whyThisMatters: routeQuestion.whyThisMatters });
      facts.push({ fact_key: umbrella.initialKey, fact_value: answer.answer });
    }
    const remaining = requirementsForTopic(internalTopic).map((requirement) => ({ requirement_key: requirement.key, priority: requirement.priority, decision_area: requirement.decisionArea, target: { key: requirement.key, decisionArea: requirement.decisionArea } }));
    for (let turn = 0; turn < MAX_TURNS && remaining.length; turn += 1) {
      const selected = await deriveNextIntakeTarget({ goalText: goal, facts, candidates: remaining, safetyIdentifier });
      if (!selected) break;
      const questionResult = await deriveIntakeQuestion({ goalText: goal, target: selected.target as Record<string, unknown>, facts, safetyIdentifier });
      const answer = syntheticAnswer(questionResult.question, caseNumber + turn);
      transcript.push({ sequence: transcript.length + 1, informationKey: selected.requirement_key, question: questionResult.question.question, control: questionResult.question.control, options: questionResult.question.options, answer, whyThisMatters: questionResult.question.whyThisMatters });
      facts.push({ fact_key: selected.requirement_key, fact_value: answer.answer });
      remaining.splice(remaining.findIndex((item) => item.requirement_key === selected.requirement_key), 1);
    }
    let plan: Record<string, unknown> | null = null;
    let planError: string | null = null;
    let sourceError: string | null = null;
    try {
      const source = await deriveSourceHandoff({ facts, unresolvedUncertainties: [], safetyIdentifier });
      plan = (await deriveInitialPlan(source.sourceDraft, safetyIdentifier)).plan;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Simulation derivation failed.";
      if (message.startsWith("AI Source")) sourceError = message;
      else planError = message;
    }
    const todayStep = plan ? currentTodayStep(plan) : null;
    const updateChoices = plan ? buildVisibleUpdateChoices(plan) : [];
    cases.push({ caseNumber: caseNumber + 1, selectedEntry: entryKey, goal, internalOwner: internalTopic, transcript, plan, sourceError, planError, todayStep, updateChoices, findings: finding(transcript) });
  }
  return { cases, note: "This is an in-memory replay. Questions, sequencing, action-plan derivation, and update choices use Locked v1 code; no intake, plan, update, or user content was saved." };
}
