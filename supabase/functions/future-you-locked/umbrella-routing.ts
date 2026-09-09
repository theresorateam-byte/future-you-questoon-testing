/** User-facing entries that must select an internal owner before plan intake. */
export const UMBRELLA_ENTRIES = {
  get_more_done: {
    label: "Get More Done",
    initialKey: "more_done_route",
    defaultTopic: "manage_my_time_better",
    question: "Which part is getting in the way most right now?",
    whyThisMatters: "This tells Future You whether to work on the time system or the pattern of not starting.",
    options: [
      { id: "time", label: "My time is too full or not organized" },
      { id: "procrastination", label: "I have time, but I keep not starting" },
      { id: "both", label: "Both are getting in the way" },
      { id: "other", label: "Something else" },
    ],
    routes: { time: "manage_my_time_better", procrastination: "stop_putting_things_off", both: "manage_my_time_better", other: "manage_my_time_better" },
  },
  get_daily_life_in_order: {
    label: "Get Daily Life in Order",
    initialKey: "daily_life_route",
    defaultTopic: "get_my_home_organized",
    question: "Which part of daily life needs the most help right now?",
    whyThisMatters: "This tells Future You whether the main issue is the setup around you or the routine itself.",
    options: [
      { id: "home", label: "My space or household setup makes things harder" },
      { id: "routines", label: "The setup works, but I cannot keep a routine going" },
      { id: "both", label: "Both are getting in the way" },
      { id: "other", label: "Something else" },
    ],
    routes: { home: "get_my_home_organized", routines: "build_routines_that_work", both: "get_my_home_organized", other: "get_my_home_organized" },
  },
} as const;

export type UmbrellaEntryKey = keyof typeof UMBRELLA_ENTRIES;

export function umbrellaEntry(key: string) {
  return UMBRELLA_ENTRIES[key as UmbrellaEntryKey] ?? null;
}

export function umbrellaQuestionForTarget(key: string) {
  const entry = Object.values(UMBRELLA_ENTRIES).find((item) => item.initialKey === key);
  if (!entry) return null;
  return { informationKey: entry.initialKey, question: entry.question, control: "single_select", options: entry.options, whyThisMatters: entry.whyThisMatters };
}

/** Uses the recorded card selection. A tie follows the locked intake tiebreaker. */
export function routeUmbrellaAnswer(entryKey: string, rawValue: Record<string, unknown>) {
  const entry = umbrellaEntry(entryKey);
  if (!entry) return null;
  const ids = Array.isArray(rawValue.selectedOptionIds) ? rawValue.selectedOptionIds.map(String) : [];
  const selected = ids.find((id) => id in entry.routes) ?? "other";
  return entry.routes[selected as keyof typeof entry.routes] ?? entry.defaultTopic;
}
