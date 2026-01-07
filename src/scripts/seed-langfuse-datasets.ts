#!/usr/bin/env bun
/**
 * Seed Langfuse datasets with test cases for LLM tool evaluation.
 *
 * Usage: bun run src/scripts/seed-langfuse-datasets.ts
 */
import "dotenv/config";
import { getLangfuseClient, flushLangfuse } from "../integrations/langfuse.js";

const DATASET_NAME = "calendar-llm-evals";

interface CalendarLLMTestCase {
  input: {
    userMessage: string;
    currentDate: string; // YYYY-MM-DD - used to set "today" for the LLM
    currentTime: string; // HH:MM - current time in Eastern
  };
  expectedOutput: {
    shouldCallTool: boolean;
    toolName?: "createCalendarEvent";
    startTimeOffset?: "-05:00" | "-04:00"; // Expected Eastern offset
    shouldBeAllDay?: boolean;
  };
  metadata: {
    scenario: string;
    description: string;
  };
}

// LLM eval test cases - natural language → expected tool behavior
const testCases: CalendarLLMTestCase[] = [
  // Winter (EST = -05:00)
  {
    input: {
      userMessage: "Schedule dinner at 7pm tomorrow",
      currentDate: "2024-01-15",
      currentTime: "14:00",
    },
    expectedOutput: {
      shouldCallTool: true,
      toolName: "createCalendarEvent",
      startTimeOffset: "-05:00",
    },
    metadata: {
      scenario: "winter_relative_tomorrow",
      description:
        "Relative date (tomorrow) in January should use EST (-05:00)",
    },
  },
  {
    input: {
      userMessage: "Add a meeting at 9am on January 20th",
      currentDate: "2024-01-15",
      currentTime: "10:00",
    },
    expectedOutput: {
      shouldCallTool: true,
      toolName: "createCalendarEvent",
      startTimeOffset: "-05:00",
    },
    metadata: {
      scenario: "winter_absolute_date",
      description: "Absolute January date should use EST (-05:00)",
    },
  },
  {
    input: {
      userMessage: "Schedule a call at 3pm this afternoon",
      currentDate: "2024-02-10",
      currentTime: "11:00",
    },
    expectedOutput: {
      shouldCallTool: true,
      toolName: "createCalendarEvent",
      startTimeOffset: "-05:00",
    },
    metadata: {
      scenario: "winter_same_day",
      description: "Same day event in February should use EST (-05:00)",
    },
  },

  // Summer (EDT = -04:00)
  {
    input: {
      userMessage: "Book dinner for 8pm on July 4th",
      currentDate: "2024-06-15",
      currentTime: "12:00",
    },
    expectedOutput: {
      shouldCallTool: true,
      toolName: "createCalendarEvent",
      startTimeOffset: "-04:00",
    },
    metadata: {
      scenario: "summer_july_4th",
      description: "July 4th event should use EDT (-04:00)",
    },
  },
  {
    input: {
      userMessage: "Add a 2pm meeting tomorrow",
      currentDate: "2024-08-15",
      currentTime: "09:00",
    },
    expectedOutput: {
      shouldCallTool: true,
      toolName: "createCalendarEvent",
      startTimeOffset: "-04:00",
    },
    metadata: {
      scenario: "summer_relative_tomorrow",
      description: "Tomorrow in August should use EDT (-04:00)",
    },
  },

  // DST transitions
  {
    input: {
      userMessage: "Schedule a call at 10am on March 11th",
      currentDate: "2024-03-08",
      currentTime: "14:00",
    },
    expectedOutput: {
      shouldCallTool: true,
      toolName: "createCalendarEvent",
      startTimeOffset: "-04:00", // March 10 is spring forward, so March 11 is EDT
    },
    metadata: {
      scenario: "dst_spring_forward",
      description: "Day after spring DST (March 10) should use EDT (-04:00)",
    },
  },
  {
    input: {
      userMessage: "Add meeting at 9am on November 4th",
      currentDate: "2024-11-01",
      currentTime: "10:00",
    },
    expectedOutput: {
      shouldCallTool: true,
      toolName: "createCalendarEvent",
      startTimeOffset: "-05:00", // Nov 3 is fall back, so Nov 4 is EST
    },
    metadata: {
      scenario: "dst_fall_back",
      description: "Day after fall DST (Nov 3) should use EST (-05:00)",
    },
  },

  // All-day events
  {
    input: {
      userMessage: "Add Sarah's birthday on March 15th as an all-day event",
      currentDate: "2024-03-01",
      currentTime: "09:00",
    },
    expectedOutput: {
      shouldCallTool: true,
      toolName: "createCalendarEvent",
      shouldBeAllDay: true,
    },
    metadata: {
      scenario: "allday_birthday",
      description: "Birthday should be created as all-day event",
    },
  },
  {
    input: {
      userMessage: "Block off June 1st through June 7th for vacation",
      currentDate: "2024-05-15",
      currentTime: "10:00",
    },
    expectedOutput: {
      shouldCallTool: true,
      toolName: "createCalendarEvent",
      shouldBeAllDay: true,
    },
    metadata: {
      scenario: "allday_vacation",
      description: "Multi-day vacation should be all-day event",
    },
  },

  // Edge cases
  {
    input: {
      userMessage: "Schedule a late dinner at 10pm tonight",
      currentDate: "2024-05-10",
      currentTime: "18:00",
    },
    expectedOutput: {
      shouldCallTool: true,
      toolName: "createCalendarEvent",
      startTimeOffset: "-04:00",
    },
    metadata: {
      scenario: "late_night_same_day",
      description: "Late night event same day in May should use EDT",
    },
  },
  {
    input: {
      userMessage: "Add an early breakfast meeting at 7am next Monday",
      currentDate: "2024-01-10",
      currentTime: "15:00",
    },
    expectedOutput: {
      shouldCallTool: true,
      toolName: "createCalendarEvent",
      startTimeOffset: "-05:00",
    },
    metadata: {
      scenario: "early_morning_next_week",
      description: "Early morning event next week in January should use EST",
    },
  },

  // Non-calendar requests (should NOT call tool)
  {
    input: {
      userMessage: "What's on my calendar tomorrow?",
      currentDate: "2024-01-15",
      currentTime: "10:00",
    },
    expectedOutput: {
      shouldCallTool: false, // Should use getCalendarEvents, not create
    },
    metadata: {
      scenario: "query_not_create",
      description: "Querying calendar should not create an event",
    },
  },
];

