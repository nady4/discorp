import { z } from "zod";

const providerSchema = z.enum(["openai", "anthropic", "gemini", "ollama"]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  ADMIN_USER_IDS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  AI_PROVIDER: providerSchema.default("openai"),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  AI_MODEL: z.string().min(1, "AI_MODEL is required"),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(4096),

  // Empty string in .env means "not set" — normalize before validation
  AI_EMBEDDING_PROVIDER: z.preprocess((v) => (v === "" ? undefined : v), providerSchema.optional()),
  AI_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
  AI_EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),

  DEFAULT_GUILD_MODE: z.enum(["lightweight", "standard", "autonomous"]).default("standard"),
  DEFAULT_MONTHLY_BUDGET: z.coerce.number().positive().default(50),
  DEFAULT_MAX_EXECUTIONS_PER_DAY: z.coerce.number().int().positive().default(100),
  MAX_TOKENS_PER_EXECUTION: z.coerce.number().int().positive().default(16384),
  FALLBACK_COST_PER_1M_INPUT: z.coerce.number().nonnegative().default(1.0),
  FALLBACK_COST_PER_1M_OUTPUT: z.coerce.number().nonnegative().default(3.0),

  AGENTS_DIR: z.string().default("./agents/definitions"),
  WORKSPACE_DIR: z.string().default("./data/workspace"),

  GITHUB_TOKEN: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export type ProviderKind = z.infer<typeof providerSchema>;

export class EnvError extends Error {
  constructor(issues: z.ZodIssue[]) {
    const lines = issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    super(`Invalid environment configuration:\n${lines.join("\n")}`);
    this.name = "EnvError";
  }
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues);
  }
  return parsed.data;
}
