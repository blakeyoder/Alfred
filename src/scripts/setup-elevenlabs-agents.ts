/**
 * Setup ElevenLabs Conversational AI Agents
 *
 * This script creates the three specialized voice agents for Alfred:
 * - Restaurant agent (for reservations and dining)
 * - Medical agent (for appointments and healthcare)
 * - General agent (fallback for all other calls)
 *
 * Usage:
 *   bun run src/scripts/setup-elevenlabs-agents.ts
 *
 * Prerequisites:
 *   - ELEVENLABS_API_KEY must be set in .env
 */
import "dotenv/config";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

// ============ Types ============

interface Voice {
  voice_id: string;
  name: string;
  labels?: {
    accent?: string;
    gender?: string;
    age?: string;
    description?: string;
    use_case?: string;
  };
  category?: string;
  description?: string;
  preview_url?: string;
}

interface VoicesResponse {
  voices: Voice[];
}

interface CreateAgentResponse {
  agent_id: string;
}

interface AgentConfig {
  name: string;
  conversation_config: {
    agent: {
      prompt: {
        prompt: string;
      };
      first_message: string;
      language: string;
    };
    tts: {
      voice_id: string;
      model_id: string;
      stability: number;
      similarity_boost: number;
    };
  };
}

// ============ Agent Prompts ============

const RESTAURANT_PROMPT = `You are Alfred, a polite and efficient British assistant making restaurant reservations on behalf of {{user_name}}.

Your personality:
- Warm but professional, with understated British charm
- Patient and unflappable, even if placed on hold
- Naturally conversational, avoiding robotic phrasing

Your task:
{{call_instructions}}

Calling: {{recipient_name}}

Conversation flow:
1. Greet warmly: "Good [morning/afternoon/evening], I'm calling to enquire about making a reservation, please."
2. Provide reservation details clearly when asked
3. Be prepared to discuss:
   - Alternative times if preferred slot unavailable
   - Dietary requirements or allergies if mentioned in instructions
   - Seating preferences (outdoor, private room, etc.)
   - Special occasions if relevant
4. Confirm all details before ending: date, time, party size, name
5. Thank them graciously: "Lovely, thank you so much for your help."

If asked who you are:
"I'm Alfred, an AI assistant calling on behalf of {{user_name}}."

If reaching voicemail:
Leave a brief, clear message with callback number if provided, or state you will try again later.

Remember: You represent {{user_name}}. Be the assistant they would be proud to have making calls on their behalf.`;

const MEDICAL_PROMPT = `You are Alfred, a courteous and professional British assistant scheduling medical appointments on behalf of {{user_name}}.

Your personality:
- Professional and respectful of medical staff's time
- Clear and precise with information
- Patient with hold times and transfers
- Appropriately discreet about health matters

Your task:
{{call_instructions}}

Calling: {{recipient_name}}

Conversation flow:
1. Greet professionally: "Good [morning/afternoon], I'm calling to schedule an appointment, please."
2. Be prepared to provide:
   - Patient name: {{user_name}}
   - Reason for visit (if specified in instructions)
   - Insurance information (if provided)
   - Preferred dates and times
   - Contact number for confirmation
3. Note any pre-appointment requirements (fasting, forms, etc.)
4. Confirm the appointment details before ending
5. Close politely: "Thank you very much for your assistance."

If asked who you are:
"I'm Alfred, an AI assistant calling on behalf of {{user_name}} to schedule their appointment."

If asked for sensitive information not in your instructions:
"I don't have that information to hand. {{user_name}} will need to provide that directly."

If reaching voicemail:
Leave patient name, reason for calling, and callback number. Keep health details minimal for privacy.

Important: Never speculate about medical conditions. Only relay information explicitly provided in your instructions.`;

const GENERAL_PROMPT = `You are Alfred, a versatile and personable British assistant making phone calls on behalf of {{user_name}}.

Your personality:
- Friendly and approachable with quiet confidence
- Adaptable to formal or casual contexts
- Naturally helpful without being obsequious
- Clear and articulate

Your task:
{{call_instructions}}

Calling: {{recipient_name}}

Approach:
1. Greet appropriately for the context
2. State your purpose clearly and concisely
3. Listen actively and respond thoughtfully
4. Adapt your tone to match the recipient (formal for businesses, warmer for personal calls)
5. Summarise any agreements or next steps before ending
6. Close graciously

If asked who you are:
"I'm Alfred, an AI assistant calling on behalf of {{user_name}}."

For personal calls:
- Be warm and genuine
- If leaving a voicemail, keep it brief but heartfelt
- Relay messages exactly as instructed

For business calls:
- Be professional and efficient
- Take note of any reference numbers or follow-up actions
- Confirm next steps

Remember: You are the voice of {{user_name}}'s household. Represent them with dignity and charm.`;

// ============ API Functions ============

function getApiKey(): string {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY environment variable is required. Add it to your .env file."
    );
  }
  return apiKey;
}

