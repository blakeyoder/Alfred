import { tool } from "ai";
import { z } from "zod";
import {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  findFreeTime,
  type CalendarEvent,
} from "../../integrations/google-calendar.js";
import { hasGoogleAuth } from "../../integrations/google-auth.js";
import { getSharedCalendarId } from "../../db/queries/couples.js";
import { storeToolContextMemories } from "../../integrations/mem0-provider.js";
import type { ToolContext } from "./reminders.js";

const DEFAULT_TIMEZONE = "America/New_York";

const getCalendarEventsSchema = z.object({
  startDate: z.iso.date().describe("Start date (YYYY-MM-DD)"),
  endDate: z.iso.date().describe("End date (YYYY-MM-DD)"),
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

const createCalendarEventSchema = z
  .object({
    title: z.string().describe("Event title/summary"),
    allDay: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether this is an all-day event (no specific times)"),
    startDate: z.iso
      .date()
      .optional()
      .describe("Start date for all-day events (YYYY-MM-DD)"),
    endDate: z.iso
      .date()
      .optional()
      .describe(
        "End date for all-day events (YYYY-MM-DD, exclusive - use the day after the last day)"
      ),
    startTime: z.iso
      .datetime()
      .optional()
      .describe(
        "Start time for timed events. MUST be Eastern Time with offset, e.g. 2024-01-15T14:00:00-05:00 (EST) or -04:00 (EDT)"
      ),
    endTime: z.iso
      .datetime()
      .optional()
      .describe(
        "End time for timed events. MUST be Eastern Time with offset, e.g. 2024-01-15T15:00:00-05:00 (EST) or -04:00 (EDT)"
      ),
    description: z.string().optional().describe("Event description"),
    location: z.string().optional().describe("Event location"),
    whose: z
      .enum(["me", "partner", "both", "shared"])
      .optional()
      .default("shared")
      .describe(
        "Where to add the event: 'shared' (default) uses the couple's shared calendar, 'me'/'partner'/'both' adds to individual calendars"
      ),
  })
  .refine(
    (data) => {
      if (data.allDay) {
        return data.startDate && data.endDate;
      }
      return data.startTime && data.endTime;
    },
    {
      message:
        "All-day events require startDate and endDate; timed events require startTime and endTime",
    }
  );

const updateCalendarEventSchema = z.object({
  eventId: z
    .string()
    .describe("The event ID to update (from getCalendarEvents)"),
  title: z.string().optional().describe("New event title/summary"),
  startTime: z.iso
    .datetime()
    .optional()
    .describe(
      "New start time. MUST be Eastern Time with offset, e.g. 2024-01-15T14:00:00-05:00"
    ),
  endTime: z.iso
    .datetime()
    .optional()
    .describe(
      "New end time. MUST be Eastern Time with offset, e.g. 2024-01-15T15:00:00-05:00"
    ),
  description: z.string().optional().describe("New event description"),
  location: z.string().optional().describe("New event location"),
});

const deleteCalendarEventSchema = z.object({
  eventId: z
    .string()
    .describe("The event ID to delete (from getCalendarEvents)"),
});

/**
 * Format a CalendarEvent for LLM consumption with ID and structured data.
 */
function formatEventForLLM(event: CalendarEvent): {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
} {
  const formatTime = (dt?: string, d?: string): string => {
    if (dt) {
      return new Date(dt).toLocaleString("en-US", {
        timeZone: DEFAULT_TIMEZONE,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
    return d ?? "";
  };

  return {
    id: event.id,
    summary: event.summary,
    start: formatTime(event.start.dateTime, event.start.date),
    end: formatTime(event.end.dateTime, event.end.date),
    ...(event.location && { location: event.location }),
    ...(event.description && { description: event.description }),
  };
}

/**
 * Store calendar event context for memory extraction.
 * Passes raw event context to mem0 and lets its LLM decide what's memorable
 * based on the includes/excludes/custom_instructions configuration.
 */
async function storeCalendarEventContext(
  title: string,
  ctx: ToolContext
): Promise<void> {
  try {
    await storeToolContextMemories(
      `Created calendar event: "${title}"`,
      ctx.session.coupleId,
      {
        user_id: ctx.session.userId,
        source_thread_id: ctx.session.threadId,
        source_visibility: ctx.session.visibility,
      }
    );
  } catch (error) {
    console.error("[calendar] Failed to store event context:", error);
  }
}

export function createCalendarTools(
  ctx: ToolContext,
  partnerId: string | null
) {
  return {
    getCalendarEvents: tool({
      description:
        "Get calendar events in a date range from the shared couple calendar",
      inputSchema: getCalendarEventsSchema,
      execute: async ({ startDate, endDate }) => {
        // Get the shared calendar ID for the couple
        const sharedCalendarId = await getSharedCalendarId(
          ctx.session.coupleId
        );

        if (!sharedCalendarId) {
          return {
            success: false,
            message:
              "No shared calendar configured. Use /calendar list to see available calendars and /calendar set <id> to set one.",
            events: [],
          };
        }

        const hasAuth = await hasGoogleAuth(ctx.session.userId);
        if (!hasAuth) {
          return {
            success: false,
            message:
              "You need to connect Google Calendar first. Use /auth to connect.",
            events: [],
          };
        }

        try {
          const events = await getEvents(
            ctx.session.userId,
            startDate,
            endDate,
            sharedCalendarId
          );

          return {
            success: true,
            dateRange: { startDate, endDate },
            totalEvents: events.length,
            events: events.map(formatEventForLLM),
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Failed to fetch events",
            events: [],
          };
        }
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
          if (!hasAuth2)
            missing.push(ctx.session.partnerName ?? "Your partner");

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
              error instanceof Error
                ? error.message
                : "Failed to find free time",
            freeSlots: [],
          };
        }
      },
    }),

    createCalendarEvent: tool({
      description:
        "Create a calendar event. All times are Eastern Time (America/New_York). " +
        "For timed events, use ISO format with Eastern offset: -05:00 (EST winter) or -04:00 (EDT summer). " +
        "Example: 2pm on Jan 15 = 2024-01-15T14:00:00-05:00",
      inputSchema: createCalendarEventSchema,
      execute: async ({
        title,
        allDay,
        startDate,
        endDate,
        startTime,
        endTime,
        description,
        location,
        whose = "shared",
      }) => {
        // Build the event input based on whether it's all-day or timed
        const eventInput = allDay
          ? {
              allDay: true as const,
              summary: title,
              description,
              startDate: startDate!,
              endDate: endDate!,
              location,
            }
          : {
              allDay: false as const,
              summary: title,
              description,
              startTime: startTime!,
              endTime: endTime!,
              location,
            };

        // Handle shared calendar case
        if (whose === "shared") {
          const sharedCalendarId = await getSharedCalendarId(
            ctx.session.coupleId
          );

          if (!sharedCalendarId) {
            return {
              success: false,
              message:
                "No shared calendar configured. Use /calendar list to see available calendars and /calendar set <id> to set one.",
              results: [],
            };
          }

          const hasAuth = await hasGoogleAuth(ctx.session.userId);
          if (!hasAuth) {
            return {
              success: false,
              message:
                "You need to connect Google Calendar first. Use /auth google to connect.",
              results: [],
            };
          }

          try {
            const event = await createEvent(
              ctx.session.userId,
              eventInput,
              sharedCalendarId
            );

            // Store event context for memory extraction (fire and forget)
            storeCalendarEventContext(title, ctx);

            return {
              success: true,
              message: `Added "${title}" to shared calendar`,
              results: [
                {
                  user: "shared",
                  success: true,
                  message: `Added "${title}" to shared calendar`,
                  eventId: event.id,
                },
              ],
            };
          } catch (error) {
            return {
              success: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to create event",
              results: [
                {
                  user: "shared",
                  success: false,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Failed to create event",
                },
              ],
            };
          }
        }

        // Handle individual calendar cases (me, partner, both)
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
            const event = await createEvent(userId, eventInput);

            // Store event context for memory extraction (fire and forget, only for current user)
            if (isCurrentUser) {
              storeCalendarEventContext(title, ctx);
            }

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

    updateCalendarEvent: tool({
      description:
        "Update an existing calendar event. Use getCalendarEvents first to get the event ID. " +
        "Only provide the fields you want to change.",
      inputSchema: updateCalendarEventSchema,
      execute: async ({
        eventId,
        title,
        startTime,
        endTime,
        description,
        location,
      }) => {
        const sharedCalendarId = await getSharedCalendarId(
          ctx.session.coupleId
        );

        if (!sharedCalendarId) {
          return {
            success: false,
            message:
              "No shared calendar configured. Use /calendar list to see available calendars and /calendar set <id> to set one.",
          };
        }

        const hasAuth = await hasGoogleAuth(ctx.session.userId);
        if (!hasAuth) {
          return {
            success: false,
            message:
              "You need to connect Google Calendar first. Use /auth to connect.",
          };
        }

        try {
          const updates = {
            ...(title && { summary: title }),
            ...(description !== undefined && { description }),
            ...(location !== undefined && { location }),
            ...(startTime && { startTime }),
            ...(endTime && { endTime }),
          };

          const updatedEvent = await updateEvent(
            ctx.session.userId,
            eventId,
            updates,
            sharedCalendarId
          );

          return {
            success: true,
            message: `Updated event "${updatedEvent.summary}"`,
            event: formatEventForLLM(updatedEvent),
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Failed to update event",
          };
        }
      },
    }),

    deleteCalendarEvent: tool({
      description:
        "Delete a calendar event. Use getCalendarEvents first to get the event ID.",
      inputSchema: deleteCalendarEventSchema,
      execute: async ({ eventId }) => {
        const sharedCalendarId = await getSharedCalendarId(
          ctx.session.coupleId
        );

        if (!sharedCalendarId) {
          return {
            success: false,
            message:
              "No shared calendar configured. Use /calendar list to see available calendars and /calendar set <id> to set one.",
          };
        }

        const hasAuth = await hasGoogleAuth(ctx.session.userId);
        if (!hasAuth) {
          return {
            success: false,
            message:
              "You need to connect Google Calendar first. Use /auth to connect.",
          };
        }

        try {
          await deleteEvent(ctx.session.userId, eventId, sharedCalendarId);

          return {
            success: true,
            message: "Event deleted successfully",
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Failed to delete event",
          };
        }
      },
    }),
  };
}
