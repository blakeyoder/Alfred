import { tool } from "ai";
import { z } from "zod";
import {
  getArrivalsForStation,
  searchStations,
  getStationName,
  getStationInfo,
  formatDirection,
} from "../../integrations/mta-subway.js";
import {
  getFavoriteStations,
  addFavoriteStation,
  removeFavoriteStation,
  getFavoriteByNickname,
} from "../../db/queries/subway-favorites.js";
import type { ToolContext } from "./reminders.js";

const getSubwayArrivalsSchema = z.object({
  station: z
    .string()
    .describe(
      "Station name to search for (e.g., 'Union Square', 'Bedford Ave') or a saved nickname (e.g., 'home', 'work')"
    ),
});

const searchSubwayStationsSchema = z.object({
  query: z.string().describe("Station name to search for"),
});

const saveFavoriteStationSchema = z.object({
  stationId: z.string().describe("The MTA station ID (from search results)"),
  nickname: z
    .string()
    .optional()
    .describe("Optional nickname like 'home' or 'work' for quick access"),
});

const removeFavoriteStationSchema = z.object({
  stationId: z.string().describe("The MTA station ID to remove from favorites"),
});

export function createSubwayTools(ctx: ToolContext, _partnerId: string | null) {
  return {
    getSubwayArrivals: tool({
      description:
        "Get real-time NYC subway arrival times for a station. Can use station name or a saved nickname like 'home' or 'work'.",
      inputSchema: getSubwayArrivalsSchema,
      execute: async ({ station }) => {
        // First check if it matches a saved nickname
        const favorite = await getFavoriteByNickname(
          ctx.session.userId,
          station
        );

        let stopId: string;

        if (favorite) {
          stopId = favorite.stop_id;
        } else {
          // Search for station by name
          const results = searchStations(station);
          if (results.length === 0) {
            return {
              success: false,
              message: `No stations found matching "${station}". Try a different name or use searchSubwayStations to find the exact name.`,
            };
          }

          // If multiple matches with different names, ask for clarification
          const uniqueNames = [...new Set(results.map((r) => r.name))];
          if (uniqueNames.length > 1) {
            return {
              success: false,
              message: `Multiple stations match "${station}". Please be more specific:`,
              suggestions: results.map((r) => ({
                id: r.id,
                name: r.name,
                lines: r.lines.join(", "),
              })),
            };
          }

          // Use the first match (all have the same name)
          stopId = results[0].id;
        }

        try {
          const data = await getArrivalsForStation(stopId);

          if (data.arrivals.length === 0) {
            return {
              success: true,
              stationName: data.stationName,
              message: "No upcoming arrivals found. Service may be suspended.",
              arrivals: [],
            };
          }

          // Group by direction for cleaner output
          const northbound = data.arrivals
            .filter((a) => a.direction === "N")
            .slice(0, 5);
          const southbound = data.arrivals
            .filter((a) => a.direction === "S")
            .slice(0, 5);

          // Get a sample line for direction formatting
          const sampleLine = data.arrivals[0]?.line ?? "";

          return {
            success: true,
            stationName: data.stationName,
            uptown: {
              label: formatDirection("N", sampleLine),
              trains: northbound.map((a) => ({
                line: a.line,
                minutesAway: a.minutesAway,
                arrivalTime: a.arrivalTime.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                }),
              })),
            },
            downtown: {
              label: formatDirection("S", sampleLine),
              trains: southbound.map((a) => ({
                line: a.line,
                minutesAway: a.minutesAway,
                arrivalTime: a.arrivalTime.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                }),
              })),
            },
            fetchedAt: data.fetchedAt.toISOString(),
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to fetch arrivals",
          };
        }
      },
    }),

    searchSubwayStations: tool({
      description:
        "Search for NYC subway stations by name. Returns station IDs that can be used to save favorites.",
      inputSchema: searchSubwayStationsSchema,
      execute: async ({ query }) => {
        const results = searchStations(query);

        if (results.length === 0) {
          return {
            success: true,
            message: `No stations found matching "${query}"`,
            stations: [],
          };
        }

        return {
          success: true,
          stations: results.map((r) => ({
            id: r.id,
            name: r.name,
            lines: r.lines.join(", "),
          })),
        };
      },
    }),

    saveFavoriteStation: tool({
      description:
        "Save a subway station as a favorite for quick access. Use a nickname like 'home' or 'work' to easily check arrivals later.",
      inputSchema: saveFavoriteStationSchema,
      execute: async ({ stationId, nickname }) => {
        const stationInfo = getStationInfo(stationId);
        if (!stationInfo) {
          return {
            success: false,
            message: `Unknown station ID: ${stationId}. Use searchSubwayStations to find valid stations.`,
          };
        }

        try {
          const fav = await addFavoriteStation(
            ctx.session.userId,
            stationId,
            nickname
          );

          return {
            success: true,
            message: nickname
              ? `Saved ${stationInfo.name} as "${nickname}". You can now say "arrivals at ${nickname}" to check trains.`
              : `Saved ${stationInfo.name} to favorites.`,
            favorite: {
              stationId: fav.stop_id,
              stationName: stationInfo.name,
              nickname: fav.nickname,
              lines: stationInfo.lines.join(", "),
            },
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Failed to save station",
          };
        }
      },
    }),

    removeFavoriteStation: tool({
      description: "Remove a subway station from your favorites.",
      inputSchema: removeFavoriteStationSchema,
      execute: async ({ stationId }) => {
        const stationName = getStationName(stationId);
        const removed = await removeFavoriteStation(
          ctx.session.userId,
          stationId
        );

        if (!removed) {
          return {
            success: false,
            message: "Station was not in your favorites.",
          };
        }

        return {
          success: true,
          message: `Removed ${stationName ?? stationId} from favorites.`,
        };
      },
    }),

    listFavoriteStations: tool({
      description: "List all your saved favorite subway stations.",
      inputSchema: z.object({}),
      execute: async () => {
        const favorites = await getFavoriteStations(ctx.session.userId);

        if (favorites.length === 0) {
          return {
            success: true,
            message:
              "No favorite stations saved yet. Use saveFavoriteStation to add one.",
            favorites: [],
          };
        }

        return {
          success: true,
          favorites: favorites.map((f) => {
            const info = getStationInfo(f.stop_id);
            return {
              stationId: f.stop_id,
              stationName: info?.name ?? f.stop_id,
              nickname: f.nickname,
              lines: info?.lines.join(", ") ?? "",
            };
          }),
        };
      },
    }),
  };
}
