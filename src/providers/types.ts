import type { ProviderKind } from "../config/index.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  /** JSON string of the arguments. */
  arguments: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant messages: the tool calls the model requested. */
  toolCalls?: ToolCall[];
  /** Present on tool-result messages: id of the tool call being answered. */
  toolCallId?: string;
  /** Present on tool-result messages: name of the tool that was called. */
  toolName?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema of the tool arguments. */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  model: string;
  finishReason: string;
}

export interface EmbedRequest {
  text: string;
  model?: string;
}

export interface EmbedResult {
  embedding: number[];
  inputTokens: number;
  model: string;
}

export interface ProviderSettings {
  kind: ProviderKind;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Provider abstraction. All AI interactions (chat + tool calls + embeddings)
 * go through implementations of this interface, so agents never talk to a
 * vendor SDK directly.
 */
export interface IProvider {
  readonly kind: ProviderKind;
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResult>;
}

export interface IEmbedder {
  readonly kind: ProviderKind;
  readonly model: string;
  embed(req: EmbedRequest): Promise<EmbedResult>;
}

/** Build a tool-result message the adapters can map back per vendor. */
export function toolResultMessage(toolCall: ToolCall, result: string): ChatMessage {
  return { role: "tool", toolCallId: toolCall.id, toolName: toolCall.name, content: result };
}
