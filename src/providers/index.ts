import { env, type AppEnv, type ProviderKind } from "../config/index.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAICompatibleProvider, OpenAICompatibleEmbedder, OllamaProvider } from "./openaiCompatible.js";
import type { IEmbedder, IProvider, ProviderSettings } from "./types.js";

export * from "./types.js";
export { estimateCostUsd } from "../config/models.js";

/** Per-guild provider override (stored in Guild.providerOverrides JSON). */
export interface ProviderOverrides {
  provider?: ProviderKind;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_OLLAMA_URL = "http://localhost:11434/v1";

function resolveSettings(overrides?: ProviderOverrides): ProviderSettings {
  const kind = overrides?.provider ?? env.AI_PROVIDER;
  // No baseUrl → vendor SDK defaults (OpenAI: api.openai.com, Ollama: localhost)
  const baseUrl = overrides?.baseUrl ?? env.AI_BASE_URL;
  return {
    kind,
    apiKey: overrides?.apiKey ?? env.AI_API_KEY,
    baseUrl: kind === "ollama" && !baseUrl ? DEFAULT_OLLAMA_URL : baseUrl,
    model: overrides?.model ?? env.AI_MODEL,
    temperature: overrides?.temperature ?? env.AI_TEMPERATURE,
    maxTokens: overrides?.maxTokens ?? env.AI_MAX_TOKENS,
  };
}

/** Create the chat provider for the current environment (BYOK). */
export function createChatProvider(overrides?: ProviderOverrides): IProvider {
  const settings = resolveSettings(overrides);
  switch (settings.kind) {
    case "openai":
      return new OpenAICompatibleProvider(settings);
    case "ollama":
      return new OllamaProvider(settings);
    case "anthropic":
      return new AnthropicProvider(settings);
    case "gemini":
      return new GeminiProvider(settings);
  }
}

/**
 * Create the embedding provider for long-term memory.
 * Anthropic has no embeddings API: if the chat provider is anthropic and no
 * explicit embedding provider is set, this throws with guidance.
 */
export function createEmbedder(): IEmbedder {
  const kind: ProviderKind = env.AI_EMBEDDING_PROVIDER ?? env.AI_PROVIDER;
  const model = env.AI_EMBEDDING_MODEL;

  if (kind === "anthropic") {
    throw new Error(
      "Anthropic does not offer an embeddings API. Set AI_EMBEDDING_PROVIDER=openai|ollama|gemini and AI_EMBEDDING_MODEL accordingly.",
    );
  }
  if (kind === "gemini") {
    const provider = new GeminiProvider({
      kind: "gemini",
      apiKey: env.AI_API_KEY,
      model,
      temperature: 0,
    });
    return provider;
  }
  return new OpenAICompatibleEmbedder(kind === "ollama" ? "ollama" : "openai", {
    kind: kind === "ollama" ? "ollama" : "openai",
    apiKey: kind === "ollama" ? "ollama" : env.AI_API_KEY,
    // Ollama always embeds against the local ollama endpoint
    baseUrl: kind === "ollama" ? DEFAULT_OLLAMA_URL : env.AI_BASE_URL,
    model,
  });
}

export type { IProvider, IEmbedder, ProviderSettings } from "./types.js";
export type { AppEnv };
