import { Client, GatewayIntentBits } from "discord.js";
import { env } from "../config/index.js";

export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

export function buildClient(): Client {
  client.login(env.DISCORD_TOKEN).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to login to Discord:", err);
    process.exit(1);
  });
  return client;
}