async function seedDatasets() {
  console.log("[seed] Starting Langfuse LLM eval dataset seeding...");

  const langfuse = getLangfuseClient();

  // Create or update the dataset
  console.log(`[seed] Creating dataset: ${DATASET_NAME}`);
  try {
    await langfuse.api.datasets.create({
      name: DATASET_NAME,
      description:
        "LLM evaluation test cases for calendar tool - tests if agent constructs correct tool calls from natural language",
      metadata: {
        type: "llm-eval",
        tool: "createCalendarEvent",
        version: "2.0",
        createdAt: new Date().toISOString(),
      },
    });
    console.log(`[seed] Dataset created: ${DATASET_NAME}`);
  } catch (error) {
    if (String(error).includes("already exists")) {
      console.log(`[seed] Dataset already exists: ${DATASET_NAME}`);
    } else {
      throw error;
    }
  }

  // Add test cases as dataset items
  console.log(`[seed] Adding ${testCases.length} test cases...`);

  for (const testCase of testCases) {
    try {
      await langfuse.api.datasetItems.create({
        datasetName: DATASET_NAME,
        input: testCase.input,
        expectedOutput: testCase.expectedOutput,
        metadata: testCase.metadata,
      });
      console.log(`[seed] Added: ${testCase.metadata.scenario}`);
    } catch (error) {
      console.error(
        `[seed] Failed to add ${testCase.metadata.scenario}:`,
        error
      );
    }
  }

  await flushLangfuse();

  console.log("[seed] Done!");
  console.log(`[seed] View dataset at: https://cloud.langfuse.com/datasets`);
}

seedDatasets().catch((error) => {
  console.error("[seed] Fatal error:", error);
  process.exit(1);
});
