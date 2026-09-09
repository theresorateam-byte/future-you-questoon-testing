# Future You conversation, plan, and update contract

Status: implementation contract for the Supabase-only Test Lab. Firebase is out of scope.

## 1. Adaptive conversation

After every answer, the server reads the signed-in tester's goal, current intake facts, unresolved requirements, and current topic. It returns one non-persisted next-question draft.

The draft may choose one of three outcomes:

- `ask`: ask one current, decision-relevant question.
- `ready_for_source`: no active information need remains; offer the Source draft.
- `offer_related_topic`: explain a relevant related route without changing the goal automatically.

The model may write plain-language question wording, response controls, and answer options. It may not create facts, mark a requirement complete, skip a required item, change a topic, create a plan, or save an answer. The server validates that the chosen target is unresolved and allowed for the goal before returning it.

## 2. Plan completion

The Test Lab must show these distinct stages:

1. Intake complete.
2. AI Source draft—reviewable and not saved.
3. Source accepted—saved once after validation.
4. AI action-plan draft—reviewable and not saved.
5. Action plan accepted—creates immutable Original Plan, Live Plan revision 1, Level 3 seed, and Today’s Step.

Each stage must show a readable status and an actionable error. A failure must never leave the tester guessing whether a draft was saved.

## 3. Update and revision path

After an accepted plan, the Test Lab reads Today’s Step and server-generated update choices. A tester selects choices, presses Continue, and then sees:

1. The saved update and normalized state.
2. The canonical evidence created from the update.
3. A non-persisted Level 3 assessment draft.
4. The applied Level 3 assessment and current state.
5. A non-persisted future-only Live Plan revision draft.
6. A before/after view and explicit acceptance of the revision.

Original Plan and completed history must remain unchanged throughout.

## Acceptance checks

- Multi-select choices remain selected until Continue and are saved as an array.
- A known answer is never requested again.
- A safety, power, deadline, access, or feasibility fact can move ahead of ordinary questions.
- An incomplete intake cannot create a Source or action plan.
- Drafts never save themselves.
- One successful test journey reaches a saved plan, an update, an assessment, and a future-only revision.
- Negative tests prove stale revisions, invented evidence, and changed completed history are rejected.
