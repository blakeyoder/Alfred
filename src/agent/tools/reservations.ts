import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./reminders.js";

// ============ Types ============

type ReservationPlatform = "resy" | "opentable" | "tock" | "unknown";

interface ParsedRestaurantUrl {
  platform: ReservationPlatform;
  restaurantSlug: string;
  city?: string;
  originalUrl: string;
}

// ============ Schemas ============

const generateReservationLinkSchema = z.object({
  restaurantUrl: z
    .string()
    .url()
    .describe(
      "The restaurant's URL from a previous search result. " +
        "Must be from resy.com, opentable.com, or exploretock.com."
    ),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Reservation date in YYYY-MM-DD format"),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .describe("Preferred reservation time in HH:MM format (24-hour)"),
  partySize: z
    .number()
    .int()
    .min(1)
    .max(20)
    .describe("Number of guests (1-20)"),
});

const detectPlatformSchema = z.object({
  restaurantName: z.string().describe("Name of the restaurant to look up"),
  city: z.string().describe("City where the restaurant is located"),
});

// ============ Platform Detection ============

function parseRestaurantUrl(url: string): ParsedRestaurantUrl {
  const urlObj = new URL(url);
  const hostname = urlObj.hostname.toLowerCase();

  // Resy: resy.com/cities/{city}/venues/{slug}
  if (hostname.includes("resy.com")) {
    const pathMatch = urlObj.pathname.match(
      /\/cities\/([^/]+)\/venues\/([^/?]+)/
    );
    if (pathMatch) {
      return {
        platform: "resy",
        city: pathMatch[1],
        restaurantSlug: pathMatch[2],
        originalUrl: url,
      };
    }
    // Fallback: just extract the last path segment
    const segments = urlObj.pathname.split("/").filter(Boolean);
    return {
      platform: "resy",
      restaurantSlug: segments[segments.length - 1] ?? "",
      originalUrl: url,
    };
  }

  // OpenTable: opentable.com/r/{slug} or opentable.com/{slug}
  if (hostname.includes("opentable.com")) {
    const pathSegments = urlObj.pathname.split("/").filter(Boolean);
    // Skip 'r' prefix if present
    const slug = pathSegments[0] === "r" ? pathSegments[1] : pathSegments[0];
    return {
      platform: "opentable",
      restaurantSlug: slug ?? "",
      originalUrl: url,
    };
  }

  // Tock: exploretock.com/{slug}
  if (hostname.includes("exploretock.com") || hostname.includes("tock.com")) {
    const pathSegments = urlObj.pathname.split("/").filter(Boolean);
    return {
      platform: "tock",
      restaurantSlug: pathSegments[0] ?? "",
      originalUrl: url,
    };
  }

  return {
    platform: "unknown",
    restaurantSlug: "",
    originalUrl: url,
  };
}

// ============ Link Generators ============

function generateResyLink(
  parsed: ParsedRestaurantUrl,
  date: string,
  time: string,
  partySize: number
): string {
  // Resy format: https://resy.com/cities/{city}/venues/{slug}?date=YYYY-MM-DD&seats=N
  const baseUrl = parsed.city
    ? `https://resy.com/cities/${parsed.city}/venues/${parsed.restaurantSlug}`
    : parsed.originalUrl.split("?")[0];

  const params = new URLSearchParams({
    date,
    seats: partySize.toString(),
  });

  return `${baseUrl}?${params.toString()}`;
}

function generateOpenTableLink(
  parsed: ParsedRestaurantUrl,
  date: string,
  time: string,
  partySize: number
): string {
  // OpenTable format: https://www.opentable.com/{slug}?covers=N&dateTime=YYYY-MM-DDTHH:MM
  const baseUrl = parsed.originalUrl.split("?")[0];
  const dateTime = `${date}T${time}`;

  const params = new URLSearchParams({
    covers: partySize.toString(),
    dateTime,
  });

  return `${baseUrl}?${params.toString()}`;
}

function generateTockLink(
  parsed: ParsedRestaurantUrl,
  date: string,
  time: string,
  partySize: number
): string {
  // Tock format: https://www.exploretock.com/{slug}?date=YYYY-MM-DD&size=N&time=HH:MM
  const baseUrl = `https://www.exploretock.com/${parsed.restaurantSlug}`;

  const params = new URLSearchParams({
    date,
    size: partySize.toString(),
    time,
  });

  return `${baseUrl}?${params.toString()}`;
}

// ============ Tool Factory ============

export function createReservationTools(
  _ctx: ToolContext,
  _partnerId: string | null
) {
  return {
    generateReservationLink: tool({
      description:
        "Generate a reservation booking link for a restaurant. " +
        "Takes a restaurant URL (from Resy, OpenTable, or Tock) and booking details, " +
        "returns a deep link that pre-fills the date, time, and party size. " +
        "The user can click the link to complete their reservation.",
      inputSchema: generateReservationLinkSchema,
      execute: async ({ restaurantUrl, date, time, partySize }) => {
        try {
          const parsed = parseRestaurantUrl(restaurantUrl);

          if (parsed.platform === "unknown") {
            return {
              success: false,
              message:
                "This restaurant doesn't appear to use Resy, OpenTable, or Tock. " +
                "I can't generate a booking link, but you can visit their website directly.",
              originalUrl: restaurantUrl,
            };
          }

          let bookingLink: string;
          let platformName: string;
          let instructions: string;

          switch (parsed.platform) {
            case "resy":
              bookingLink = generateResyLink(parsed, date, time, partySize);
              platformName = "Resy";
              instructions =
                "Tap the link to open Resy with your preferences pre-filled. " +
                "Select an available time slot and confirm your reservation.";
              break;

            case "opentable":
              bookingLink = generateOpenTableLink(
                parsed,
                date,
                time,
                partySize
              );
              platformName = "OpenTable";
              instructions =
                "Tap the link to open OpenTable with your preferences pre-filled. " +
                "Choose an available time and complete your booking.";
              break;

            case "tock":
              bookingLink = generateTockLink(parsed, date, time, partySize);
              platformName = "Tock";
              instructions =
                "Tap the link to open Tock with your preferences pre-filled. " +
                "Select your experience and complete the reservation.";
              break;

            default:
              return {
                success: false,
                message: "Unable to generate booking link for this platform.",
                originalUrl: restaurantUrl,
              };
          }

          return {
            success: true,
            platform: platformName,
            bookingLink,
            date,
            time,
            partySize,
            instructions,
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to generate reservation link",
          };
        }
      },
    }),

    detectReservationPlatform: tool({
      description:
        "Detect which reservation platform a restaurant uses by searching for their booking page. " +
        "Use this when you have a restaurant name but not their booking URL.",
      inputSchema: detectPlatformSchema,
      execute: async ({ restaurantName, city }) => {
        // This tool provides guidance - actual detection happens via web search
        return {
          success: true,
          suggestion:
            `To find ${restaurantName}'s reservation platform, search for: ` +
            `"${restaurantName} ${city} reservations site:resy.com OR site:opentable.com OR site:exploretock.com"`,
          platforms: [
            { name: "Resy", urlPattern: "resy.com/cities/*/venues/*" },
            { name: "OpenTable", urlPattern: "opentable.com/r/*" },
            { name: "Tock", urlPattern: "exploretock.com/*" },
          ],
          note:
            "Once you find the restaurant's booking page URL, use generateReservationLink " +
            "to create a pre-filled booking link.",
        };
      },
    }),
  };
}
