/**
 * Date/time utilities with timezone handling for Eastern Time
 */

/**
 * Parse an ISO datetime string, assuming Eastern time if no timezone is specified.
 * This handles LLM-generated times that may omit the Z suffix.
 *
 * @param isoString - ISO datetime string (e.g., "2026-01-02T19:43:00" or "2026-01-02T19:43:00Z")
 * @returns Date object in UTC
 *
 * @example
 * // With timezone (Z) - parsed as-is
 * parseEasternDateTime("2026-01-02T19:43:00Z") // -> 2026-01-02T19:43:00.000Z
 *
 * // Without timezone - assumed to be Eastern time
 * parseEasternDateTime("2026-01-02T19:43:00") // -> 2026-01-03T00:43:00.000Z (EST, +5h)
 */
export function parseEasternDateTime(isoString: string): Date {
  // Check if the string already has timezone info (Z or +/- offset)
  const hasTimezone = /Z|[+-]\d{2}:\d{2}$/.test(isoString);

  if (hasTimezone) {
    // Already has timezone, parse directly
    return new Date(isoString);
  }

  // No timezone specified - assume the LLM meant Eastern time
  // Parse the components and determine if DST applies
  const parts = isoString.split("T");
  const datePart = parts[0];
  const timePart = (parts[1] || "00:00:00").split(".")[0];

  // Check if DST is in effect for Eastern time on this date
  // by creating a test date and checking its formatted offset
  const testDate = new Date(`${datePart}T12:00:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
  const formatted = formatter.format(testDate);
  const isDST = formatted.includes("EDT");

  // Append the correct Eastern timezone offset
  const offset = isDST ? "-04:00" : "-05:00";
  return new Date(`${datePart}T${timePart}${offset}`);
}

/**
 * Check if a given date falls within Daylight Saving Time for Eastern timezone.
 *
 * @param date - Date to check
 * @returns true if EDT (Daylight Saving), false if EST (Standard)
 */
export function isEasternDST(date: Date): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
  const formatted = formatter.format(date);
  return formatted.includes("EDT");
}

/**
 * Format a Date object to Eastern time string for display.
 *
 * @param date - Date to format
 * @param options - Intl.DateTimeFormat options (without timeZone)
 * @returns Formatted string in Eastern time
 */
export function formatEastern(
  date: Date,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {}
): string {
  return date.toLocaleString("en-US", {
    ...options,
    timeZone: "America/New_York",
  });
}
