import { assertEquals } from "jsr:@std/assert@1.0.19";
import { routeUmbrellaAnswer, umbrellaQuestionForTarget } from "../future-you-locked/umbrella-routing.ts";

Deno.test("Get More Done keeps Time and Putting Things Off behind one entry", () => {
  assertEquals(routeUmbrellaAnswer("get_more_done", { selectedOptionIds: ["time"] }), "manage_my_time_better");
  assertEquals(routeUmbrellaAnswer("get_more_done", { selectedOptionIds: ["procrastination"] }), "stop_putting_things_off");
  // Locked intake tie: test opportunity/time before concluding unnecessary delay.
  assertEquals(routeUmbrellaAnswer("get_more_done", { selectedOptionIds: ["both"] }), "manage_my_time_better");
});

Deno.test("Get Daily Life in Order keeps Home and Routines behind one entry", () => {
  assertEquals(routeUmbrellaAnswer("get_daily_life_in_order", { selectedOptionIds: ["home"] }), "get_my_home_organized");
  assertEquals(routeUmbrellaAnswer("get_daily_life_in_order", { selectedOptionIds: ["routines"] }), "build_routines_that_work");
  // Locked intake tie: test environment friction before demanding behavior change.
  assertEquals(routeUmbrellaAnswer("get_daily_life_in_order", { selectedOptionIds: ["both"] }), "get_my_home_organized");
  assertEquals(umbrellaQuestionForTarget("daily_life_route")?.control, "single_select");
});
