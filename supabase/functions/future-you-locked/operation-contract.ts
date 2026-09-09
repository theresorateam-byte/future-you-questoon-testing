/** Public operations of the authenticated Locked v1 Edge Function. */
export const LOCKED_OPERATIONS = [
  "contract_status",
  "start_intake",
  "start_change_path",
  "intake_state",
  "derive_intake_question",
  "record_intake_answer",
  "intake_readiness",
  "source_handoff_preview",
  "derive_source_handoff",
  "validate_source_handoff",
  "freeze_source_handoff",
  "validate_initial_plan",
  "derive_initial_plan",
  "approve_initial_plan",
  "plan_state",
  "today_step",
  "progress_update_options",
  "record_progress_update",
  "progress_update_state",
  "weekly_checkin_state",
  "derive_weekly_checkin_question",
  "record_weekly_checkin_answer",
  "complete_weekly_checkin",
  "record_evidence",
  "evidence_state",
  "progression_assessment_state",
  "change_path_state",
  "change_path_handoff_context",
  "derive_progression_assessment",
  "validate_progression_assessment",
  "apply_progression_assessment",
  "derive_live_plan_revision",
  "revise_live_plan",
] as const;

export type LockedOperation = typeof LOCKED_OPERATIONS[number];

export function unknownOperationMessage() {
  const finalOperation = LOCKED_OPERATIONS[LOCKED_OPERATIONS.length - 1];
  return `Unknown operation. Use ${LOCKED_OPERATIONS.slice(0, -1).join(", ")}, or ${finalOperation}.`;
}
