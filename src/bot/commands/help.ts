import { SlashCommandBuilder } from "discord.js";
import type { CommandModule } from "./types.js";

const HELP = `# DisCorp — AI Organization for Discord

Your guild runs a virtual AI company. These are the commands:

**Organization**
- \`/goals add <title> [description]\` — add a new organization goal; the CEO and PM will analyze it and create tasks.
- \`/goals list\` — show all goals with status.
- \`/goals view <id>\` — show a goal's plan and tasks.

**Agents & tasks**
- \`/agents\` — list all available agents (role, responsibilities, tools).
- \`/assign new <title> <description> [agent]\` — create and execute a one-off task.
- \`/assign task <taskId> [agent]\` — (re)assign an existing task.

**Reviews**
- \`/review <type> [task] [title]\` — run a review: \`daily\`, \`project\`, \`code\`, \`strategy\`, \`security\`, \`performance\`.

**Intelligence & money**
- \`/status\` — organization state: mode, agents, goals, tasks, budget.
- \`/memory search <query>\` — search long-term memory. \`/memory recent\` — latest entries.
- \`/balance\` — daily, monthly and historic cost of running this organization.

**Administration** (bot owner or Manage Guild)
- \`/config mode <1|2|3>\` — organization intensity (1 lightweight · 2 standard · 3 autonomous).
- \`/config budget <usd>\` — max monthly spend for this guild.
- \`/config sleep <on|off> [agent]\` — put the whole org or one agent to sleep.
- \`/config wake [agent]\` — wake the org or an agent.
- \`/config channel <#channel>\` — where scheduled reports get posted.
- \`/config provider\` — show the active AI provider and model.
- \`/config agents\` — reload agent definitions from disk.
- \`/config new-agent <id> <name> <role> <persona>\` — register a custom agent.

**Modes**
- **Level 1 · Lightweight** — low cost, reactive, CEO/PM/Research only.
- **Level 2 · Standard** — collaborating company (adds CTO, Developer, QA) + scheduled daily reviews.
- **Level 3 · Autonomous** — full AI organization: all departments, background workers, continuous reviews.
`;

export const command: CommandModule = {
  data: new SlashCommandBuilder().setName("help").setDescription("Show DisCorp commands and usage"),
  async execute(interaction) {
    await interaction.editReply(HELP);
  },
};

export default command;
