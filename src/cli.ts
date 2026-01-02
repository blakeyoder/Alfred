import "dotenv/config";
import * as readline from "readline";
import { ModelMessage } from "ai";
import { chat, SessionContext } from "./agent/index.js";
import { loadSession, saveSession, Session } from "./session/store.js";
import { getUserByEmail, getUserById } from "./db/queries/users.js";
import { getCoupleForUser, getPartner } from "./db/queries/couples.js";
import { getThreadsForUser, getThreadById } from "./db/queries/threads.js";
import {
  getRecentMessagesForContext,
  saveMessage,
  Message,
} from "./db/queries/messages.js";
import { closeConnection } from "./db/client.js";
import {
  initiateDeviceFlow,
  completeDeviceFlow,
  storeTokens,
  hasGoogleAuth,
} from "./integrations/google-auth.js";

interface CLIState {
  session: Session | null;
  context: SessionContext | null;
  history: ModelMessage[];
  partnerId: string | null;
}

const state: CLIState = {
  session: null,
  context: null,
  partnerId: null,
  history: [],
};

async function initializeSession(): Promise<boolean> {
  // Try to load existing session
  let session = await loadSession();

  if (!session) {
    // Default to blake@example.com for demo
    const user = await getUserByEmail("blake@example.com");
    if (!user) {
      console.log("No demo data found. Run: npm run seed:demo");
      return false;
    }

    const couple = await getCoupleForUser(user.id);
    if (!couple) {
      console.log("No couple found for user.");
      return false;
    }

    const threads = await getThreadsForUser(user.id);
    const sharedThread = threads.find((t) => t.visibility === "shared");
    if (!sharedThread) {
      console.log("No shared thread found.");
      return false;
    }

    session = {
      userId: user.id,
      coupleId: couple.id,
      activeThreadId: sharedThread.id,
      visibility: "shared",
    };

    await saveSession(session);
  }

  state.session = session;
  await refreshContext();
  return true;
}

async function refreshContext(): Promise<void> {
  if (!state.session) return;

  const user = await getUserById(state.session.userId);
  const couple = await getCoupleForUser(state.session.userId);
  const partner = couple
    ? await getPartner(couple.id, state.session.userId)
    : null;
  const thread = await getThreadById(state.session.activeThreadId);

  if (!user || !couple || !thread) {
    console.log("Failed to load session context.");
    return;
  }

  state.context = {
    userId: user.id,
    userName: user.name,
    coupleId: couple.id,
    coupleName: couple.name,
    partnerName: partner?.name ?? null,
    threadId: thread.id,
    visibility: thread.visibility,
  };

  state.partnerId = partner?.id ?? null;

  // Load conversation history from DB
  await loadHistoryFromDb();
}

function dbMessageToModelMessage(msg: Message): ModelMessage {
  return {
    role: msg.role as "user" | "assistant",
    content: msg.content ?? "",
  };
}

async function loadHistoryFromDb(): Promise<void> {
  if (!state.session) return;

  const messages = await getRecentMessagesForContext(
    state.session.activeThreadId,
    50
  );

  // Filter to only user and assistant messages for context
  state.history = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map(dbMessageToModelMessage);
}

function printWelcome(): void {
  console.log("\n🎩 Alfred (dev mode)");
  if (state.context) {
    console.log(`Logged in as: ${state.context.userName}`);
    console.log(`Couple: ${state.context.coupleName ?? "Unnamed"}`);
    console.log(`Thread: ${state.context.visibility}`);
  }
  console.log("\nType /help for commands, /exit to quit\n");
}

