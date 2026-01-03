import { createReminderTools, ToolContext } from "./reminders.js";
import { createCalendarTools } from "./calendar.js";

export function createTools(ctx: ToolContext, partnerId: string | null) {
  return {
    ...createReminderTools(ctx, partnerId),
    ...createCalendarTools(ctx, partnerId),
  };
}

export type { ToolContext } from "./reminders.js";
