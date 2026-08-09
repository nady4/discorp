<h1 align="center"> 💼 DisCorp </h1>

<p align="center">
🤖 Open-source AI organization orchestration framework for Discord. Turn any Discord server into a virtual AI company — a team of specialized agents (CEO, CTO, PM, Developer, QA, Research, Security, Marketing, Finance, Community) working toward your goals with their own memory, tools, and reports. Built with Node.js, TypeScript, Discord.js, PostgreSQL + pgvector, Redis, and BullMQ — self-hosted with Docker on your own VPS, running on your own AI keys (BYOK).
</p>

<br>

## ✨ Features

### 🏢 Simulated organization

- **Specialized agents with real roles** — every agent has a role, responsibilities, personality, tools, and permissions. The roster is data, not code: definitions live in `agent.json` files that anyone can edit or add to.
- **Three intensity modes** — Lightweight (L1 · <$5/mo · CEO/PM/Research, reactive), Standard (L2 · $10–50/mo · +CTO/Developer/QA, scheduled reviews), Autonomous (L3 · $50–500+/mo · all departments, background workers, continuous reviews). Set per server with `/config mode <1|2|3>`.
- **Multi-guild** — one bot instance serves many Discord servers; each server is its own organization with its own mode, budget, agents, memory, and provider overrides.

### 🎯 Goals & orchestration

- **Goal-driven work** — `/goals add "I want to build a SaaS app"` → the CEO produces a strategy → the PM breaks it into 3–8 concrete tasks with priorities and owner agents → tasks are routed and executed by the best-matching agent.
- **Keyword-scored task routing** — `routeTask` scores task text against each agent's domain vocabulary (architecture → CTO, implement → Developer, test → QA, audit → Security, …) with a PM fallback.
- **Workflow state machine** — goals move PENDING → ANALYZING → IN_PROGRESS ⇄ REVIEWING → COMPLETED | FAILED; a goal auto-completes when all its tasks are done.
- **One-off assignments** — `/assign new <title> <description> [agent]` creates, routes, and executes a task in a single command.

### 🔍 Reviews

- **Six review types** — `/review daily | project | code | strategy | security | performance`, optionally scoped to a task.
- **Agent-to-agent collaboration** — a lead agent produces findings, then participants (CTO+QA for code, Security+CTO for security, PM+Finance for strategy, …) do a second-pass critique. Participant depth scales with org level (L1: lead only, L2: lead + 1, L3: all).
- **Persistent reports** — every review is stored as a `Report`, retrievable via `/memory` and cited as context by future agent runs.

### 🧠 Memory

- **Two-tier memory** — short-term rolling context per guild+agent in Redis (24 h TTL, capped), and long-term semantic memory in PostgreSQL with **pgvector embeddings**.
- **Semantic retrieval** — agents search memory with `memory_search` before answering; you can inspect everything with `/memory search <query>` and `/memory recent`.
- **Agent-learned knowledge** — agents store facts, decisions, and lessons via the `memory_store` tool as they work; embedding provider is configurable (openai / ollama / gemini).

### 🔌 BYOK provider abstraction

- **One interface, four adapters** — `IProvider`/`IEmbedder` with OpenAI-compatible (OpenAI, DeepSeek, OpenRouter, Together, Groq, any `/v1` gateway), Anthropic, Gemini, and local Ollama.
- **Never hardcoded keys** — everything comes from `AI_PROVIDER` / `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` (+ optional per-guild override stored in the database for advanced setups).
- **Tool calling normalized per vendor** — the executor drives a tool loop whose assistant/tool messages are mapped to native OpenAI `tool_calls`, Anthropic `tool_use`, and Gemini `functionCall` shapes.
- **Sandboxed tool suite** — filesystem (confined to a workspace volume with path-traversal protection), GitHub (optional `GITHUB_TOKEN`), web search (DuckDuckGo, no key), memory read/write, and report publishing — all opt-in per agent via `agent.json`.

### 💰 Safety & cost controls

