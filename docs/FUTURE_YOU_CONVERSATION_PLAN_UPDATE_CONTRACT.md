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

## 4. Weekly review

Daily updates answer a narrow question about Today’s Step. Once each week, the
user can begin a longer weekly review. It is an intentional appointment, not a
background data collection job and not a second plan intake.

The weekly review reads only this goal’s recorded daily Progress Updates from
the previous seven days and the answers already given in this weekly review.
It asks between three and five adaptive questions across these bounded review
areas:

- What the week actually looked like.
- A concrete follow-up on a recorded pattern, especially a repeated difficulty.
- What made the hard moment harder or easier.
- Whether the current plan fit the person’s real circumstances.
- What should be different, if anything, in the coming week.

The server supplies the allowed review areas. The model can choose the most
useful unresolved area and write direct wording/options, but cannot invent a
new area, repeat an answered area, save an answer, or decide that a plan has
changed. When the daily records show a real pattern, the question should name
the recorded pattern plainly—for example, “Last week, you marked speaking up
as difficult twice. What happened when you tried it this week?” It must not
claim a cause that the record does not support.

Each answer is saved as canonical `check_in` evidence only after Continue.
Completing the review requires at least three answers and creates an explicit
completion record. The evidence may be considered by the existing Level 3
assessment and future-only Live Plan revision flow; it never edits the
immutable Original Plan or completed history.

## Acceptance checks

- Multi-select choices remain selected until Continue and are saved as an array.
- A known answer is never requested again.
- A safety, power, deadline, access, or feasibility fact can move ahead of ordinary questions.
- An incomplete intake cannot create a Source or action plan.
- Drafts never save themselves.
- One successful test journey reaches a saved plan, an update, an assessment, and a future-only revision.
- A weekly review reflects recorded daily updates, keeps its questions distinct,
  and cannot finish with fewer than three saved answers.
- Negative tests prove stale revisions, invented evidence, and changed completed history are rejected.
