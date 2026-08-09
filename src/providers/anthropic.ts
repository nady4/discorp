import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatRequest, ChatResult, IProvider, ProviderSettings, ToolSchema } from "./types.js";

/**
 * Anthropic adapter (native Messages API).
 * Note: Anthropic has no embeddings API — configure AI_EMBEDDING_PROVIDER
 * to openai/ollama/gemini if the chat provider is anthropic.
 */
export class AnthropicProvider implements IProvider {
  readonly kind = "anthropic" as const;
  readonly model: string;
  private client: Anthropic;
  private temperature?: number;
  private maxTokens?: number;

  constructor(settings: ProviderSettings) {
    if (!settings.apiKey) throw new Error("AI_API_KEY is required for the anthropic provider");
    this.model = settings.model;
    this.temperature = settings.temperature;
    this.maxTokens = settings.maxTokens;
    this.client = new Anthropic({ apiKey: settings.apiKey, baseURL: settings.baseUrl, maxRetries: 2, timeout: 120_000 });
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => this.toAnthropicMessage(m));
    const tools = req.tools?.map((t) => this.toAnthropicTool(t));

    const resp = await this.client.messages.create({
      model: req.model ?? this.model,
      max_tokens: req.maxTokens ?? this.maxTokens ?? 4096,
      system: system || undefined,
      messages,
      tools,
      temperature: req.temperature ?? this.temperature ?? 0.7,
    });

    const toolCalls = resp.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input) }));
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? (b as Anthropic.TextBlock).text : ""))
      .join("");

    return {
      content: text,
      toolCalls,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      model: resp.model,
      finishReason: resp.stop_reason ?? "stop",
    };
  }

  private toAnthropicMessage(m: ChatMessage): Anthropic.MessageParam {
    if (m.role === "tool") {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId ?? "",
            content: m.content,
          },
        ],
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: safeJson(tc.arguments),
          })),
        ],
      };
    }
    if (m.role === "assistant") {
      return { role: "assistant", content: m.content };
    }
    return { role: "user", content: m.content };
  }

  private toAnthropicTool(t: ToolSchema): Anthropic.Tool {
    return {
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    };
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}