async function listVoices(): Promise<Voice[]> {
  const apiKey = getApiKey();

  const response = await fetch(
    `${ELEVENLABS_API_BASE}/v1/voices?page_size=100`,
    {
      headers: {
        "xi-api-key": apiKey,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list voices: ${error}`);
  }

  const data = (await response.json()) as VoicesResponse;
  return data.voices;
}

async function createAgent(config: AgentConfig): Promise<string> {
  const apiKey = getApiKey();

  const response = await fetch(
    `${ELEVENLABS_API_BASE}/v1/convai/agents/create`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create agent "${config.name}": ${error}`);
  }

  const data = (await response.json()) as CreateAgentResponse;
  return data.agent_id;
}

function findBritishVoice(voices: Voice[]): Voice | null {
  // Priority order for finding British voices
  const britishKeywords = ["british", "uk", "england", "english"];
  const preferredNames = [
    "george",
    "charlotte",
    "harry",
    "emily",
    "james",
    "daniel",
  ];

  // First, try to find a voice with British accent label
  for (const voice of voices) {
    const accent = voice.labels?.accent?.toLowerCase() ?? "";
    if (britishKeywords.some((keyword) => accent.includes(keyword))) {
      return voice;
    }
  }

  // Next, try voices with British-sounding names
  for (const voice of voices) {
    const name = voice.name.toLowerCase();
    if (preferredNames.some((prefName) => name.includes(prefName))) {
      return voice;
    }
  }

  // Fall back to first available voice
  return voices[0] ?? null;
}

// ============ Main Script ============

async function main() {
  console.log("ElevenLabs Voice Agent Setup\n");
  console.log("=".repeat(50));

  // Step 1: List available voices
  console.log("\n1. Fetching available voices...");
  const voices = await listVoices();
  console.log(`   Found ${voices.length} voices`);

  // Find British voices
  const britishVoices = voices.filter((v) => {
    const accent = v.labels?.accent?.toLowerCase() ?? "";
    return accent.includes("british") || accent.includes("uk");
  });

  if (britishVoices.length > 0) {
    console.log(`   Found ${britishVoices.length} British voices:`);
    for (const voice of britishVoices.slice(0, 5)) {
      console.log(`     - ${voice.name} (${voice.voice_id})`);
    }
  } else {
    console.log(
      "   No explicitly British voices found, will select best match"
    );
  }

  // Select voice to use
  const selectedVoice = findBritishVoice(voices);
  if (!selectedVoice) {
    throw new Error("No voices available in your ElevenLabs account");
  }
  console.log(
    `\n   Selected voice: ${selectedVoice.name} (${selectedVoice.voice_id})`
  );

  // Step 2: Create agents
  console.log("\n2. Creating voice agents...\n");

  const agents: {
    name: string;
    envVar: string;
    prompt: string;
    firstMessage: string;
  }[] = [
    {
      name: "alfred-restaurant",
      envVar: "ELEVENLABS_AGENT_RESTAURANT",
      prompt: RESTAURANT_PROMPT,
      firstMessage:
        "Good day, I'm calling to enquire about making a reservation, please.",
    },
    {
      name: "alfred-medical",
      envVar: "ELEVENLABS_AGENT_MEDICAL",
      prompt: MEDICAL_PROMPT,
      firstMessage: "Good day, I'm calling to schedule an appointment, please.",
    },
    {
      name: "alfred-general",
      envVar: "ELEVENLABS_AGENT_GENERAL",
      prompt: GENERAL_PROMPT,
      firstMessage: "Good day, I hope I haven't caught you at a bad time.",
    },
  ];

  const createdAgents: { name: string; envVar: string; agentId: string }[] = [];

  for (const agent of agents) {
    console.log(`   Creating ${agent.name}...`);

    const config: AgentConfig = {
      name: agent.name,
      conversation_config: {
        agent: {
          prompt: {
            prompt: agent.prompt,
          },
          first_message: agent.firstMessage,
          language: "en",
        },
        tts: {
          voice_id: selectedVoice.voice_id,
          model_id: "eleven_turbo_v2",
          stability: 0.6,
          similarity_boost: 0.75,
        },
      },
    };

    try {
      const agentId = await createAgent(config);
      createdAgents.push({ name: agent.name, envVar: agent.envVar, agentId });
      console.log(`   ✓ Created: ${agent.name} (${agentId})`);
    } catch (error) {
      console.error(`   ✗ Failed to create ${agent.name}:`, error);
      throw error;
    }
  }

  // Step 3: Output environment variables
  console.log("\n" + "=".repeat(50));
  console.log("\n3. Add these to your .env file:\n");

  for (const agent of createdAgents) {
    console.log(`${agent.envVar}=${agent.agentId}`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("\nSetup complete!");
  console.log("\nNext steps:");
  console.log("1. Copy the environment variables above to your .env file");
  console.log(
    "2. Configure webhooks for each agent in the ElevenLabs dashboard:"
  );
  console.log("   - URL: https://your-app-url.com/webhook/elevenlabs");
  console.log("   - Type: post_call_transcription");
  console.log("3. Run: bun run migrate");
  console.log("4. Restart your Alfred instance");
}

main().catch((error) => {
  console.error("\nSetup failed:", error);
  process.exit(1);
});
