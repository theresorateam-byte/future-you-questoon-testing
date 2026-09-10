import { assertEquals } from "jsr:@std/assert@1.0.19";
import { BATCH_LAB_ENTRIES } from "../future-you-locked/batch-lab.ts";

Deno.test("Synthetic batch lab covers exactly the seven user-facing entries", () => {
  assertEquals(BATCH_LAB_ENTRIES.length, 7);
  assertEquals(BATCH_LAB_ENTRIES.includes("get_more_done"), true);
  assertEquals(BATCH_LAB_ENTRIES.includes("get_daily_life_in_order"), true);
  assertEquals(BATCH_LAB_ENTRIES.includes("manage_my_time_better" as never), false);
  assertEquals(BATCH_LAB_ENTRIES.includes("build_routines_that_work" as never), false);
});