- **Full audit trail** — every AI call becomes an `AgentExecution` row (model, input/output tokens, estimated USD, kind); aggregated into day/month `UsageSummary` rows.
- **Budget & rate caps** — monthly budget (`/config budget <usd>`), daily execution cap, per-execution token cap (2 048 for L1 guilds), all enforced by a `CostGuard` before every execution.
- **Sleep mode** — `/config sleep on` pauses the whole org (scheduled jobs are removed); `/config sleep on agent:dev` naps one agent for 12 hours.
- **Pricing table with fallbacks** — `src/config/models.ts` holds USD-per-1M-token estimates for the common models; unknown models fall back to `FALLBACK_COST_PER_1M_*`.
- **`/balance`** — today, this month, and all-time cost + tokens + top agents by spend.

### 🧩 Custom agents (no code)

- Drop an `agent.json` into `agents/definitions/` (volume-mounted in Docker) and reload with `/config agents` — or create one from Discord with `/config new-agent`.
- `{ "name", "role", "responsibilities", "tools", "permissions", "persona", "modeMin" }` — the file name becomes the agent id.

### 🐳 Ops

- **Docker-first** — `postgres` (pgvector), `redis`, `migrate`, `bot`, `worker` compose services with healthchecks and an automatic `prisma migrate deploy` on boot.
- **Separate worker process** — BullMQ workers run scheduled reviews and autonomous sessions; the scheduler reconciles cron jobs per guild mode and pauses them during sleep mode.
- **Observable** — pino structured logging, graceful shutdown, zero hardcoded secrets.

<br>

## 🛠️ Tech stack

| Area           | Technology                                                                 |
| -------------- | -------------------------------------------------------------------------- |
| Language       | TypeScript (strict)                                                        |
| Discord        | Discord.js 14 (slash commands, guild events)                               |
| Database       | PostgreSQL 16 + Prisma ORM + pgvector                                      |
| Cache & queues | Redis + BullMQ                                                             |
| AI clients     | `openai` SDK (compatible adapters) · `@anthropic-ai/sdk` · `@google/genai` |
| Config         | `zod`-validated environment                                                |
| Logging        | pino + pino-pretty                                                         |
| Tests          | vitest                                                                     |
| Runtime        | Node.js ≥ 20 (Docker image: `node:20-alpine`)                              |

<br>

## 🏗️ Architecture

```
Discord (users)
      │  slash commands / events
      ▼
┌──────────────────────── BOT PROCESS (discord.js v14) ────────────────────────┐
│  Command router  (help · goals · review · agents · assign · status ·        │
│                   memory · config · balance)                                │
│   ├─ Orchestrator     goal intake → CEO strategy → PM task breakdown →      │
│   │                   routing → execution                                   │
│   ├─ Workflow         goal ⇄ review state machine, auto-completion          │
│   ├─ Review engine    lead agent + participants (agent-to-agent)            │
│   ├─ Agent framework  registry (agent.json) + executor (persona + tools)    │
│   └─ Memory           short-term (Redis TTL) + long-term (pgvector)         │
└───────────────┬──────────────────────────────────┬──────────────────────────┘
                ▼                                  ▼
┌──────────────────────── PROVIDER ABSTRACTION ──────────────────────┐
│  IProvider: chat() + tool calls  ·  IEmbedder: embed()              │
│  openai-compatible │ anthropic │ gemini │ ollama                    │
│  factory from env: AI_PROVIDER, AI_BASE_URL, AI_API_KEY, AI_MODEL   │
│  every call metered → AgentExecution → /balance aggregates          │
└───────────────┬──────────────────────────────────┬──────────────────┘
                ▼                                  ▼
┌──────────────── PostgreSQL ─────────────────┐  ┌────────── Redis ──────────┐
│ org state, goals, tasks, reviews, reports,   │  │ short-term memory, BullMQ │
│ executions, memory embeddings, usage sums    │  │ queues + scheduled jobs   │
└──────────────────────────────────────────────┘  └───────────────────────────┘
                │
                ▼
┌──────────────────────── WORKER PROCESS (separate container) ────────┐
│  ReviewWorker       scheduled reviews → reports posted to Discord   │
│  AutonomousWorker   proactive sessions (Level 3)                    │
│  Scheduler          cron per guild mode: daily review · 6h sessions │
└─────────────────────────────────────────────────────────────────────┘
```

