# ElevenLabs Voice Calling Setup

This guide explains how to set up voice calling for Alfred using ElevenLabs Conversational AI.

## Prerequisites

1. **ElevenLabs Account** - Sign up at https://elevenlabs.io
2. **Twilio Account** - Sign up at https://twilio.com
3. **Phone Number** - Either:
   - Purchase a number from Twilio, OR
   - Verify your existing number as a Caller ID

## Setup Steps

### 1. Twilio Configuration

1. Log into Twilio Console
2. Navigate to Phone Numbers > Manage > Active numbers
3. Either purchase a new number or go to Verified Caller IDs to verify existing
4. Note your Account SID and Auth Token (found on dashboard)

### 2. ElevenLabs Agent Setup

Alfred uses **three specialized voice agents** to handle different call types. Each agent has a distinct personality optimized for its domain. All agents use British voices for consistency.

#### Voice Settings (All Agents)
- **Voice**: Select a British English voice (e.g., "George", "Charlotte", or similar)
- **Stability**: 0.5-0.7 (natural variation)
- **Similarity Enhancement**: 0.75
- **Style Exaggeration**: 0 (professional tone)

#### Agent 1: Restaurant Agent

**Name**: `alfred-restaurant`

**System Prompt**:
```
You are Alfred, a polite and efficient British assistant making restaurant reservations on behalf of {{user_name}}.

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

Remember: You represent {{user_name}}. Be the assistant they would be proud to have making calls on their behalf.
```

#### Agent 2: Medical Agent

**Name**: `alfred-medical`

**System Prompt**:
```
You are Alfred, a courteous and professional British assistant scheduling medical appointments on behalf of {{user_name}}.

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

Important: Never speculate about medical conditions. Only relay information explicitly provided in your instructions.
```

#### Agent 3: General Agent

**Name**: `alfred-general`

**System Prompt**:
```
You are Alfred, a versatile and personable British assistant making phone calls on behalf of {{user_name}}.

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

Remember: You are the voice of {{user_name}}'s household. Represent them with dignity and charm.
```

#### Creating the Agents

1. Log into ElevenLabs Dashboard
2. Go to Conversational AI > Agents
3. Create three agents using the prompts above
4. For each agent:
   - Select a British voice
   - Configure voice settings as specified
   - Enable post-call transcription
   - Note the Agent ID from agent settings

### 3. Import Phone Number

1. In ElevenLabs, go to Phone Numbers tab
2. Click "Import from Twilio"
3. Enter:
   - Label (e.g., "Alfred Main")
   - Phone Number (E.164 format, e.g., +15551234567)
   - Twilio Account SID
   - Twilio Auth Token
4. Click Import
5. Note the Phone Number ID from the settings

### 4. Configure Webhook

1. In ElevenLabs agent settings, find Webhooks section
2. Add a post-call webhook:
   - URL: `https://your-app-url.com/webhook/elevenlabs`
   - Type: `post_call_transcription`
3. Copy the webhook signing secret

### 5. Environment Variables

Add these to your `.env`:

```bash
# ElevenLabs API
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_PHONE_NUMBER_ID=your_phone_number_id_here
ELEVENLABS_WEBHOOK_SECRET=your_webhook_secret_here

# Specialized Voice Agents (at minimum, set ELEVENLABS_AGENT_GENERAL)
ELEVENLABS_AGENT_RESTAURANT=your_restaurant_agent_id
ELEVENLABS_AGENT_MEDICAL=your_medical_agent_id
ELEVENLABS_AGENT_GENERAL=your_general_agent_id

# Legacy (deprecated, use typed agents above)
# ELEVENLABS_AGENT_ID=your_agent_id_here
```

**Note**: If a specialized agent is not configured, calls will fall back to `ELEVENLABS_AGENT_GENERAL`. If that is also not set, it will fall back to the legacy `ELEVENLABS_AGENT_ID`.

### 6. Run Migration

```bash
bun run migrate
```

## Testing

1. Deploy your updated Alfred instance
2. In Telegram, ask Alfred to make a test call:
   > "Call my cell phone at +15551234567 and say hello"
3. You should receive a call within seconds
4. After the call, you'll get a notification in Telegram with the summary

## Usage Examples

### Restaurant Reservation
> "Call Carbone at +12125551234 and book a table for 2 on Saturday at 7pm under the name Blake"

### Appointment Confirmation
> "Call Dr. Smith's office at +15551234567 and confirm my appointment for tomorrow at 3pm"

### Personal Call
> "Call my mom at +15551234567 and wish her happy birthday"

## Troubleshooting

### Call not initiating
- Check ELEVENLABS_API_KEY is correct
- Verify phone number is properly imported in ElevenLabs
- Check server logs for API errors

### Webhook not receiving
- Verify APP_URL is publicly accessible
- Check ELEVENLABS_WEBHOOK_SECRET matches the one in ElevenLabs dashboard
- Look for signature validation errors in logs

### Notifications not sending
- Ensure telegram_group_id is set for the couple
- Check voice-call-notifications service is running (look for startup log)
- Verify the call status is "done" or "failed" in the database

### Call audio quality issues
- Check your ElevenLabs agent voice settings
- Consider adjusting stability and similarity enhancement settings

## Cost Considerations

ElevenLabs charges per minute for voice calls. Consider:
- Setting up usage alerts in ElevenLabs dashboard
- Implementing rate limiting if needed
- Monitoring call durations

## Security Notes

- The webhook endpoint validates HMAC-SHA256 signatures
- Signature timestamps are checked for freshness (30 min tolerance)
- Phone numbers are validated to E.164 format before calling
- Call transcripts are stored in your database
