/**
 * MTA Subway real-time arrivals integration.
 *
 * Uses the MTA GTFS-RT feeds to get real-time subway arrival times.
 * No API key required.
 */

import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import stationsData from "./mta-stations.json" with { type: "json" };

const MTA_API_BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds";

// Feed URLs by line - each line group has its own feed
const LINE_TO_FEED: Record<string, string> = {
  "1": "nyct%2Fgtfs",
  "2": "nyct%2Fgtfs",
  "3": "nyct%2Fgtfs",
  "4": "nyct%2Fgtfs",
  "5": "nyct%2Fgtfs",
  "6": "nyct%2Fgtfs",
  "6X": "nyct%2Fgtfs",
  "7": "nyct%2Fgtfs",
  "7X": "nyct%2Fgtfs",
  S: "nyct%2Fgtfs",
  A: "nyct%2Fgtfs-ace",
  C: "nyct%2Fgtfs-ace",
  E: "nyct%2Fgtfs-ace",
  H: "nyct%2Fgtfs-ace", // Rockaway shuttle
  FS: "nyct%2Fgtfs-ace", // Franklin Ave shuttle
  B: "nyct%2Fgtfs-bdfm",
  D: "nyct%2Fgtfs-bdfm",
  F: "nyct%2Fgtfs-bdfm",
  FX: "nyct%2Fgtfs-bdfm",
  M: "nyct%2Fgtfs-bdfm",
  G: "nyct%2Fgtfs-g",
  J: "nyct%2Fgtfs-jz",
  Z: "nyct%2Fgtfs-jz",
  L: "nyct%2Fgtfs-l",
  N: "nyct%2Fgtfs-nqrw",
  Q: "nyct%2Fgtfs-nqrw",
  R: "nyct%2Fgtfs-nqrw",
  W: "nyct%2Fgtfs-nqrw",
  SI: "nyct%2Fgtfs-si", // Staten Island Railway
};

interface StationInfo {
  name: string;
  lines: string[];
}

// Type the imported JSON
const stations = stationsData as Record<string, StationInfo>;

export interface SubwayArrival {
  line: string;
  direction: "N" | "S";
  arrivalTime: Date;
  minutesAway: number;
}

export interface StationArrivals {
  stationId: string;
  stationName: string;
  arrivals: SubwayArrival[];
  fetchedAt: Date;
}

export interface StationSearchResult {
  id: string;
  name: string;
  lines: string[];
}

/**
 * Get station name from stop ID.
 */
export function getStationName(stopId: string): string | null {
  const station = stations[stopId];
  return station?.name ?? null;
}

/**
 * Get station info (name + lines) from stop ID.
 */
export function getStationInfo(stopId: string): StationInfo | null {
  return stations[stopId] ?? null;
}

/**
 * Search for stations by name (case-insensitive partial match).
 */
export function searchStations(query: string): StationSearchResult[] {
  const lowerQuery = query.toLowerCase();

  return Object.entries(stations)
    .filter(([, station]) => station.name.toLowerCase().includes(lowerQuery))
    .map(([id, station]) => ({
      id,
      name: station.name,
      lines: station.lines,
    }))
    .sort((a, b) => {
      // Prioritize exact matches, then starts-with, then contains
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();

      if (aName === lowerQuery) return -1;
      if (bName === lowerQuery) return 1;
      if (aName.startsWith(lowerQuery) && !bName.startsWith(lowerQuery))
        return -1;
      if (bName.startsWith(lowerQuery) && !aName.startsWith(lowerQuery))
        return 1;

      return a.name.localeCompare(b.name);
    })
    .slice(0, 10);
}

/**
 * Fetch and parse a GTFS-RT feed.
 */
async function fetchFeed(
  feedId: string
): Promise<GtfsRealtimeBindings.transit_realtime.FeedMessage> {
  const url = `${MTA_API_BASE}/${feedId}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/x-protobuf",
    },
  });

  if (!response.ok) {
    throw new Error(`MTA feed fetch failed: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );
}

/**
 * Get real-time arrivals for a station.
 */
export async function getArrivalsForStation(
  stopId: string
): Promise<StationArrivals> {
  const stationInfo = stations[stopId];
  if (!stationInfo) {
    throw new Error(`Unknown station: ${stopId}`);
  }

  // Determine which feeds to query based on lines at this station
  const feedIds = [
    ...new Set(
      stationInfo.lines.map((line) => LINE_TO_FEED[line]).filter(Boolean)
    ),
  ];

  if (feedIds.length === 0) {
    throw new Error(`No feeds found for station: ${stopId}`);
  }

  const arrivals: SubwayArrival[] = [];
  const now = Date.now();

  // Fetch all relevant feeds in parallel
  const feeds = await Promise.all(
    feedIds.map(async (feedId) => {
      try {
        return await fetchFeed(feedId);
      } catch (error) {
        console.error(`[mta] Failed to fetch feed ${feedId}:`, error);
        return null;
      }
    })
  );

  for (const feed of feeds) {
    if (!feed) continue;

    for (const entity of feed.entity) {
      if (!entity.tripUpdate?.stopTimeUpdate) continue;

      const routeId = entity.tripUpdate.trip?.routeId;
      if (!routeId) continue;

      for (const update of entity.tripUpdate.stopTimeUpdate) {
        const updateStopId = update.stopId;
        if (!updateStopId) continue;

        // Check if this stop matches our station
        // MTA uses stopId format like "635N" or "635S" for direction
        const baseStopId = updateStopId.replace(/[NS]$/, "");
        if (baseStopId !== stopId) continue;

        // Get arrival time (prefer arrival, fall back to departure)
        const arrivalTime = update.arrival?.time ?? update.departure?.time;
        if (!arrivalTime) continue;

        // Handle Long type from protobuf
        const arrivalMs =
          typeof arrivalTime === "number"
            ? arrivalTime * 1000
            : Number(arrivalTime) * 1000;

        // Skip past arrivals
        if (arrivalMs < now) continue;

        const direction = updateStopId.endsWith("N") ? "N" : "S";
        const minutesAway = Math.round((arrivalMs - now) / 60000);

        arrivals.push({
          line: routeId,
          direction: direction as "N" | "S",
          arrivalTime: new Date(arrivalMs),
          minutesAway,
        });
      }
    }
  }

  // Sort by arrival time
  arrivals.sort((a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime());

  return {
    stationId: stopId,
    stationName: stationInfo.name,
    arrivals: arrivals.slice(0, 20), // Limit to next 20 trains
    fetchedAt: new Date(),
  };
}

/**
 * Format direction as human-readable text.
 * Note: "North" and "South" are approximate - some lines run east/west.
 */
export function formatDirection(direction: "N" | "S", line: string): string {
  // L train runs east-west
  if (line === "L") {
    return direction === "N" ? "Manhattan-bound" : "Canarsie-bound";
  }

  // Shuttle lines
  if (line === "S" || line === "FS" || line === "H") {
    return direction === "N" ? "Northbound" : "Southbound";
  }

  // G train runs north-south but labeled differently
  if (line === "G") {
    return direction === "N" ? "Court Sq-bound" : "Church Av-bound";
  }

  // Default north/south
  return direction === "N" ? "Uptown/Bronx" : "Downtown/Brooklyn";
}
