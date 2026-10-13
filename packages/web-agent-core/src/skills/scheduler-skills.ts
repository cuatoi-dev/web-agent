import type { SkillDef } from "../tools/skill-def.types.js";

export function schedulerSkills(): SkillDef[] {
  return [
    {
      name: "schedule",
      description: "Repeat a task, or remind me once",
      definition:
        "The user wants to schedule repeated work. Use set_schedule.\n" +
        "Ask for anything you still need: what to run, how often, and how many times. If they described a one-off reminder, use repeat 1.\n" +
        "Tell them the schedule lasts only for this chat session.",
      command: true,
      disableModelInvocation: true,
    },
    {
      name: "schedule-list",
      description: "Show what is pending",
      definition:
        "Call list_schedules and show the result as a table with columns:\n" +
        "name, kind, how often it fires, what it sends, runs, and state.\n" +
        "If nothing is scheduled, say so in one line.",
      command: true,
      disableModelInvocation: true,
    },
    {
      name: "schedule-cancel",
      description: "Cancel one by name",
      definition:
        "The user wants to cancel a schedule. If they did not name one, call list_schedules first and ask which. Then call cancel_schedule.",
      command: true,
      disableModelInvocation: true,
    },
  ];
}
