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

1. Log into ElevenLabs Dashboard
2. Go to Conversational AI > Agents
3. Create a new agent with this system prompt:

```
You are Alfred, a helpful AI assistant making phone calls on behalf of a couple.

## Restaurant Reservations
- Greet politely: "Hi, I'm calling to make a reservation"
- Provide: date, time, party size, name from {{call_instructions}}
- Confirm details before ending

## Appointment Confirmations
- State the appointment details
- Ask if still confirmed
- Note any changes

## Personal Calls
- Be warm and friendly
- Deliver the message from {{call_instructions}}
- If voicemail, leave a brief message

Always:
- Be patient and polite
- If asked, explain you're an AI assistant calling on behalf of {{user_name}}
- Speak naturally
```

4. Configure the agent voice and other settings as desired
5. Note the Agent ID from the agent settings

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
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_AGENT_ID=your_agent_id_here
ELEVENLABS_PHONE_NUMBER_ID=your_phone_number_id_here
ELEVENLABS_WEBHOOK_SECRET=your_webhook_secret_here
```

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
