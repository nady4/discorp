import { GoogleGenAI } from "@google/genai";
import type { Content, FunctionCall, FunctionResponse, Part } from "@google/genai";
import type { ChatMessage, ChatRequest, ChatResult, EmbedRequest, EmbedResult, IProvider, IEmbedder, ProviderSettings, ToolSchema } from "./types.js";

type GenAiModel = GoogleGenAI["models"];

function toGeminiContents(messages: ChatMessage[]): Content[] {
  const contents: Content[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const parts: Part[] = [];
    if (m.role === "tool") {
      const fr: FunctionResponse = {
        name: m.toolName ?? "",
        response: { result: m.content },
      };
      contents.push({ role: "user", parts: [{ functionResponse: fr }] });
      continue;
    }
    if (m.content) parts.push({ text: m.content });
    if (m.role === "assistant" && m.toolCalls?.length) {
      for (const tc of m.toolCalls) {
        const fc: FunctionCall = { name: tc.name, args: safeJson(tc.arguments) };
        parts.push({ functionCall: fc });
      }
    }
    if (parts.length) {
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
    }
  }
  return contents;
}

function safeJson(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return { raw: value };
  }
}

function toGeminiTools(tools?: ToolSchema[]) {
  if (!tools?.length) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

/** Google Gemini adapter (native API). */
export class GeminiProvider implements IProvider, IEmbedder {
  readonly kind = "gemini" as const;
  readonly model: string;
  private ai: GoogleGenAI;
  private temperature?: number;
  private maxTokens?: number;

  constructor(settings: ProviderSettings) {
    if (!settings.apiKey) throw new Error("AI_API_KEY is required for the gemini provider");
    this.model = settings.model;
    this.temperature = settings.temperature;
    this.maxTokens = settings.maxTokens;
    this.ai = new GoogleGenAI({ apiKey: settings.apiKey });
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = toGeminiContents(req.messages);

    const resp = await this.ai.models.generateContent({
      model: req.model ?? this.model,
      contents,
      config: {
        temperature: req.temperature ?? this.temperature ?? 0.7,
        maxOutputTokens: req.maxTokens ?? this.maxTokens ?? 4096,
        systemInstruction: system || undefined,
        tools: toGeminiTools(req.tools),
      },
    });

    const candidate = resp.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts.filter((p) => p.text).map((p) => p.text).join("");
    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p) => ({
        id: crypto.randomUUID(),
        name: p.functionCall!.name ?? "",
        arguments: JSON.stringify(p.functionCall?.args ?? {}),
      }));

    const usage = resp.usageMetadata;
    return {
      content: text,
      toolCalls,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      model: resp.modelVersion ?? req.model ?? this.model,
      finishReason: candidate?.finishReason ?? "stop",
    };
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const model = req.model ?? this.model;
    const normalized = model.startsWith("models/") ? model : `models/${model}`;
    const resp = await this.ai.models.embedContent({
      model: normalized,
      contents: [{ role: "user", parts: [{ text: req.text }] }],
    });
    const values = resp.embeddings?.[0]?.values ?? [];
    return {
      embedding: values,
      inputTokens: Math.ceil(req.text.length / 4),
      model: model,
    };
  }
}
