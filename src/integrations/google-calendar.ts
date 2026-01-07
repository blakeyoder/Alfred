import { getValidAccessToken } from "./google-auth.js";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Check if a given date falls within Daylight Saving Time for Eastern timezone.
 */
function isEasternDST(datePart: string): boolean {
  const testDate = new Date(`${datePart}T12:00:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIMEZONE,
    timeZoneName: "short",
  });
  const formatted = formatter.format(testDate);
  return formatted.includes("EDT");
}

/**
 * Interpret a datetime string as Eastern Time.
 *
 * LLMs often output ISO datetimes with Z suffix (UTC) when they actually mean
 * the local time the user specified. For example, if a user says "7pm", the LLM
 * might output "2024-01-15T19:00:00Z" meaning "7pm" but technically that's 7pm UTC.
 *
 * This function interprets such times as Eastern Time:
 * - If the input has Z suffix, treat the time portion as Eastern and add correct offset
 * - If the input already has an offset, return as-is
 *
 * @param isoString - ISO datetime string (e.g., "2024-01-15T19:00:00Z" or "2024-01-15T19:00:00-05:00")
 * @returns ISO datetime string with Eastern Time offset
 */
export function interpretAsEastern(isoString: string): string {
  // If already has a timezone offset (not Z), return as-is
  if (!isoString.endsWith("Z") && /[+-]\d{2}:\d{2}$/.test(isoString)) {
    return isoString;
  }

  // Strip the Z suffix and any milliseconds - we want to treat the time as-is (not as UTC)
  const cleanedString = isoString.replace(/(\.\d+)?Z$/, "");

  // Extract date and time parts
  const [datePart, timePart = "00:00:00"] = cleanedString.split("T");
  const cleanTimePart = timePart.split(".")[0]; // Remove any remaining milliseconds

  // Determine the correct offset based on whether DST is in effect
  const offset = isEasternDST(datePart) ? "-04:00" : "-05:00";

  return `${datePart}T${cleanTimePart}${offset}`;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  location?: string;
  attendees?: Array<{ email: string; responseStatus?: string }>;
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
  backgroundColor?: string;
}

export type CreateEventInput = {
  summary: string;
  description?: string;
  location?: string;
  attendees?: string[]; // email addresses
} & (
  | {
      allDay: true;
      startDate: string; // YYYY-MM-DD
      endDate: string; // YYYY-MM-DD (exclusive - day after last day)
    }
  | {
      allDay?: false;
      startTime: string; // ISO datetime
      endTime: string; // ISO datetime
    }
);

export type UpdateEventInput = {
  summary?: string;
  description?: string;
  location?: string;
} & (
  | {
      allDay: true;
      startDate: string; // YYYY-MM-DD
      endDate: string; // YYYY-MM-DD (exclusive)
    }
  | {
      allDay?: false;
      startTime?: string; // ISO datetime
      endTime?: string; // ISO datetime
    }
);

interface TimeSlot {
  start: string;
  end: string;
  durationMinutes: number;
}

async function makeCalendarRequest<T>(
  userId: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error(
      "Not authenticated with Google. Use /auth google to connect."
    );
  }

  const url = `${CALENDAR_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Calendar API error: ${error}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Get calendar events within a date range.
 */
export async function getEvents(
  userId: string,
  startDate: string,
  endDate: string,
  calendarId = "primary"
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: new Date(startDate).toISOString(),
    timeMax: new Date(endDate + "T23:59:59").toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });

  const response = await makeCalendarRequest<{ items: CalendarEvent[] }>(
    userId,
    `/calendars/${encodeURIComponent(calendarId)}/events?${params}`
  );

  return response.items || [];
}

/**
 * Create a new calendar event.
 */
export async function createEvent(
  userId: string,
  event: CreateEventInput,
  calendarId = "primary"
): Promise<CalendarEvent> {
  const body = {
    summary: event.summary,
    description: event.description,
    start: event.allDay
      ? { date: event.startDate }
      : {
          dateTime: interpretAsEastern(event.startTime),
          timeZone: DEFAULT_TIMEZONE,
        },
    end: event.allDay
      ? { date: event.endDate }
      : {
          dateTime: interpretAsEastern(event.endTime),
          timeZone: DEFAULT_TIMEZONE,
        },
    location: event.location,
    attendees: event.attendees?.map((email) => ({ email })),
  };

  return makeCalendarRequest<CalendarEvent>(
    userId,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

/**
 * Update an existing calendar event.
 * Only provided fields will be updated.
 */
export async function updateEvent(
  userId: string,
  eventId: string,
  updates: UpdateEventInput,
  calendarId = "primary"
): Promise<CalendarEvent> {
  const body: Record<string, unknown> = {};

  if (updates.summary !== undefined) {
    body.summary = updates.summary;
  }
  if (updates.description !== undefined) {
    body.description = updates.description;
  }
  if (updates.location !== undefined) {
    body.location = updates.location;
  }

  if (updates.allDay) {
    body.start = { date: updates.startDate };
    body.end = { date: updates.endDate };
  } else {
    if (updates.startTime !== undefined) {
      body.start = {
        dateTime: interpretAsEastern(updates.startTime),
        timeZone: DEFAULT_TIMEZONE,
      };
    }
    if (updates.endTime !== undefined) {
      body.end = {
        dateTime: interpretAsEastern(updates.endTime),
        timeZone: DEFAULT_TIMEZONE,
      };
    }
  }

  return makeCalendarRequest<CalendarEvent>(
    userId,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    }
  );
}

/**
 * Delete a calendar event.
 */
export async function deleteEvent(
  userId: string,
  eventId: string,
  calendarId = "primary"
): Promise<void> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error(
      "Not authenticated with Google. Use /auth google to connect."
    );
  }

  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Calendar API error: ${error}`);
  }
}

/**
 * Get free/busy information for a user.
 */
async function getFreeBusy(
  userId: string,
  startDate: string,
  endDate: string
): Promise<Array<{ start: string; end: string }>> {
  const response = await makeCalendarRequest<{
    calendars: {
      primary: { busy: Array<{ start: string; end: string }> };
    };
  }>(userId, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin: new Date(startDate).toISOString(),
      timeMax: new Date(endDate + "T23:59:59").toISOString(),
      items: [{ id: "primary" }],
    }),
  });

  return response.calendars?.primary?.busy || [];
}

/**
 * Find overlapping free time slots for two users.
 */
export async function findFreeTime(
  user1Id: string,
  user2Id: string,
  startDate: string,
  endDate: string,
  minDurationMinutes = 60
): Promise<TimeSlot[]> {
  const [busy1, busy2] = await Promise.all([
    getFreeBusy(user1Id, startDate, endDate),
    getFreeBusy(user2Id, startDate, endDate),
  ]);

  // Combine and sort all busy periods
  const allBusy = [...busy1, ...busy2].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  // Merge overlapping busy periods
  const mergedBusy: Array<{ start: Date; end: Date }> = [];
  for (const period of allBusy) {
    const start = new Date(period.start);
    const end = new Date(period.end);

    if (
      mergedBusy.length > 0 &&
      start <= mergedBusy[mergedBusy.length - 1].end
    ) {
      // Extend the last period
      mergedBusy[mergedBusy.length - 1].end = new Date(
        Math.max(mergedBusy[mergedBusy.length - 1].end.getTime(), end.getTime())
      );
    } else {
      mergedBusy.push({ start, end });
    }
  }

  // Find free slots between busy periods
  const freeSlots: TimeSlot[] = [];
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(endDate + "T23:59:59");

  // Adjust range to reasonable hours (9 AM - 9 PM)
  const workDayStart = 9;
  const workDayEnd = 21;

  let currentTime = new Date(rangeStart);
  currentTime.setHours(workDayStart, 0, 0, 0);

  for (const busy of mergedBusy) {
    if (currentTime < busy.start) {
      // Check if this gap is during work hours and long enough
      const gapEnd = busy.start;
      const durationMs = gapEnd.getTime() - currentTime.getTime();
      const durationMinutes = durationMs / (1000 * 60);

      if (durationMinutes >= minDurationMinutes) {
        const startHour = currentTime.getHours();
        const endHour = gapEnd.getHours();

        if (startHour >= workDayStart && endHour <= workDayEnd) {
          freeSlots.push({
            start: currentTime.toISOString(),
            end: gapEnd.toISOString(),
            durationMinutes: Math.round(durationMinutes),
          });
        }
      }
    }
    currentTime = new Date(Math.max(currentTime.getTime(), busy.end.getTime()));
  }

  // Check remaining time after last busy period
  if (currentTime < rangeEnd) {
    const durationMs = rangeEnd.getTime() - currentTime.getTime();
    const durationMinutes = durationMs / (1000 * 60);

    if (durationMinutes >= minDurationMinutes) {
      const startHour = currentTime.getHours();
      if (startHour >= workDayStart && startHour < workDayEnd) {
        freeSlots.push({
          start: currentTime.toISOString(),
          end: rangeEnd.toISOString(),
          durationMinutes: Math.round(durationMinutes),
        });
      }
    }
  }

  return freeSlots.slice(0, 10); // Return top 10 slots
}

/**
 * List all calendars accessible to the user.
 * Only returns calendars the user can write to (writer or owner role).
 */
export async function listCalendars(
  userId: string,
  writableOnly = true
): Promise<CalendarListEntry[]> {
  const response = await makeCalendarRequest<{ items: CalendarListEntry[] }>(
    userId,
    "/users/me/calendarList"
  );

  const calendars = response.items || [];

  if (writableOnly) {
    return calendars.filter(
      (cal) => cal.accessRole === "writer" || cal.accessRole === "owner"
    );
  }

  return calendars;
}
