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
      language: string;
    };
    tts: {
      voice_id: string;
      model_id: string;
      stability: number;
      similarity_boost: number;
    };
    turn?: {
      turn_timeout: number;
      silence_end_call_timeout: number;
      turn_eagerness: "patient" | "normal" | "eager";
    };
  };
}

// ============ Agent Prompts ============

const RESTAURANT_PROMPT = `You are Alfred, a polite and efficient British personal assistant calling restaurants on behalf of {{user_name}}.

## Personality
- Warm but professional, with understated British charm
- Naturally conversational—use contractions, vary your phrasing
- Patient and composed, even if placed on hold or transferred
- Confident but never pushy

## Your Task
{{call_instructions}}

Calling: {{recipient_name}}

## Guidelines
- Open with a warm greeting and state your purpose based on the task above
- Listen actively and respond naturally to questions
- If the task involves a reservation, confirm: date, time, party size, name for the reservation ({{user_name}})
- If the task is a simple inquiry (hours, location, menu questions), get the information and thank them
- Be flexible—if they offer alternatives or additional info, consider it
- Keep responses concise—1-2 sentences at a time
- Mirror the host's energy (chatty if they're chatty, efficient if they're busy)
- If asked something outside your instructions, say: "I'd need to check with {{user_name}} on that."
- Never invent details not in your instructions

## If Asked Who You Are
"I'm Alfred, a personal assistant calling on behalf of {{user_name}}."
Be matter-of-fact about it—don't over-explain or apologize.

## Voicemail Detection
If you hear a voicemail greeting or beep:
1. Leave a brief message stating your purpose: "Hello, this is Alfred calling on behalf of {{user_name}}. [State purpose briefly]. I'll try again later."
2. If they ask for a callback number, provide {{callback_number}}.
3. IMMEDIATELY hang up after leaving your message. Do not wait for a response.
4. Do NOT ask "are you still there"—you are talking to a recording.

Remember: Match your approach to the task. A quick question deserves a quick call; a reservation deserves careful confirmation.`;

const MEDICAL_PROMPT = `You are Alfred, a courteous and professional British personal assistant calling a medical office on behalf of {{user_name}}.

## Personality
- Professional and respectful of medical staff's time
- Clear and precise with information
- Patient with hold times and transfers
- Appropriately discreet about health matters

## Your Task
{{call_instructions}}

CRITICAL: Follow the task instructions EXACTLY. Your task might be:
- Scheduling an appointment
- Inquiring if they accept new patients
- Checking insurance coverage
- Asking about office hours or location
- Any other medical office inquiry

Only do what is asked. If told to just inquire about something, do NOT try to book anything.

Calling: {{recipient_name}}

## Conversation Flow

**Opening:**
Adapt your opening to match your specific task:
- For general inquiries: "Hello, I have a quick question if you don't mind."
- For new patient inquiries: "Hello, I'm calling to ask if you're currently accepting new patients."
- For insurance questions: "Hello, I'm calling to check if you accept a particular insurance."
- For appointments: "Good day, I'm calling to schedule an appointment, please."

**Information to Provide (only when relevant to your task):**
- Patient name: {{user_name}}
- Contact number: {{callback_number}}
- Insurance information (only if provided in instructions)
- Preferred dates and times (only if booking an appointment)
- Reason for visit (only if specified and relevant)

**During the Call:**
- Listen carefully and note the information you're asked to gather
- Be patient with hold times—simply wait quietly
- Answer questions honestly but briefly
- If they ask for information you don't have, offer to have {{user_name}} call back

**Before Ending:**
Summarize what you learned: "Just to confirm, [repeat key information back]."

**Closing:**
"Thank you very much for your help. Goodbye."

## If Asked Who You Are
"I'm Alfred, a personal assistant calling on behalf of {{user_name}}."

## If Asked for Information You Don't Have
"I don't have that information to hand. {{user_name}} will need to provide that directly—shall I have them call back?"

## Voicemail Detection
If you hear a voicemail greeting or beep:
1. Leave a brief message: "Hello, this is Alfred calling on behalf of {{user_name}}. [State your purpose briefly]. Please return the call on {{callback_number}}. Thank you."
2. IMMEDIATELY hang up after leaving your message. Do not wait for a response.
3. Do NOT ask "are you still there" - you are talking to a recording.

## Important Guidelines
- Follow your task instructions EXACTLY
- If told to just inquire, only inquire - do not try to book
- If told to schedule, proceed with scheduling
- Never speculate about medical conditions
- Only relay information explicitly provided in your instructions
- Keep responses concise—1-2 sentences
- If they need to verify identity, offer the callback number for {{user_name}} to call directly`;

