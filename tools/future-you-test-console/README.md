# Future You Test Lab

This is a local-only tester interface for the deployed `future-you-locked` Supabase Edge Function. It is separate from, and does not modify, the Firebase application.

## Run locally

Use the bundled Deno runtime:

```powershell
$deno = 'C:\Users\rashe\AppData\Local\Temp\resora-future-you-deno\deno.exe'
& $deno run --allow-net --allow-read .\tools\serve-future-you-test-console.ts
```

Open `http://localhost:8787` in the same browser used to open the email magic link.

## Guided tester flow

1. Enter an existing active tester email and choose **Send sign-in link**.
2. Open the one-time Supabase email link in the same browser.
3. Return to the Test Lab and confirm the session shows the tester email.
4. In **Guided product test**, select one of the ten approved goal areas, adjust the test goal if needed, and begin an intake.
5. Answer each decision-relevant question. The test lab sends each answer only to the authenticated Locked v1 endpoint.
6. When questions are complete, inspect the non-persisted AI Source draft. It must be explicitly accepted before a draft action plan can be generated.
7. Inspect the non-persisted AI action-plan draft. Approve it only when you want to exercise the saved-plan stage.
8. Use the technical console below the lab only to diagnose a problem or to follow the advanced Progress Update and Change Path checks in `docs/FUTURE_YOU_LOCKED_V1_OPERATOR_RUNBOOK.md`.

The lab deliberately separates product quality testing from backend plumbing: green technical results alone are not acceptance evidence. Testers should review the question sequence, each AI draft's cited reasoning, and the plan's realism before approving it.

The browser uses only the Supabase publishable key. The Supabase server role and OpenAI key remain server-side and are never included in this console.
