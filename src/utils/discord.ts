import { EmbedBuilder, Colors, type ChatInputCommandInteraction } from "discord.js";

export function successEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle(title)
    .setDescription(description ?? null)
    .setFooter({ text: "DisCorp" })
    .setTimestamp();
}

export function infoEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle(title)
    .setDescription(description ?? null)
    .setFooter({ text: "DisCorp" })
    .setTimestamp();
}

export function warnEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle(title)
    .setDescription(description ?? null)
    .setFooter({ text: "DisCorp" })
    .setTimestamp();
}

export function errorEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle(title)
    .setDescription(description ?? null)
    .setFooter({ text: "DisCorp" })
    .setTimestamp();
}

const MAX_CONTENT = 2000;

/** Send a long response split across multiple messages to respect Discord's 2k limit. */
export async function sendLong(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  if (content.length <= MAX_CONTENT) {
    await interaction.editReply({ content });
    return;
  }
  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > MAX_CONTENT) {
    let cut = remaining.lastIndexOf("\n", MAX_CONTENT);
    if (cut < 1000) cut = MAX_CONTENT;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  chunks.push(remaining);

  await interaction.editReply({ content: chunks.shift()! });
  for (const chunk of chunks) {
    await interaction.followUp({ content: chunk });
  }
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}
