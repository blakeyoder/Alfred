import { sql } from "../client.js";

export interface Reminder {
  id: string;
  couple_id: string;
  created_by: string | null;
  title: string;
  notes: string | null;
  due_at: Date | null;
  assigned_to: string | null;
  completed_at: Date | null;
  notified_at: Date | null;
  created_at: Date;
}

export type ReminderFilter = "upcoming" | "overdue" | "all" | "completed";

export async function getReminders(
  coupleId: string,
  filter: ReminderFilter = "all",
  assignedTo?: string | null
): Promise<Reminder[]> {
  const now = new Date();

  if (filter === "upcoming") {
    return sql<Reminder[]>`
      SELECT * FROM reminders
      WHERE couple_id = ${coupleId}
        AND completed_at IS NULL
        AND (due_at IS NULL OR due_at >= ${now})
        ${assignedTo !== undefined ? sql`AND (assigned_to IS NULL OR assigned_to = ${assignedTo})` : sql``}
      ORDER BY due_at ASC NULLS LAST
    `;
  }

  if (filter === "overdue") {
    return sql<Reminder[]>`
      SELECT * FROM reminders
      WHERE couple_id = ${coupleId}
        AND completed_at IS NULL
        AND due_at < ${now}
        ${assignedTo !== undefined ? sql`AND (assigned_to IS NULL OR assigned_to = ${assignedTo})` : sql``}
      ORDER BY due_at ASC
    `;
  }

  if (filter === "completed") {
    return sql<Reminder[]>`
      SELECT * FROM reminders
      WHERE couple_id = ${coupleId}
        AND completed_at IS NOT NULL
        ${assignedTo !== undefined ? sql`AND (assigned_to IS NULL OR assigned_to = ${assignedTo})` : sql``}
      ORDER BY completed_at DESC
      LIMIT 20
    `;
  }

  // all - incomplete reminders
  return sql<Reminder[]>`
    SELECT * FROM reminders
    WHERE couple_id = ${coupleId}
      AND completed_at IS NULL
      ${assignedTo !== undefined ? sql`AND (assigned_to IS NULL OR assigned_to = ${assignedTo})` : sql``}
    ORDER BY due_at ASC NULLS LAST
  `;
}

export async function getReminderById(id: string): Promise<Reminder | null> {
  const rows = await sql<Reminder[]>`
    SELECT * FROM reminders WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function createReminder(
  coupleId: string,
  title: string,
  createdBy: string,
  options: {
    notes?: string;
    dueAt?: Date;
    assignedTo?: string;
  } = {}
): Promise<Reminder> {
  const rows = await sql<Reminder[]>`
    INSERT INTO reminders (couple_id, title, created_by, notes, due_at, assigned_to)
    VALUES (
      ${coupleId},
      ${title},
      ${createdBy},
      ${options.notes ?? null},
      ${options.dueAt ?? null},
      ${options.assignedTo ?? null}
    )
    RETURNING *
  `;
  return rows[0];
}

export async function completeReminder(id: string): Promise<Reminder | null> {
  const rows = await sql<Reminder[]>`
    UPDATE reminders
    SET completed_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Get reminders that need notification (due within the next hour, not completed, not yet notified)
 */
export async function getRemindersToNotify(): Promise<Reminder[]> {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  return sql<Reminder[]>`
    SELECT * FROM reminders
    WHERE due_at IS NOT NULL
      AND due_at <= ${oneHourFromNow}
      AND due_at >= ${now}
      AND completed_at IS NULL
      AND notified_at IS NULL
    ORDER BY due_at ASC
  `;
}

/**
 * Mark a reminder as notified
 */
export async function markReminderNotified(id: string): Promise<void> {
  await sql`
    UPDATE reminders
    SET notified_at = NOW()
    WHERE id = ${id}
  `;
}
