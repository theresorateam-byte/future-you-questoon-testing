import { assert, assertEquals } from "jsr:@std/assert@1";
import { validateSourceHandoffDraft } from "../future-you-locked/source-contract.ts";

const factKeys = ["routine_target", "routine_dose_window", "routine_time_energy_access_fit"];
const cited = (value: string, factKey = "routine_target") => ({ value, factKeys: [factKey] });

Deno.test("Locked Source contract accepts an evidence-cited active handoff", () => {
  const result = validateSourceHandoffDraft({
    normalizedGoal: cited("Build a workable morning routine"),
    goalBucket: "rhythm",
    goalDomain: cited("routines"),
    routeBinding: cited("routines"),
    safety: cited("No safety concern identified"),
    realism: cited("A small morning window is available", "routine_dose_window"),
    entryGate: "active",
    goalGap: cited("The routine is not consistent"),
    capacity: cited("Low but usable capacity", "routine_time_energy_access_fit"),
    initialMode: "tiny_start",
    l3InitialState: { value: "not_started", factKeys: ["routine_target"], confidence: "provisional" },
    milestone: cited("Complete the routine twice this week"),
    firstTodayStep: cited("Lay out the materials tonight"),
    successMarkers: cited("Two completions"),
    guardrails: cited("Keep it under five minutes", "routine_dose_window"),
  }, factKeys);
  assert(result.valid);
  assertEquals(result.errors, []);
});

Deno.test("Locked Source contract refuses claims with invented citations", () => {
  const result = validateSourceHandoffDraft({
    normalizedGoal: cited("Build a workable morning routine", "invented_fact"),
  }, factKeys);
  assert(!result.valid);
  assert(result.errors.some((error) => error.code === "unsupported"));
});
