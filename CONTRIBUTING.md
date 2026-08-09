# Contributing to DisCorp

Thanks for helping build DisCorp! This document explains how to contribute code, agents, providers, and documentation.

## Project overview

DisCorp is a self-hosted Discord bot that simulates a virtual AI organization. A single bot serves many Discord servers; each server gets its own organization state (goals, tasks, agents, memory, budget). All AI calls go through a provider abstraction so users can bring their own API keys.

## Development setup

Prerequisites: Node.js 20+, Docker (for PostgreSQL + Redis), a Discord bot token, and an AI provider key.

```bash
git clone https://github.com/<you>/discorp.git
cd discorp
npm install
npx prisma generate

# start PostgreSQL + Redis (or use your own)
docker compose up -d postgres redis

cp .env.example .env   # fill in DISCORD_TOKEN, DATABASE_URL, AI_* keys
npx prisma migrate dev # create the database schema
npm run dev            # bot + scheduler
# in a second terminal:
npm run dev:worker     # bullmq workers
```

## Project structure

```
src/
  bot/          Discord client, slash commands, events
  agents/       agent.json registry, executor, personalities, tools
  orchestration/ goal→task workflow, task routing, review engine
  memory/       short-term (Redis) + long-term (pgvector) memory
  providers/    IProvider abstraction (openai-compatible, anthropic, gemini, ollama)
  workers/      BullMQ queues, scheduler, review/autonomous workers
  config/       zod-validated env + model pricing table
  database/     Prisma client, pgvector pool, guild/agent sync
  utils/        logger, cost guard, discord helpers
prisma/         schema + migrations
agents/definitions/ built-in agent.json files
tests/          vitest suites
```

## Contribution guidelines

### Code

1. Fork the repo and create a feature branch (`git checkout -b feat/your-feature`).
2. Follow the existing conventions: strict TypeScript, no comments unless they explain *why*, named exports for modules, pino for logging.
3. Add tests for new logic (see `tests/`). Run the checks:
   ```bash
   npm run typecheck
   npm test
   ```
4. Open a pull request describing what changed and why. The CI runs typecheck + tests on every PR.

### Adding an agent (no code required)

Agents are plain `agent.json` files — drop one into `agents/definitions/`:

```json
{
  "name": "Legal",
  "role": "Legal Counsel",
  "description": "Reviews contracts and compliance documents.",
  "responsibilities": ["Contract review", "Compliance checks"],
  "tools": ["memory", "report", "filesystem"],
  "permissions": ["legal"],
  "persona": "You are the Legal Counsel of a virtual AI company...",
  "modeMin": 2,
  "custom": true
}
```

The `id` defaults to the filename (`legal.json` → `legal`). `modeMin` is the lowest org level the agent participates in. `custom: true` marks it as user-contributed so the DB catalog records the source. You can also add agents at runtime with `/config new-agent`.

### Adding a provider

Providers live in `src/providers/`. Implement `IProvider` (and `IEmbedder` if the vendor has embeddings), add a case to `createChatProvider()` in `src/providers/index.ts`, and document it in the README. Most vendors expose an OpenAI-compatible endpoint — prefer the `openaiCompatible` adapter with a custom `baseUrl` over a new adapter unless native features are needed.

### Adding a tool

Tools live in `src/agents/tools/`. Each tool implements the `AgentTool` interface (name, description, JSON-schema parameters, `execute`). Register it in `src/agents/tools/index.ts`. Tools are opt-in per agent through the agent.json `tools` array. Security-sensitive tools must be sandboxed and disabled by default.

### Adding a model to the pricing table

Add an entry to `MODEL_PRICES` in `src/config/models.ts` (USD per 1M tokens, input/output). Unknown models fall back to `FALLBACK_COST_PER_1M_*`.

### Database changes

1. Edit `prisma/schema.prisma`.
2. Run `npx prisma migrate dev --name <migration>`.
3. Review the generated SQL (pgvector columns are `Unsupported("vector(1024)")` and must be added manually if you change dimensions).

## Reporting bugs

Open an issue with: what you expected, what happened, the logs (pino output), and your env (provider, model, mode). Never paste API keys or tokens into issues.

## Code of conduct

Be respectful and constructive. This is a small, open project — help each other out.

## Roadmap

See the [README](README.md#roadmap) for the current roadmap.
