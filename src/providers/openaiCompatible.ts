import OpenAI from "openai";
import { logger } from "../utils/logger.js";
import type { ChatMessage, ChatRequest, ChatResult, EmbedRequest, EmbedResult, IProvider, IEmbedder, ProviderSettings, ToolSchema } from "./types.js";

/**
 * OpenAI-compatible adapter.
 * Covers OpenAI, DeepSeek, OpenRouter, Together, Groq, and any gateway
 * exposing a /v1/chat/completions endpoint (set via baseUrl).
 * Also used for Ollama (which serves an OpenAI-compatible API on /v1).
 */
export class OpenAICompatibleProvider implements IProvider {
  readonly kind: "openai" | "ollama" = "openai";
  readonly model: string;
  private client: OpenAI;
  private temperature?: number;
  private maxTokens?: number;

  constructor(settings: ProviderSettings) {
    this.kind = settings.kind === "ollama" ? "ollama" : "openai";
    this.model = settings.model;
    this.temperature = settings.temperature;
    this.maxTokens = settings.maxTokens;
    this.client = new OpenAI({
      apiKey: settings.apiKey || "not-set",
      baseURL: settings.baseUrl || undefined,
      timeout: 120_000,
      maxRetries: 2,
    });
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const messages = req.messages.map((m) => this.toOpenAiMessage(m));
    const tools = req.tools?.map((t) => this.toOpenAiTool(t));

    const resp = await this.client.chat.completions.create({
      model: req.model ?? this.model,
      messages,
      tools,
      temperature: req.temperature ?? this.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? this.maxTokens,
    });

    const choice = resp.choices[0];
    const msg = choice?.message;
    const usage = resp.usage;

    return {
      content: msg?.content ?? "",
      toolCalls:
        msg?.tool_calls?.map((tc) => ({
          id: tc.id ?? crypto.randomUUID(),
          name: tc.function.name,
          arguments: tc.function.arguments ?? "{}",
        })) ?? [],
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      model: resp.model,
      finishReason: choice?.finish_reason ?? "stop",
    };
  }

  private toOpenAiMessage(m: ChatMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    return { role: m.role, content: m.content };
  }

  private toOpenAiTool(t: ToolSchema): OpenAI.Chat.Completions.ChatCompletionTool {
    return {
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    };
  }
}

/** Ollama exposes an OpenAI-compatible API at /v1 with no key required. */
export class OllamaProvider extends OpenAICompatibleProvider implements IEmbedder {
  private readonly ollamaBase: string;

  constructor(settings: ProviderSettings) {
    super({ ...settings, apiKey: "ollama", baseUrl: settings.baseUrl ?? "http://localhost:11434/v1" });
    this.ollamaBase = settings.baseUrl ?? "http://localhost:11434/v1";
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const base = this.ollamaBase.replace(/\/v1\/?$/, "");
    const resp = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: req.model ?? this.model, prompt: req.text }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.error({ status: resp.status, body }, "ollama embed failed");
      throw new Error(`Ollama embeddings failed (${resp.status}): ${body.slice(0, 200)}`);
    }
    const data = (await resp.json()) as { embedding: number[] };
    return {
      embedding: data.embedding,
      inputTokens: Math.ceil(req.text.length / 4),
      model: req.model ?? this.model,
    };
  }
}

/** Embeddings through an OpenAI-compatible /v1/embeddings endpoint. */
export class OpenAICompatibleEmbedder implements IEmbedder {
  readonly kind: "openai" | "ollama";
  readonly model: string;
  private client: OpenAI;

  constructor(kind: "openai" | "ollama", settings: ProviderSettings) {
    this.kind = kind;
    this.model = settings.model;
    this.client = new OpenAI({
      apiKey: settings.apiKey || "not-set",
      baseURL: settings.baseUrl || undefined,
      timeout: 60_000,
    });
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const resp = await this.client.embeddings.create({
      model: req.model ?? this.model,
      input: req.text,
    });
    const usage = resp.usage;
    return {
      embedding: resp.data[0]?.embedding ?? [],
      inputTokens: usage?.prompt_tokens ?? Math.ceil(req.text.length / 4),
      model: resp.model,
    };
  }
}
