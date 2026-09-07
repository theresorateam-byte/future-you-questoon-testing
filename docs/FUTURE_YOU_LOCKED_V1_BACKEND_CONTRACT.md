# Future You — Locked v1 Backend Contract

## Purpose

This document is the implementation contract for the locked Future You architecture. It replaces the prior simulator's broad-domain routing and fixed update ritual. It is not consumer-facing copy and does not replace the locked product documents in Google Drive.

## Non-negotiable rules

- The engine is one universal system with ten approved topic systems and three routing relationships.
- The Original Action Plan is immutable.
- The Live Action Plan is the current source of truth; only its uncompleted future portion may change.
- Every intake answer, update, correction, and decision trace is append-only.
- A canonical evidence item has one identity. It may support more than one construct only when each use is independently justified.
- The engine may preserve uncertainty. Missing data must not become invented certainty.
- `Continue`, `Build`, `Ease`, and `Switch` are the only standard plan-adjustment outcomes.
- `Prepare` is a gate, not an active Path Mode. Active modes are `Tiny Start`, `Steady Build`, and `Challenge`.
- No universal day count, miss count, or composite score may decide a plan change.
- Screens collect and display information. They never decide route, progression, safety, or plan changes.

## Controlled configuration

The following is product-controlled, versioned configuration. It must not be copied wholesale into individual user records:

- Action Plan Master
- Intake Source, I1, I2, and I3 specifications
- Level 1 universal evidence contract
- Level 2 topic contracts
- Topic-specific progression specifications
- Routing contracts

Every goal records the exact version IDs that governed its creation and later decisions.

## Approved topics

1. Build Stronger Relationships
2. Communicate Better
3. Set Better Boundaries
4. Become More Confident
5. Build Self-Trust
6. Manage My Time Better
7. Stop Putting Things Off
8. Get My Home Organized
9. Build Routines That Work for Me
10. Feel More Like Myself

Routing contracts:

- Confidence ↔ Self-Trust
- Time ↔ Procrastination
- Home ↔ Routines

## Record model

The existing `goals`, `original_action_plans`, `live_action_plans`, `current_steps`, `update_history`, `engine_runs`, and isolated batch-lab records remain useful foundations. The Locked v1 implementation adds or expands the following logical records.

| Record | Purpose | Mutability |
| --- | --- | --- |
| `future_you_contract_versions` | Approved configuration/version registry | Append-only |
| `goal_contract_bindings` | Contract versions governing a goal | Append-only |
| `intake_instances` | One initial or Change Path intake per goal | State changes allowed; never merges histories |
| `intake_events` | Raw answer/import/correction events | Append-only |
| `intake_facts` | Current normalized facts derived from events | Current representation; provenance required |
| `intake_requirements` | Essential/conditional/optional/learn-later needs | Current resolution state with provenance |
| `intake_uncertainties` | Contradictions, staleness, and unresolved facts | Current representation with event links |
| `route_candidate_evidence` | Route/causal-owner candidate support | Append-only evidence links |
| `canonical_evidence` | Reusable evidence identity and quality/context | Append-only |
| `evidence_applications` | A justified use of evidence by one construct | Append-only |
| `progression_l3_state` | Current user-specific topic state, confidence, priority, uncertainty, and next evidence target | Current state plus audit trail |
| `change_path_links` | Links a re-entry intake to its existing goal/path | Append-only |

## Runtime flow

```text
Goal
→ Source requirements
→ I1 universal information
→ I2 active topic specification
→ I3 user-specific intake state
→ source derivation + validation
→ Original Plan + initial Live Plan + L3 seed
→ Today’s Step
→ user update/evidence
→ L1 evidence normalization
→ L2 topic interpretation
→ L3 current state and next evidence target
→ topic expert proposal
→ Continue / Build / Ease / Switch
→ future-only Live Plan rewrite
→ validation
→ next Today’s Step
```

## Service boundaries

The old single Edge Function is archived as the baseline. Locked v1 will separate responsibilities so each is testable:

| Service | Responsibility |
| --- | --- |
| Intake orchestrator | Chooses the next information target and writes I3 records. |
| Source derivation | Produces route, readiness, safety, feasibility, capacity, and initial plan inputs. |
| Action Plan engine | Creates Original/Live Plans and rewrites future-only plan content. |
| Evidence normalizer | Converts interactions into canonical evidence without double-counting. |
| Topic interpreter | Applies Level 2 topic and routing rules to evidence. |
| L3 state service | Maintains current user-specific progression state and next evidence target. |
| Update service | Generates contextual visible options, saves an update, and requests a valid adjustment. |
| Validator | Blocks unsafe, unrealistic, guardrail-breaking, or unsupported drafts. |
| Simulator | Runs isolated scenarios and records only test evidence. |

## Implemented protected API flow

The `future-you-locked` Edge Function requires an authenticated, active tester. The Flutter client sends only the operation payload and its user JWT; all database writes use the server-only service role.

The complete callable operation allow-list is maintained in `supabase/functions/future-you-locked/operation-contract.ts` and covered by a unit test, so an implementation change cannot silently leave the API error contract behind.

