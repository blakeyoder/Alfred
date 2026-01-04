import { Telegraf } from "telegraf";
import { registerAccountHandlers } from "./handlers/account.js";
import { registerAuthHandlers } from "./handlers/auth.js";
import { registerCalendarHandlers } from "./handlers/calendar.js";
import { registerPhoneHandlers } from "./handlers/phone.js";
import { registerGroupHandlers } from "./handlers/group.js";
import { registerHelpHandlers } from "./handlers/help.js";
import { registerMessageHandlers } from "./handlers/message.js";

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  // Register command handlers (order matters - commands before generic message handlers)
  registerAccountHandlers(bot); // /start, /link, /unlink, /status
  registerAuthHandlers(bot); // /auth
  registerCalendarHandlers(bot); // /calendar
  registerPhoneHandlers(bot); // /phone + contact sharing
  registerGroupHandlers(bot); // /setup
  registerHelpHandlers(bot); // /help

  // Register message handlers (must be last - catches all messages)
  registerMessageHandlers(bot);

  return bot;
}
