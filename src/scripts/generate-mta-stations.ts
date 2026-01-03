/**
 * Generates mta-stations.json from MTA's static GTFS data.
 *
 * Downloads the subway GTFS zip, parses stops.txt and stop_times.txt,
 * and creates a mapping of stop IDs to station names and lines.
 *
 * Run with: bun run src/scripts/generate-mta-stations.ts
 */

import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const GTFS_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip";
const TEMP_DIR = "/tmp/mta-gtfs";
const OUTPUT_PATH = join(
  import.meta.dirname,
  "../integrations/mta-stations.json"
);

interface StationData {
  name: string;
  lines: string[];
}

async function downloadAndExtract(): Promise<void> {
  console.log("Downloading GTFS data...");

  // Clean up and create temp directory
  if (existsSync(TEMP_DIR)) {
    await rm(TEMP_DIR, { recursive: true });
  }
  await mkdir(TEMP_DIR, { recursive: true });

  // Download the zip file
  const response = await fetch(GTFS_URL);
  if (!response.ok) {
    throw new Error(`Failed to download GTFS: ${response.status}`);
  }

  const zipPath = join(TEMP_DIR, "gtfs.zip");
  const buffer = await response.arrayBuffer();
  await writeFile(zipPath, Buffer.from(buffer));

  console.log("Extracting...");

  // Use unzip command (available on macOS and Linux)
  await execAsync(`unzip -o "${zipPath}" -d "${TEMP_DIR}"`);
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));

  return lines.slice(1).map((line) => {
    // Handle quoted fields that may contain commas
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });
    return row;
  });
}

async function generateStations(): Promise<void> {
  await downloadAndExtract();

  console.log("Parsing stops.txt...");
  const stopsContent = await readFile(join(TEMP_DIR, "stops.txt"), "utf-8");
  const stops = parseCSV(stopsContent);

  console.log("Parsing trips.txt...");
  const tripsContent = await readFile(join(TEMP_DIR, "trips.txt"), "utf-8");
  const trips = parseCSV(tripsContent);

  console.log("Parsing stop_times.txt...");
  const stopTimesContent = await readFile(
    join(TEMP_DIR, "stop_times.txt"),
    "utf-8"
  );
  const stopTimes = parseCSV(stopTimesContent);

  // Build trip_id -> route_id mapping
  const tripToRoute: Record<string, string> = {};
  for (const trip of trips) {
    tripToRoute[trip.trip_id] = trip.route_id;
  }

  // Build stop_id -> set of route_ids
  const stopRoutes: Record<string, Set<string>> = {};
  for (const stopTime of stopTimes) {
    const stopId = stopTime.stop_id;
    const routeId = tripToRoute[stopTime.trip_id];
    if (stopId && routeId) {
      // Get base stop ID (remove N/S direction suffix)
      const baseStopId = stopId.replace(/[NS]$/, "");
      if (!stopRoutes[baseStopId]) {
        stopRoutes[baseStopId] = new Set();
      }
      stopRoutes[baseStopId].add(routeId);
    }
  }

  // Build stations map - only include parent stations (not N/S variants)
  const stations: Record<string, StationData> = {};

  for (const stop of stops) {
    const stopId = stop.stop_id;
    const stopName = stop.stop_name;

    // Skip direction-specific stops (ending in N or S)
    // and only include parent stations
    if (stopId.match(/[NS]$/) || stop.location_type === "0") {
      continue;
    }

    // Only include stops that have routes (actual stations, not landmarks)
    const routes = stopRoutes[stopId];
    if (!routes || routes.size === 0) {
      // Try without any suffix transformations
      continue;
    }

    stations[stopId] = {
      name: stopName,
      lines: [...routes].sort(),
    };
  }

  // Also add stops that are leaf nodes (no parent) but have routes
  for (const stop of stops) {
    const stopId = stop.stop_id;
    const baseStopId = stopId.replace(/[NS]$/, "");

    // Skip if already added
    if (stations[baseStopId]) continue;

    // Skip direction variants
    if (stopId !== baseStopId) continue;

    const routes = stopRoutes[baseStopId];
    if (routes && routes.size > 0) {
      stations[baseStopId] = {
        name: stop.stop_name,
        lines: [...routes].sort(),
      };
    }
  }

  console.log(`Found ${Object.keys(stations).length} stations`);

  // Sort by name for easier debugging
  const sortedStations: Record<string, StationData> = {};
  const sortedKeys = Object.keys(stations).sort((a, b) =>
    stations[a].name.localeCompare(stations[b].name)
  );
  for (const key of sortedKeys) {
    sortedStations[key] = stations[key];
  }

  // Write output
  await writeFile(OUTPUT_PATH, JSON.stringify(sortedStations, null, 2));
  console.log(`Written to ${OUTPUT_PATH}`);

  // Cleanup
  await rm(TEMP_DIR, { recursive: true });
  console.log("Done!");
}

generateStations().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