1. `start_intake` → creates the goal, bindings, immutable first fact, and topic requirements.
2. `intake_state` / `record_intake_answer` / `intake_readiness` → completes only active, decision-relevant requirements.
3. `source_handoff_preview` / `derive_source_handoff` / `validate_source_handoff` / `freeze_source_handoff` → optionally derives a non-persisted, fact-cited draft, then validates and freezes I3 once.
4. `derive_initial_plan` → produces a non-persisted OpenAI draft from the frozen handoff; `validate_initial_plan` checks it.
5. `approve_initial_plan` → saves immutable Original Plan, Live Plan revision 1, and an L3 seed.
6. `record_evidence` / `evidence_state` → preserves user evidence and its applications.
7. `progression_assessment_state` → reads the signed-in owner's current L3 state plus its append-only assessment history.
8. `change_path_state` / `change_path_handoff_context` → read the signed-in owner's linked Change Path history and its prior frozen-source reference plus separate re-entry facts. A Change Path cannot merge histories or create another Original Plan.
9. `derive_progression_assessment` → sends only the signed-in goal's current L3 state and canonical evidence to the server-side model and returns a non-persisted, locally validated assessment draft. It cannot write Level 3 state or either plan.
10. `validate_progression_assessment` → checks that an L3 interpretation cites only this goal's evidence, preserves uncertainty, uses the locked topic's controlled units, and makes only a plan recommendation.
11. `apply_progression_assessment` → writes an append-only L3 assessment plus a new L3 state revision. It cannot change either plan.
12. `today_step` / `progress_update_options` → reads the current Live Plan and returns one step plus three step-specific visible choices that normalize internally to Completed, Partly Completed, or Not Today.
13. `record_progress_update` → atomically saves the immutable raw update and its canonical evidence before any adjustment. A client update ID makes retries idempotent.
14. `progress_update_state` → reads the append-only update and adjustment ledgers for the signed-in owner.
15. `derive_live_plan_revision` → sends the signed-in user's frozen source, current Live Plan, recorded Progress Update, and applied L3 assessment to the server-side model. It returns a locally validated, non-persisted future-only revision draft.
16. `revise_live_plan` → requires the saved Progress Update and its current, evidence-citing L3 assessment. Its outcome must match the assessment, all five validation checks must pass, and the completed portion must remain structurally identical. When a validated Change Path is supplied, its committed status changes in the same transaction.
17. `plan_state` → reads Original Plan, current Live Plan, and L3 state for the signed-in owner.

The topic interpreter has controlled schemas for all ten locked topics. A submitted assessment cannot invent a named unit in these systems: Relationships, Communication, Boundaries, Confidence, Self-Trust, Time, Procrastination, Home Organization, Routines, or Feel More Like Myself. Confidence is context-by-dimension, and Feel More Like Myself retains its separate State and Identity routes.

## Deferred sensitive-context integrations

Journal entries, messages, and meditation recommendations are not part of Locked v1 and must not be silently read by the current engine. When introduced, each integration must remain server-controlled and satisfy all of the following:

- Obtain separate, revocable user consent for each data category and each purpose; Future You planning does not imply consent to read journals or messages.
- Retrieve only the minimum selected context needed for a specific recommendation or assessment; do not add ambient or background collection.
- Normalize permitted source material into provenance-bearing evidence or a bounded server-side summary before any derivation. Do not pass a whole journal or message history to a model.
- Keep recommendation catalog data separate from personal evidence. A meditation recommendation is a recommendation, not proof of a user state.
- Show the user what category was used, why it was used, and how to revoke access. Record consent and retrieval events separately from immutable Future You progress records.
- Add an explicit protected Edge Function operation and tests before enabling any new source. Direct browser access to Locked v1 ledgers remains prohibited.

For an end-to-end test, use one signed-in tester, begin with `build_routines_that_work`, complete all listed requirements, then run the operations in the order above. Capture a Progress Update from server-generated choices, validate a progression assessment that cites the returned evidence ID, apply it with the current L3 revision, and revise the Live Plan using both saved record IDs. Verify that an outcome mismatch, a failing validation check, a completed-history change, a stale assessment revision, and a stale Live Plan revision are rejected. Also verify an unauthenticated request receives `401` and another user cannot read the goal.

## Migration principles

- Do not delete the old simulator tables or test evidence in the first migration.
- Do not modify completed history or Original Plans.
- Do not migrate production user data into simulator cases.
- All new exposed tables require Row Level Security and ownership policies.
- No browser/client receives a Supabase secret or service-role key.
- Every database migration and Edge Function source change must be committed to this repository before deployment.

## Acceptance gates before app screens

1. Intake correctly reuses known facts and asks only decision-relevant questions.
2. All ten topics and three routing relationships have versioned configuration bindings.
3. The engine can create an immutable Original Plan, valid Live Plan, L3 seed, and Today’s Step.
4. Updates preserve history and rewrite future only after validation.
5. The simulator passes the locked action-plan, routing, evidence, state-movement, Change Path, and cross-goal tests.
6. RLS tests prove a tester cannot read or change another tester’s records.