### 🔍 Notable implementation details

- **Agents are data, not code** — `src/agents/registry.ts` loads and zod-validates every `agent.json` from `AGENTS_DIR`, syncs it into the `Agent` catalog, and exposes `activeAtLevel()` so org mode gates which agents exist per guild.
- **Vendor-normalized tool loop** — `AgentExecutor` runs up to 6 tool rounds per execution; each adapter maps the normalized assistant/tool messages back to its native API shape (OpenAI `tool_calls` + `tool_call_id`, Anthropic `tool_use` + `tool_result`, Gemini `functionCall` + `functionResponse`).
- **Everything is audited** — `recordExecution` writes the execution row and increments DAY/MONTH `UsageSummary` in a single transaction; `CostGuard` reads those aggregates to block over-budget runs before they start.
- **Raw SQL only where needed** — pgvector similarity (`embedding <=> $1`) runs through a dedicated `pg` pool (`src/database/vector.ts`); Prisma handles everything else.
- **Sleep mode reaches the scheduler** — `/config sleep` flips `Guild.sleepMode`, and the hourly `syncSchedules()` reconciliation removes/adds the guild's repeatable BullMQ jobs accordingly.

<br>

## 🚀 Getting started

### 📋 Prerequisites

- A Linux VPS (2 GB RAM is plenty for L1/L2), with Docker + Docker Compose.
- A [Discord bot token](https://discord.com/developers/applications).
- An AI provider API key (DeepSeek, OpenAI, Anthropic, Gemini — or a local Ollama, which needs none).

### 🤖 Discord bot setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** → Reset Token → copy it.
3. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; permissions `Send Messages`, `Embed Links`, `Read Message History` (add `Manage Guild` if you want `/config` to honor the permission check).
4. Invite the bot to your server. Commands register automatically on boot (a few seconds).
5. Run `/help` in your server.

Admins are your Discord IDs in `ADMIN_USER_IDS` (comma-separated) — or anyone with the **Manage Guild** permission.

### 🔑 Environment setup

```sh
git clone https://github.com/<you>/discorp.git
cd discorp
cp .env.example .env
```

**DeepSeek (OpenAI-compatible):**

```env
DISCORD_TOKEN=your-discord-token
AI_PROVIDER=openai
AI_API_KEY=sk-xxxxxxxx
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-v4-flash-0731
```

**Any OpenAI-compatible gateway (OpenRouter, Together, Groq, …)** — same as above, swap `AI_BASE_URL` / `AI_MODEL`.

**Anthropic / Gemini** — `AI_PROVIDER=anthropic|gemini` + `AI_API_KEY` + `AI_MODEL`. Anthropic has no embeddings API, so pair it with `AI_EMBEDDING_PROVIDER=openai`.

**Local Ollama (free)** — `AI_PROVIDER=ollama` + `AI_MODEL=llama3.1` + `AI_EMBEDDING_PROVIDER=ollama`. In Docker, point at the host: `AI_BASE_URL=http://host.docker.internal:11434/v1` (add `extra_hosts: ["host.docker.internal:host-gateway"]` to the bot/worker services on Linux).

### 🐳 Deploy with Docker

```sh
docker compose up -d --build
docker compose logs -f bot
```

The `migrate` service applies `prisma migrate deploy` (including the pgvector extension) before the bot and worker start. Custom agents live in `./agents/` and the sandboxed workspace in `./data/` — both persist on the host via volumes.

### 💻 Local development

```sh
npm install
npx prisma generate
docker compose up -d postgres redis     # or use your own Postgres/Redis
npx prisma migrate dev
npm run dev                              # bot + scheduler
npm run dev:worker                       # bullmq workers (second terminal)
```

<br>

## 📜 Scripts

| Command                 | Description                       |
| ----------------------- | --------------------------------- |
| `npm run dev`           | Start bot + scheduler (tsx watch) |
| `npm run dev:worker`    | Start BullMQ workers (tsx watch)  |
| `npm run build`         | Compile TypeScript to `dist/`     |
| `npm start`             | Run the compiled bot              |
| `npm run start:worker`  | Run the compiled workers          |
| `npm run typecheck`     | Strict TypeScript check           |
| `npm test`              | Run vitest suites                 |
| `npm run prisma:deploy` | Apply migrations to the database  |

<br>

## 📖 Command reference

| Command                                                                                                                   | What it does                                               |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `/help`                                                                                                                   | Overview of all commands                                   |
| `/goals add <title> [description]`                                                                                        | New goal → CEO analysis → PM task breakdown                |
| `/goals list` · `/goals view <id>` · `/goals complete <id>`                                                               | Track the org's goals                                      |
| `/assign new <title> <description> [agent]`                                                                               | One-off task, executed immediately                         |
| `/assign task <taskId> [agent]`                                                                                           | (Re)assign an existing task                                |
| `/review <type> [task] [title]`                                                                                           | daily · project · code · strategy · security · performance |
| `/agents`                                                                                                                 | Roster: roles, responsibilities, tools, active/sleeping    |
| `/status`                                                                                                                 | Mode, goals, tasks, agents, budget, today's usage          |
| `/memory search <q>` · `/memory recent` · `/memory remove <id>`                                                           | Inspect stored knowledge                                   |
| `/config mode <1\|2\|3>` · `budget <usd>` · `sleep on/off [agent]` · `channel <#c>` · `provider` · `agents` · `new-agent` | Admin configuration                                        |
| `/balance`                                                                                                                | Today, month, all-time cost + tokens                       |

<br>

## 📝 Notes

- **BYOK scope** — the provider comes from the environment (the self-hoster's key). An optional per-guild override (`Guild.providerOverrides` JSON: `provider`, `apiKey`, `baseUrl`, `model`, `temperature`, `maxTokens`) exists for advanced multi-tenant setups; `/config provider` shows what's active. Keys stored in the DB are the self-hoster's responsibility.
- **Embedding dimension** — `AI_EMBEDDING_DIM` (default 1024) must match the `vector(1024)` column in `prisma/migrations/0001_init/migration.sql`. Changing it requires a new migration.
- **Prices are estimates** — `/balance` uses the pricing table in `src/config/models.ts`; unknown models fall back to `FALLBACK_COST_PER_1M_*`. Fine for budgeting, not a bill.
- **The filesystem tool is sandboxed** to `WORKSPACE_DIR` with path-traversal protection — agents can never escape it. GitHub/web tools are opt-in and disabled without credentials.
- **L1 guilds get leaner runs** — 2 048 token cap per execution, single-agent reviews, no scheduled jobs.
- **IPv6-only DNS hosts** (Docker `npm ci` fails with `EAI_AGAIN`) — build with `docker build --network=host -t discorp .`; the VPS doesn't need this.

<br>

## 🗺️ Roadmap

- [ ] **v0.2** — CLI management (`discorp org add`, `discorp agent add`), agent chat (`/chat <agent>`)
- [ ] **v0.3** — Tool ecosystem: Jira/Linear, Slack, Notion, email
- [ ] **v0.4** — Autonomous refinements: inter-agent delegation, swarm sessions, self-generated goals
- [ ] **v0.5** — Web dashboard (goals, reports, costs), pgvector HNSW indexes, multi-model ensembles
- [ ] **v1.0** — Stable orchestration API + plugin system

<br>

## 🤝 Contributing

Agents, tools, providers, pricing entries, docs, and bug reports are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) — every PR runs typecheck + tests on CI.

<br>

## 📄 License

[MIT](LICENSE)

<br>

## 📬 Contact

### 💌 Email: **dev@nady4.com**

### 👩🏻‍💻 GitHub: [@nady4](https://github.com/nady4)
