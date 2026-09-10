import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { deriveIntakeQuestion } from "../future-you-locked/intake-question-deriver.ts";

Deno.test("Safety targets use a natural context probe instead of a blunt safety question", async () => {
  const result = await deriveIntakeQuestion({ goalText: "Set a limit with a family member.", target: { key: "boundary_safety_power" }, facts: [], safetyIdentifier: "test" });
  const question = result.question as { control: string; question: string; options: unknown[] };
  assertEquals(question.control, "single_select");
  assertStringIncludes(question.question, "What usually happens");
  assertEquals(question.question.includes("safe to speak"), false);
  assertEquals(question.options.length, 4);
});
