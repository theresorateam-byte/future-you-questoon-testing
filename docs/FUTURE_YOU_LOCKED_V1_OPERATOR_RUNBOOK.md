# Future You Locked v1 operator runbook

This runbook applies only to the Supabase `future-you-locked` Edge Function. It does not use or modify the Firebase application.

## Before a tester session

- Confirm the deployed function requires JWT verification and is active.
- Sign in with a tester account that has an active `tester_access` record.
- Use that tester's JWT only; do not call the locked tables or RPCs directly from a client.
- Use `contract_status` to confirm all required locked contract scopes are present.

## Initial-plan acceptance path

1. Call `start_intake` with an approved topic. The selected topic starts the conversation; the user does not type a goal statement before questions begin.
2. Repeatedly read `intake_state` and submit only the current target through `record_intake_answer`.
3. Confirm `intake_readiness.readyForSource` is true.
4. Use `source_handoff_preview` or `derive_source_handoff`; treat any model result as a draft.
5. Call `validate_source_handoff`, correct cited fields if needed, then call `freeze_source_handoff` exactly once.
6. Call `derive_initial_plan`, validate the returned draft, and call `approve_initial_plan` only after the tester accepts it.
7. Confirm `plan_state` reports an immutable Original Plan and Live Plan revision 1.

## Progress and future-only revision path

1. Read `today_step` and use `progress_update_options` to obtain server-generated choices.
2. Submit one choice through `record_progress_update`; confirm it creates canonical evidence.
3. Call `derive_progression_assessment`, validate it, and apply it with the returned current Level 3 revision.
4. Call `derive_live_plan_revision` with the saved Progress Update and assessment IDs plus the expected Live Plan revision.
5. Commit only a locally validated draft through `revise_live_plan`.
6. Confirm the response reports a new revision and that the Original Plan and completed portion did not change.

## Change Path acceptance path

1. Call `start_change_path` for an existing goal; do not start a new Original Plan.
2. Complete only the re-entry intake requirements.
3. A Source draft may cite parent facts as reference context and re-entry facts as current context; histories remain separate.
4. Freeze the Change Path source, derive a future-only revision with `changePathId`, then commit it with the same identifier.
5. Confirm the Change Path becomes committed and the Original Plan remains unchanged.

## Weekly review path

1. Read `weekly_checkin_state` after a plan exists. The UI may offer the review once seven days have passed; the Test Lab can start it early for testing.
2. Start a locally generated `checkInId`, then repeatedly call `derive_weekly_checkin_question` and save a selected/typed answer only through `record_weekly_checkin_answer`.
3. Confirm the question references only this goal’s recorded daily update pattern and does not repeat an answered review area.
4. Finish with `complete_weekly_checkin` only after at least three answers. Verify that it creates `check_in` evidence, not a plan or Level 3 write.
5. Use the normal assessment/revision path if a review of the new weekly evidence is desired; verify the Original Plan and completed portion remain unchanged.

## Required negative checks

- Missing or expired JWT returns `401`.
- A user cannot load another user's goal, intake, evidence, plan, or Change Path.
- An unready intake cannot derive or freeze a Source handoff.
- Invented source fact keys, evidence IDs, topic units, and plan fields are rejected.
- An initial-plan operation against a Change Path is rejected.
- A stale Level 3 or Live Plan revision returns a conflict.
- A revision that changes `completedPortion` is rejected.
- AI derivation responses remain drafts: no model call freezes a source, applies Level 3, or writes a plan.

## Model-data boundary

All derivation calls use the Responses API with `store: false`, enforced centrally even if a future derivation requests otherwise, plus bounded model input, a request deadline, JSON-object output validation, and local Locked v1 contract validation. The only model-side user identifier is a SHA-256 digest; no email or raw Supabase user ID is sent for that purpose. Model/provider error bodies are not written to function logs. Unit coverage exercises completed responses, incomplete responses, malformed JSON, the standard output-content fallback, provider-error redaction, and input-size bounds for every derivation source, including current Level 3 state.

## Future journal, message, and recommendation sources

These sources are intentionally disabled in Locked v1. Do not widen an existing operation to read them. A future release must add a dedicated protected operation, per-category revocable consent, bounded server-side preparation, provenance, and tests before it can use any such source. Meditation recommendations must remain recommendations rather than evidence of a user’s state.

## Completion evidence

Capture the deployed function version, test-suite output, and one staged authenticated journey covering the initial-plan path, Progress Update path, and Change Path path. The staged authenticated journey is the remaining production-readiness check; it requires a real authorized tester session and must not be simulated with another user's credentials.