async function handleCommand(input: string): Promise<boolean> {
  const [cmd, ...args] = input.slice(1).split(" ");

  switch (cmd) {
    case "help":
      console.log("\nCommands:");
      console.log("  /help            - Show this help");
      console.log("  /clear           - Clear conversation history");
      console.log("  /history         - Show recent messages");
      console.log("  /whoami          - Show current user/couple");
      console.log("  /switch-user <email> - Change identity");
      console.log("  /threads         - List and switch threads");
      console.log("  /auth google     - Connect Google Calendar");
      console.log("  /exit            - Quit\n");
      return true;

    case "clear":
      state.history = [];
      console.log("Conversation cleared.\n");
      return true;

    case "history":
      if (state.history.length === 0) {
        console.log("No messages in history.\n");
      } else {
        console.log("\nRecent messages:");
        for (const msg of state.history.slice(-10)) {
          const role = msg.role === "user" ? "You" : "EA";
          const content =
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content);
          console.log(`  ${role}: ${content.slice(0, 100)}...`);
        }
        console.log();
      }
      return true;

    case "whoami":
      if (state.context && state.session) {
        console.log(`\nUser: ${state.context.userName}`);
        console.log(`Couple: ${state.context.coupleName ?? "Unnamed"}`);
        console.log(`Partner: ${state.context.partnerName ?? "None"}`);
        console.log(`Thread: ${state.context.visibility}`);
        console.log(`Thread ID: ${state.session.activeThreadId}\n`);
      } else {
        console.log("No active session.\n");
      }
      return true;

    case "switch-user": {
      const email = args[0];
      if (!email) {
        console.log("Usage: /switch-user <email>\n");
        return true;
      }

      const user = await getUserByEmail(email);
      if (!user) {
        console.log(`User not found: ${email}\n`);
        return true;
      }

      const couple = await getCoupleForUser(user.id);
      if (!couple) {
        console.log("No couple found for user.\n");
        return true;
      }

      const threads = await getThreadsForUser(user.id);
      const sharedThread = threads.find((t) => t.visibility === "shared");
      if (!sharedThread) {
        console.log("No shared thread found.\n");
        return true;
      }

      state.session = {
        userId: user.id,
        coupleId: couple.id,
        activeThreadId: sharedThread.id,
        visibility: "shared",
      };
      await saveSession(state.session);
      await refreshContext();
      state.history = [];

      console.log(`Switched to: ${user.name} (${user.email})\n`);
      return true;
    }

    case "threads": {
      if (!state.session) {
        console.log("No active session.\n");
        return true;
      }

      const threads = await getThreadsForUser(state.session.userId);
      console.log("\nAvailable threads:");
      threads.forEach((t, i) => {
        const active = t.id === state.session?.activeThreadId ? " (active)" : "";
        console.log(`  ${i + 1}. ${t.visibility}${active}`);
      });
      console.log("\nTo switch, use: /thread <number>\n");
      return true;
    }

    case "thread": {
      const num = parseInt(args[0], 10);
      if (!state.session || isNaN(num)) {
        console.log("Usage: /thread <number>\n");
        return true;
      }

      const threads = await getThreadsForUser(state.session.userId);
      const thread = threads[num - 1];
      if (!thread) {
        console.log("Invalid thread number.\n");
        return true;
      }

      state.session.activeThreadId = thread.id;
      state.session.visibility = thread.visibility;
      await saveSession(state.session);
      await refreshContext();
      state.history = [];

      console.log(`Switched to: ${thread.visibility} thread\n`);
      return true;
    }

    case "auth": {
      const service = args[0];
      if (service !== "google") {
        console.log("Usage: /auth google\n");
        return true;
      }

      if (!state.session) {
        console.log("No active session.\n");
        return true;
      }

      // Check if already authenticated
      const hasAuth = await hasGoogleAuth(state.session.userId);
      if (hasAuth) {
        console.log("Already connected to Google. Use /auth revoke to disconnect.\n");
        return true;
      }

      try {
        console.log("\nInitiating Google authentication...\n");

        const flow = await initiateDeviceFlow();

        console.log("To authorize, visit:");
        console.log(`  ${flow.verificationUrl}`);
        console.log(`\nEnter code: ${flow.userCode}\n`);
        console.log("Waiting for authorization (press Ctrl+C to cancel)...\n");

        const tokens = await completeDeviceFlow(
          flow.deviceCode,
          flow.interval,
          flow.expiresIn,
          (msg) => console.log(`  ${msg}`)
        );

        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
        const scopes = tokens.scope.split(" ");

        await storeTokens(
          state.session.userId,
          tokens.access_token,
          tokens.refresh_token,
          expiresAt,
          scopes
        );

        console.log("\nGoogle Calendar connected successfully!\n");
      } catch (error) {
        if (error instanceof Error) {
          console.log(`\nAuth failed: ${error.message}\n`);
        } else {
          console.log("\nAuth failed.\n");
        }
      }
      return true;
    }

    case "exit":
      return false;

    default:
      console.log(`Unknown command: ${cmd}\n`);
      return true;
  }
}

async function handleMessage(input: string): Promise<void> {
  if (!state.context || !state.session) {
    console.log("No active session.\n");
    return;
  }

  try {
    // Save user message to DB
    await saveMessage(
      state.session.activeThreadId,
      "user",
      input,
      state.session.userId
    );

    const result = await chat(input, {
      context: state.context,
      history: state.history,
      partnerId: state.partnerId,
    });

    // Save assistant response to DB
    await saveMessage(state.session.activeThreadId, "assistant", result.text);

    // Add messages to in-memory history
    state.history.push({ role: "user", content: input });
    state.history.push({ role: "assistant", content: result.text });

    console.log(`\nEA: ${result.text}\n`);
  } catch (error) {
    if (error instanceof Error) {
      console.log(`\nError: ${error.message}\n`);
    } else {
      console.log("\nAn error occurred.\n");
    }
  }
}

async function main(): Promise<void> {
  const initialized = await initializeSession();
  if (!initialized) {
    await closeConnection();
    process.exit(1);
  }

  printWelcome();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed.startsWith("/")) {
        const shouldContinue = await handleCommand(trimmed);
        if (!shouldContinue) {
          console.log("Bye!");
          rl.close();
          await closeConnection();
          process.exit(0);
        }
      } else {
        await handleMessage(trimmed);
      }

      prompt();
    });
  };

  rl.on("close", async () => {
    console.log("\nBye!");
    await closeConnection();
    process.exit(0);
  });

  prompt();
}

main().catch(async (error) => {
  console.error("CLI error:", error);
  await closeConnection();
  process.exit(1);
});
