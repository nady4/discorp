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
- \`/chat <agent> <message>\` — talk directly to an agent.
- \`/swarm <prompt> [agents] [merge]\` — parallel multi-agent session with CEO synthesis.
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
- \`/config provider\` — show the active AI provider and model.
- \`/config provider-set <provider> [model]\` — per-guild provider override.
- \`/config provider-clear\` — remove the per-guild override.
- \`/config channel <#channel>\` — where scheduled reports get posted.
- \`/config agents\` — reload agent definitions from disk.
- \`/config new-agent <id> <name> <role> <persona>\` — register a custom agent.

AI-costing commands (\`/chat\`, \`/assign\`, \`/review\`, \`/goals\`, \`/swarm\`) are rate-limited to 5 per user per minute.

**Modes**
- **Level 1 · Lightweight** — low cost, reactive, CEO/PM/Research only.
- **Level 2 · Standard** — collaborating company (adds CTO, Developer, QA) + scheduled daily reviews.
- **Level 3 · Autonomous** — full AI organization: all departments, background workers, continuous reviews.

**Agent tools** (declared per agent in \`agent.json\`)
- \`memory\` — long-term memory read/write · \`report\` — publish reports · \`filesystem\` — sandboxed workspace
- \`github\` — repo access · \`web_search\` — DuckDuckGo · \`linear\` · \`jira\` · \`notion\` · \`email\` · \`slack\` · \`delegation\` — ask another agent for help
`;

export const command: CommandModule = {
  data: new SlashCommandBuilder().setName("help").setDescription("Show DisCorp commands and usage"),
  async execute(interaction) {
    await interaction.editReply(HELP);
  },
};

export default command;
