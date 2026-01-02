import { tool } from "ai";
import { z } from "zod";
import {
  getEvents,
  createEvent,
  findFreeTime,
  formatEvents,
} from "../../integrations/google-calendar.js";
import { hasGoogleAuth } from "../../integrations/google-auth.js";
import type { ToolContext } from "./reminders.js";

const getCalendarEventsSchema = z.object({
  startDate: z.iso.date().describe("Start date (YYYY-MM-DD)"),
  endDate: z.iso.date().describe("End date (YYYY-MM-DD)"),
  whose: z
    .enum(["me", "partner", "both"])
    .optional()
    .describe("Whose calendar to check"),
});

const findFreeTimeSchema = z.object({
  startDate: z.iso.date().describe("Start date (YYYY-MM-DD)"),
  endDate: z.iso.date().describe("End date (YYYY-MM-DD)"),
  minDurationMinutes: z
    .number()
    .optional()
    .default(60)
    .describe("Minimum duration in minutes"),
});

const createCalendarEventSchema = z.object({
  title: z.string().describe("Event title/summary"),
  startTime: z.iso.datetime().describe("Start time (ISO datetime)"),
  endTime: z.iso.datetime().describe("End time (ISO datetime)"),
  description: z.string().optional().describe("Event description"),
  location: z.string().optional().describe("Event location"),
  whose: z
    .enum(["me", "partner", "both"])
    .optional()
    .describe("Whose calendar to add the event to"),
});

export function createCalendarTools(
  ctx: ToolContext,
  partnerId: string | null
) {
  return {
    getCalendarEvents: tool({
      description: "Get calendar events in a date range",
      inputSchema: getCalendarEventsSchema,
      execute: async ({ startDate, endDate, whose = "me" }) => {
        const userIds: string[] = [];

        if (whose === "me" || whose === "both") {
          userIds.push(ctx.session.userId);
        }
        if ((whose === "partner" || whose === "both") && partnerId) {
          userIds.push(partnerId);
        }

        const results: Array<{
          user: string;
          events: string[];
          error?: string;
        }> = [];

        for (const userId of userIds) {
          const isCurrentUser = userId === ctx.session.userId;
          const userName = isCurrentUser
            ? "Your"
            : `${ctx.session.partnerName ?? "Partner"}'s`;

          const hasAuth = await hasGoogleAuth(userId);
          if (!hasAuth) {
            results.push({
              user: userName,
              events: [],
              error: `${userName} Google Calendar is not connected.`,
            });
            continue;
          }

          try {
            const events = await getEvents(userId, startDate, endDate);
            results.push({
              user: userName,
              events: formatEvents(events),
            });
          } catch (error) {
            results.push({
              user: userName,
              events: [],
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to fetch events",
            });
          }
        }

        const totalEvents = results.reduce((sum, r) => sum + r.events.length, 0);

        return {
          dateRange: { startDate, endDate },
          totalEvents,
          results,
        };
      },
    }),

    findFreeTime: tool({
      description: "Find when both partners are free",
      inputSchema: findFreeTimeSchema,
      execute: async ({ startDate, endDate, minDurationMinutes = 60 }) => {
        if (!partnerId) {
          return {
            success: false,
            message: "No partner found to compare calendars with.",
            freeSlots: [],
          };
        }

        const [hasAuth1, hasAuth2] = await Promise.all([
          hasGoogleAuth(ctx.session.userId),
          hasGoogleAuth(partnerId),
        ]);

        if (!hasAuth1 || !hasAuth2) {
          const missing = [];
          if (!hasAuth1) missing.push("You");
          if (!hasAuth2) missing.push(ctx.session.partnerName ?? "Your partner");

          return {
            success: false,
            message: `${missing.join(" and ")} need to connect Google Calendar first.`,
            freeSlots: [],
          };
        }

        try {
          const freeSlots = await findFreeTime(
            ctx.session.userId,
            partnerId,
            startDate,
            endDate,
            minDurationMinutes
          );

          if (freeSlots.length === 0) {
            return {
              success: true,
              message: `No mutual free time found between ${startDate} and ${endDate} for at least ${minDurationMinutes} minutes.`,
              freeSlots: [],
            };
          }

          return {
            success: true,
            count: freeSlots.length,
            freeSlots: freeSlots.map((slot) => ({
              start: new Date(slot.start).toLocaleString(),
              end: new Date(slot.end).toLocaleString(),
              durationMinutes: slot.durationMinutes,
            })),
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Failed to find free time",
            freeSlots: [],
          };
        }
      },
    }),

    createCalendarEvent: tool({
      description: "Create a calendar event",
      inputSchema: createCalendarEventSchema,
      execute: async ({
        title,
        startTime,
        endTime,
        description,
        location,
        whose = "me",
      }) => {
        const userIds: string[] = [];

        if (whose === "me" || whose === "both") {
          userIds.push(ctx.session.userId);
        }
        if ((whose === "partner" || whose === "both") && partnerId) {
          userIds.push(partnerId);
        }

        const results: Array<{
          user: string;
          success: boolean;
          message: string;
          eventId?: string;
        }> = [];

        for (const userId of userIds) {
          const isCurrentUser = userId === ctx.session.userId;
          const userName = isCurrentUser
            ? "your"
            : `${ctx.session.partnerName ?? "partner"}'s`;

          const hasAuth = await hasGoogleAuth(userId);
          if (!hasAuth) {
            results.push({
              user: userName,
              success: false,
              message: `Cannot add to ${userName} calendar - not connected to Google.`,
            });
            continue;
          }

          try {
            const event = await createEvent(userId, {
              summary: title,
              description,
              startTime,
              endTime,
              location,
            });

            results.push({
              user: userName,
              success: true,
              message: `Added "${title}" to ${userName} calendar`,
              eventId: event.id,
            });
          } catch (error) {
            results.push({
              user: userName,
              success: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to create event",
            });
          }
        }

        const allSuccess = results.every((r) => r.success);
        const successCount = results.filter((r) => r.success).length;

        return {
          success: allSuccess,
          message:
            successCount > 0
              ? `Created ${successCount} event(s)`
              : "Failed to create any events",
          results,
        };
      },
    }),
  };
}
