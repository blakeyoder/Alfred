import { tool } from "ai";
import { z } from "zod";
import {
  createReminder,
  getReminders,
  completeReminder,
  getReminderById,
  type ReminderFilter,
} from "../../db/queries/reminders.js";
import type { SessionContext } from "../system-prompt.js";

export interface ToolContext {
  session: SessionContext;
}

function resolveAssignee(
  who: "me" | "partner" | "both" | undefined,
  ctx: ToolContext,
  partnerId: string | null
): string | undefined {
  if (!who || who === "both") return undefined;
  if (who === "me") return ctx.session.userId;
  if (who === "partner" && partnerId) return partnerId;
  return undefined;
}

const createReminderSchema = z.object({
  title: z.string().describe("What to remember"),
  dueAt: z.iso.datetime().optional().describe("ISO datetime when due (e.g., 2024-01-15T14:00:00Z)"),
  assignedTo: z.enum(["me", "partner", "both"]).optional().describe("Who the reminder is for"),
  notes: z.string().optional().describe("Additional notes"),
});

const listRemindersSchema = z.object({
  filter: z
    .enum(["upcoming", "overdue", "all", "completed"])
    .optional()
    .describe("Which reminders to show"),
  assignedTo: z
    .enum(["me", "partner", "both"])
    .optional()
    .describe("Filter by who the reminder is assigned to"),
});

const completeReminderSchema = z.object({
  reminderId: z.string().describe("ID of the reminder to complete"),
});

export function createReminderTools(ctx: ToolContext, partnerId: string | null) {
  return {
    createReminder: tool({
      description: "Create a reminder for one or both partners",
      inputSchema: createReminderSchema,
      execute: async ({ title, dueAt, assignedTo, notes }) => {
        const assignee = resolveAssignee(assignedTo, ctx, partnerId);

        const reminder = await createReminder(ctx.session.coupleId, title, ctx.session.userId, {
          notes,
          dueAt: dueAt ? new Date(dueAt) : undefined,
          assignedTo: assignee,
        });

        const assignedToText = assignedTo
          ? assignedTo === "me"
            ? "you"
            : assignedTo === "partner"
              ? (ctx.session.partnerName ?? "your partner")
              : "both of you"
          : "both of you";

        return {
          success: true,
          message: `Created reminder "${title}" for ${assignedToText}`,
          reminder: {
            id: reminder.id,
            title: reminder.title,
            dueAt: reminder.due_at?.toISOString() ?? null,
          },
        };
      },
    }),

    listReminders: tool({
      description: "List upcoming, overdue, or all reminders",
      inputSchema: listRemindersSchema,
      execute: async ({ filter = "all", assignedTo }) => {
        const assignee = resolveAssignee(assignedTo, ctx, partnerId);
        const reminders = await getReminders(
          ctx.session.coupleId,
          filter as ReminderFilter,
          assignee
        );

        if (reminders.length === 0) {
          return {
            count: 0,
            message: "No reminders found matching your criteria.",
            reminders: [],
          };
        }

        return {
          count: reminders.length,
          reminders: reminders.map((r) => ({
            id: r.id,
            title: r.title,
            dueAt: r.due_at?.toISOString() ?? null,
            notes: r.notes,
            completed: r.completed_at !== null,
            assignedTo: r.assigned_to
              ? r.assigned_to === ctx.session.userId
                ? "you"
                : (ctx.session.partnerName ?? "partner")
              : "both",
          })),
        };
      },
    }),

    completeReminder: tool({
      description: "Mark a reminder as complete",
      inputSchema: completeReminderSchema,
      execute: async ({ reminderId }) => {
        const existing = await getReminderById(reminderId);
        if (!existing) {
          return {
            success: false,
            message: "Reminder not found.",
          };
        }

        if (existing.couple_id !== ctx.session.coupleId) {
          return {
            success: false,
            message: "Reminder not found.",
          };
        }

        if (existing.completed_at) {
          return {
            success: false,
            message: `"${existing.title}" is already completed.`,
          };
        }

        await completeReminder(reminderId);

        return {
          success: true,
          message: `Marked "${existing.title}" as complete!`,
        };
      },
    }),
  };
}
