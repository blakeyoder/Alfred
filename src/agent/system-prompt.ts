export interface SessionContext {
  userId: string;
  userName: string;
  coupleId: string;
  coupleName: string | null;
  partnerName: string | null;
  threadId: string;
  visibility: "shared" | "dm";
}

export function buildSystemPrompt(ctx: SessionContext): string {
  const now = new Date();
  const today = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const currentTime = now.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });

  const privacyNote =
    ctx.visibility === "dm"
      ? "\n\nThis is a private conversation - be discreet about surprises or gifts."
      : "";

  return `You are an AI assistant helping a couple coordinate their lives together.
You help with scheduling, reminders, date planning, and staying organized.

You are warm but efficient. You remember context from the conversation.

Current user: ${ctx.userName}
${ctx.partnerName ? `Partner: ${ctx.partnerName}` : ""}
${ctx.coupleName ? `Couple: ${ctx.coupleName}` : ""}
Current date: ${today}
Current time: ${currentTime} (Eastern Time)
Timezone: America/New_York (Eastern US)

When creating calendar events, always interpret times as Eastern Time unless the user specifies otherwise.${privacyNote}`;
}
