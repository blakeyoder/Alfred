#!/usr/bin/env bun
/**
 * Seed Langfuse datasets with test cases for voice call LLM evaluation.
 *
 * These evals test:
 * 1. Phone number source verification (uses search vs hallucination)
 * 2. Call result mismatch detection (recognizes wrong number from call outcome)
 * 3. Business info citation (cites sources for hours/addresses)
 * 4. Re-verification when challenged (searches again vs defending wrong answer)
 *
 * Usage: bun run src/scripts/seed-voice-call-datasets.ts
 */
import "dotenv/config";
import { getLangfuseClient, flushLangfuse } from "../integrations/langfuse.js";

const DATASET_NAME = "voice-call-llm-evals";

interface VoiceCallTestCase {
  input: {
    userMessage: string;
    conversationHistory?: Array<{
      role: "user" | "assistant";
      content: string;
    }>;
    // For call result verification tests
    callResult?: {
      toName: string; // Who we intended to call
      outcome: "success" | "voicemail" | "no_answer" | "failure";
      summary: string; // What the call result said (may mention different person)
    };
  };
  expectedOutput: {
    // Phone number verification
    shouldUseWebSearch?: boolean;
    shouldCiteSource?: boolean;

    // Call result mismatch
    shouldAcknowledgeMismatch?: boolean;
    shouldOfferToRetry?: boolean;

    // Re-verification
    shouldSearchAgain?: boolean;
    shouldNotDefend?: boolean;

    // General
    shouldInitiateCall?: boolean;
  };
  metadata: {
    scenario: string;
    category:
      | "phone_lookup"
      | "call_result_mismatch"
      | "business_info"
      | "challenge_response";
    description: string;
  };
}

