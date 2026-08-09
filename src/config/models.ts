import type { AppEnv } from "./env.js";

/**
 * Model pricing table: USD per 1M tokens (approximate list prices).
 * Unknown models fall back to FALLBACK_COST_PER_1M_* env values.
 * Prices are estimates used for /balance budgeting — adjust to your
 * provider's real pricing if needed.
 */
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "o3": { input: 2, output: 8 },
  "o4-mini": { input: 1.1, output: 4.4 },
  "o1": { input: 15, output: 60 },
  // Anthropic
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "claude-3-5-sonnet": { input: 3, output: 15 },
  // Google Gemini
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "text-embedding-004": { input: 0.25, output: 0 },
  // DeepSeek
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  "deepseek-v4-flash-0731": { input: 0.35, output: 1.4 },
  // OpenRouter / miscellaneous
  "qwen2.5-coder-32b": { input: 0.2, output: 0.6 },
};

export interface ModelCost {
  inputPer1M: number;
  outputPer1M: number;
}

export function getModelCost(model: string, env: Pick<AppEnv, "FALLBACK_COST_PER_1M_INPUT" | "FALLBACK_COST_PER_1M_OUTPUT">): ModelCost {
  const exact = MODEL_PRICES[model];
  if (exact) return { inputPer1M: exact.input, outputPer1M: exact.output };
  // Try to match by prefix so e.g. "deepseek-v4-flash-0731" falls back gracefully
  const prefixMatch = Object.entries(MODEL_PRICES).find(([key]) => model.startsWith(key));
  if (prefixMatch) return { inputPer1M: prefixMatch[1].input, outputPer1M: prefixMatch[1].output };
  return {
    inputPer1M: env.FALLBACK_COST_PER_1M_INPUT,
    outputPer1M: env.FALLBACK_COST_PER_1M_OUTPUT,
  };
}

/** Estimate cost in USD for a given token usage. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number, env: Pick<AppEnv, "FALLBACK_COST_PER_1M_INPUT" | "FALLBACK_COST_PER_1M_OUTPUT">): number {
  const { inputPer1M, outputPer1M } = getModelCost(model, env);
  return (inputTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M;
}
