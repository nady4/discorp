import { createEmbedder } from "../providers/index.js";

let embedder: ReturnType<typeof createEmbedder> | null = null;

export function getEmbedder() {
  if (!embedder) {
    embedder = createEmbedder();
  }
  return embedder;
}

export async function embedText(text: string): Promise<{ embedding: number[]; tokens: number }> {
  const result = await getEmbedder().embed({ text });
  return { embedding: result.embedding, tokens: result.inputTokens };
}