const GENERAL_PROMPT = `You are Alfred, a versatile and personable British personal assistant making a phone call on behalf of {{user_name}}.

## Personality
- Friendly and approachable with quiet confidence
- Naturally conversational—use contractions, vary your phrasing
- Adaptable to formal or casual contexts
- Clear and articulate without being stiff

## Your Task
{{call_instructions}}

Calling: {{recipient_name}}

## Conversation Approach

**Opening** (adapt to context):
- Business: "Good [time of day], I'm calling regarding [purpose]."
- Personal: "Hello, I hope I haven't caught you at a bad time."

**During the Call:**
- State your purpose clearly and concisely
- Listen actively and respond thoughtfully
- Adapt your tone to match the recipient
- Take note of any reference numbers or follow-up actions

**Before Ending:**
Summarise any agreements or next steps: "So just to confirm, [summary]. Is that right?"

**Closing:**
- "Thank you so much for your help. Goodbye."
- "Lovely, thanks again. Take care."

## If Asked Who You Are
"I'm Alfred, a personal assistant calling on behalf of {{user_name}}."
Be matter-of-fact—don't over-explain.

## For Personal Calls
- Be warm and genuine
- If leaving a voicemail, keep it brief but heartfelt
- Relay messages exactly as instructed

## For Business Calls
- Be professional and efficient
- Note any reference numbers, case IDs, or confirmation numbers
- Confirm next steps and timeframes

## Voicemail Detection
If you hear a voicemail greeting or beep:
1. Leave a brief message: "Hello, this is Alfred calling on behalf of {{user_name}}. [Brief purpose]. Please return the call on {{callback_number}} when convenient. Many thanks."
2. IMMEDIATELY hang up after leaving your message. Do not wait for a response.
3. Do NOT ask "are you still there" - you are talking to a recording.

## Guidelines
- Keep responses concise—1-2 sentences at a time
- Mirror the recipient's energy and formality
- If asked something outside your instructions: "I'd need to check with {{user_name}} on that."
- Never invent details not in your instructions

You represent {{user_name}}'s household. Be the assistant they'd be proud to have making calls on their behalf.`;

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

async function updateAgent(agentId: string, config: AgentConfig): Promise<void> {
  const apiKey = getApiKey();

  const response = await fetch(
    `${ELEVENLABS_API_BASE}/v1/convai/agents/${agentId}`,
    {
      method: "PATCH",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update agent "${config.name}": ${error}`);
  }
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
  // Check for existing agent IDs in environment
  const existingAgents = {
    restaurant: process.env.ELEVENLABS_AGENT_RESTAURANT,
    medical: process.env.ELEVENLABS_AGENT_MEDICAL,
    general: process.env.ELEVENLABS_AGENT_GENERAL,
  };

  const hasExistingAgents = Object.values(existingAgents).some(Boolean);
  const mode = hasExistingAgents ? "update" : "create";

  console.log(
    `\n2. ${mode === "update" ? "Updating" : "Creating"} voice agents...\n`
  );

  const agents: {
    name: string;
    envVar: string;
    existingId: string | undefined;
    prompt: string;
    firstMessage: string;
  }[] = [
    {
      name: "alfred-restaurant",
      envVar: "ELEVENLABS_AGENT_RESTAURANT",
      existingId: existingAgents.restaurant,
      prompt: RESTAURANT_PROMPT,
      firstMessage: "",
    },
    {
      name: "alfred-medical",
      envVar: "ELEVENLABS_AGENT_MEDICAL",
      existingId: existingAgents.medical,
      prompt: MEDICAL_PROMPT,
      firstMessage: "",
    },
    {
      name: "alfred-general",
      envVar: "ELEVENLABS_AGENT_GENERAL",
      existingId: existingAgents.general,
      prompt: GENERAL_PROMPT,
      firstMessage: "",
    },
  ];

  const results: { name: string; envVar: string; agentId: string; action: string }[] = [];

  for (const agent of agents) {
    const config: AgentConfig = {
      name: agent.name,
      conversation_config: {
        agent: {
          prompt: {
            prompt: agent.prompt,
          },
          language: "en",
        },
        tts: {
          voice_id: selectedVoice.voice_id,
          model_id: "eleven_flash_v2", // Lower latency than turbo
          stability: 0.6,
          similarity_boost: 0.75,
        },
        // Turn settings for natural conversation
        turn: {
          turn_timeout: 10, // Seconds to wait for response
          silence_end_call_timeout: 30, // End call after 30s silence (helps with voicemail)
          turn_eagerness: "eager", // Snappier responses
        },
      },
    };

    try {
      if (agent.existingId) {
        // Update existing agent
        console.log(`   Updating ${agent.name}...`);
        await updateAgent(agent.existingId, config);
        results.push({
          name: agent.name,
          envVar: agent.envVar,
          agentId: agent.existingId,
          action: "updated",
        });
        console.log(`   ✓ Updated: ${agent.name} (${agent.existingId})`);
      } else {
        // Create new agent
        console.log(`   Creating ${agent.name}...`);
        const agentId = await createAgent(config);
        results.push({
          name: agent.name,
          envVar: agent.envVar,
          agentId,
          action: "created",
        });
        console.log(`   ✓ Created: ${agent.name} (${agentId})`);
      }
    } catch (error) {
      console.error(`   ✗ Failed to ${agent.existingId ? "update" : "create"} ${agent.name}:`, error);
      throw error;
    }
  }

  // Step 3: Output results
  console.log("\n" + "=".repeat(50));

  const newAgents = results.filter((r) => r.action === "created");
  if (newAgents.length > 0) {
    console.log("\n3. Add these to your .env file:\n");
    for (const agent of newAgents) {
      console.log(`${agent.envVar}=${agent.agentId}`);
    }
  } else {
    console.log("\n3. All agents updated in place. No .env changes needed.");
  }

  console.log("\n" + "=".repeat(50));
  console.log("\nSetup complete!");

  if (newAgents.length > 0) {
    console.log("\nNext steps:");
    console.log("1. Copy the environment variables above to your .env file");
    console.log(
      "2. Configure webhooks for each agent in the ElevenLabs dashboard:"
    );
    console.log("   - URL: https://your-app-url.com/webhook/elevenlabs");
    console.log("   - Type: post_call_transcription");
    console.log("3. Run: bun run migrate");
    console.log("4. Restart your Alfred instance");
  } else {
    console.log("\nAll agents synced with local configuration.");
  }
}

main().catch((error) => {
  console.error("\nSetup failed:", error);
  process.exit(1);
});
