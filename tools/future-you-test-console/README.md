# Future You Test Console

This is a local-only tester interface for the deployed `future-you-locked` Supabase Edge Function. It is separate from, and does not modify, the Firebase application.

## Run locally

Use the bundled Deno runtime:

```powershell
$deno = 'C:\Users\rashe\AppData\Local\Temp\resora-future-you-deno\deno.exe'
& $deno run --allow-net --allow-read .\tools\serve-future-you-test-console.ts
```

Open `http://localhost:8787` in the same browser used to open the email magic link.

## Tester flow

1. Enter an existing active tester email and choose **Send sign-in link**.
2. Open the one-time Supabase email link in the same browser.
3. Return to the console and confirm the session shows the tester email.
4. Begin with **Check backend contract**, then use the staged steps in `docs/FUTURE_YOU_LOCKED_V1_OPERATOR_RUNBOOK.md`.

The browser uses only the Supabase publishable key. The Supabase server role and OpenAI key remain server-side and are never included in this console.
