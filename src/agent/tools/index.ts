import { createReminderTools, type ToolContext } from "./reminders.js";
import { createCalendarTools } from "./calendar.js";
import { createWebSearchTools } from "./web-search.js";
import { createReservationTools } from "./reservations.js";

export function createTools(ctx: ToolContext, partnerId: string | null) {
  return {
    ...createReminderTools(ctx, partnerId),
    ...createCalendarTools(ctx, partnerId),
    ...createWebSearchTools(ctx, partnerId),
    ...createReservationTools(ctx, partnerId),
  };
}