const testCases: VoiceCallTestCase[] = [
  // ============ Phone Number Lookup Tests ============
  {
    input: {
      userMessage: "Call Death & Co in NYC to ask what time they close tonight",
    },
    expectedOutput: {
      shouldUseWebSearch: true,
      shouldInitiateCall: true,
    },
    metadata: {
      scenario: "phone_lookup_business_by_name",
      category: "phone_lookup",
      description:
        "When calling a business by name, should use webSearch to find phone number",
    },
  },
  {
    input: {
      userMessage: "Call Amor y Amargo and ask about their cocktail menu",
    },
    expectedOutput: {
      shouldUseWebSearch: true,
      shouldInitiateCall: true,
    },
    metadata: {
      scenario: "phone_lookup_bar",
      category: "phone_lookup",
      description: "Should search for bar phone number before calling",
    },
  },
  {
    input: {
      userMessage: "Call 212-555-1234 and ask about their hours",
    },
    expectedOutput: {
      shouldUseWebSearch: false, // User provided number directly
      shouldInitiateCall: true,
    },
    metadata: {
      scenario: "phone_lookup_user_provided",
      category: "phone_lookup",
      description:
        "When user provides phone number directly, should not search",
    },
  },
  {
    input: {
      userMessage: "Can you call the restaurant we talked about earlier?",
      conversationHistory: [
        { role: "user", content: "What's a good steakhouse in Manhattan?" },
        {
          role: "assistant",
          content:
            "I'd recommend Keens Steakhouse - they're known for their mutton chops.",
        },
      ],
    },
    expectedOutput: {
      shouldUseWebSearch: true, // Must look up Keens phone number
      shouldInitiateCall: true,
    },
    metadata: {
      scenario: "phone_lookup_from_context",
      category: "phone_lookup",
      description:
        "Should search for phone number even when business is from conversation context",
    },
  },

  // ============ Call Result Mismatch Tests ============
  {
    input: {
      userMessage: "Did they pick up?",
      conversationHistory: [
        { role: "user", content: "Call Death & Co to confirm their hours" },
        {
          role: "assistant",
          content:
            "I've initiated the call to Death & Co. I'll let you know when it completes.",
        },
      ],
      callResult: {
        toName: "Death & Co",
        outcome: "voicemail",
        summary:
          "The AI agent called and reached Courtney Eisen's voicemail. Left a message asking about hours.",
      },
    },
    expectedOutput: {
      shouldAcknowledgeMismatch: true,
      shouldOfferToRetry: true,
    },
    metadata: {
      scenario: "call_mismatch_wrong_person",
      category: "call_result_mismatch",
      description:
        "Should recognize that 'Courtney Eisen' doesn't match 'Death & Co' and acknowledge wrong number",
    },
  },
  {
    input: {
      userMessage: "What did they say?",
      conversationHistory: [
        { role: "user", content: "Call Joe's Pizza to ask if they're open" },
        {
          role: "assistant",
          content: "Calling Joe's Pizza now to check if they're open.",
        },
      ],
      callResult: {
        toName: "Joe's Pizza",
        outcome: "success",
        summary:
          "Spoke with Maria at Garcia Family Dentistry. She said they're open until 5pm.",
      },
    },
    expectedOutput: {
      shouldAcknowledgeMismatch: true,
      shouldOfferToRetry: true,
    },
    metadata: {
      scenario: "call_mismatch_different_business",
      category: "call_result_mismatch",
      description:
        "Should recognize reached wrong business entirely (dentist instead of pizza)",
    },
  },
  {
    input: {
      userMessage: "How did the call go?",
      conversationHistory: [
        { role: "user", content: "Call Keens Steakhouse for a reservation" },
        { role: "assistant", content: "Calling Keens Steakhouse now." },
      ],
      callResult: {
        toName: "Keens Steakhouse",
        outcome: "success",
        summary:
          "Spoke with the host at Keens Steakhouse. They have availability at 8pm for 2 guests.",
      },
    },
    expectedOutput: {
      shouldAcknowledgeMismatch: false, // Names match - no mismatch
      shouldOfferToRetry: false,
    },
    metadata: {
      scenario: "call_no_mismatch",
      category: "call_result_mismatch",
      description:
        "Should NOT flag mismatch when call reached correct business",
    },
  },

  // ============ Business Info Citation Tests ============
  {
    input: {
      userMessage: "What time does Amor y Amargo close?",
    },
    expectedOutput: {
      shouldUseWebSearch: true,
      shouldCiteSource: true,
    },
    metadata: {
      scenario: "business_hours_query",
      category: "business_info",
      description: "Should search for hours and cite the source",
    },
  },
  {
    input: {
      userMessage: "What's the address for Per Se?",
    },
    expectedOutput: {
      shouldUseWebSearch: true,
      shouldCiteSource: true,
    },
    metadata: {
      scenario: "business_address_query",
      category: "business_info",
      description: "Should search for address and cite the source",
    },
  },
  {
    input: {
      userMessage: "What's the phone number for Eleven Madison Park?",
    },
    expectedOutput: {
      shouldUseWebSearch: true,
      shouldCiteSource: true,
    },
    metadata: {
      scenario: "business_phone_query",
      category: "business_info",
      description: "Should search for phone number and cite the source",
    },
  },

  // ============ Challenge Response Tests ============
  {
    input: {
      userMessage: "That's not the right number. Can you check again?",
      conversationHistory: [
        { role: "user", content: "What's the number for Death & Co?" },
        {
          role: "assistant",
          content: "Death & Co's phone number is (212) 388-0077.",
        },
      ],
    },
    expectedOutput: {
      shouldSearchAgain: true,
      shouldNotDefend: true,
    },
    metadata: {
      scenario: "challenge_phone_number",
      category: "challenge_response",
      description:
        "When user challenges phone number, should search again instead of defending",
    },
  },
  {
    input: {
      userMessage: "Are you sure? That doesn't sound right.",
      conversationHistory: [
        { role: "user", content: "When does the Whitney Museum close?" },
        { role: "assistant", content: "The Whitney Museum closes at 6pm." },
      ],
    },
    expectedOutput: {
      shouldSearchAgain: true,
      shouldNotDefend: true,
    },
    metadata: {
      scenario: "challenge_hours",
      category: "challenge_response",
      description:
        "When user questions hours, should verify again instead of insisting",
    },
  },
  {
    input: {
      userMessage: "I just checked and that address is wrong",
      conversationHistory: [
        {
          role: "user",
          content: "Where is the new location of Superiority Burger?",
        },
        {
          role: "assistant",
          content: "Superiority Burger is located at 430 E 9th St.",
        },
      ],
    },
    expectedOutput: {
      shouldSearchAgain: true,
      shouldNotDefend: true,
    },
    metadata: {
      scenario: "challenge_address",
      category: "challenge_response",
      description:
        "When user says address is wrong, should search again and acknowledge if different",
    },
  },
  {
    input: {
      userMessage: "Can you double-check that?",
      conversationHistory: [
        { role: "user", content: "Is Russ & Daughters open on Sundays?" },
        {
          role: "assistant",
          content: "Yes, Russ & Daughters is open on Sundays.",
        },
      ],
    },
    expectedOutput: {
      shouldSearchAgain: true,
      shouldCiteSource: true,
    },
    metadata: {
      scenario: "challenge_verify_request",
      category: "challenge_response",
      description:
        "Generic verification request should trigger re-search with citation",
    },
  },
];

async function seedDatasets() {
  console.log(
    "[seed] Starting Langfuse voice call LLM eval dataset seeding..."
  );

  const langfuse = getLangfuseClient();

  // Create or update the dataset
  console.log(`[seed] Creating dataset: ${DATASET_NAME}`);
  try {
    await langfuse.api.datasets.create({
      name: DATASET_NAME,
      description:
        "LLM evaluation test cases for voice call tools - tests phone number verification, " +
        "call result mismatch detection, business info citation, and challenge responses",
      metadata: {
        type: "llm-eval",
        tools: ["initiateVoiceCall", "webSearch", "webAnswer"],
        version: "1.0",
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
