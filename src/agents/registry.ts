import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { errorMessage } from "../utils/errors.js";
import { agentDefinitionSchema, type AgentDefinition, type AgentRegistryEntry } from "./types.js";

/**
 * Loads agent definitions from agent.json files. Agents are data, not code:
 * users can drop new agent.json files into AGENTS_DIR (or a mounted volume
 * in Docker) and DisCorp will pick them up at boot or after a reload.
 */
export class AgentRegistry {
  private entries = new Map<string, AgentRegistryEntry>();

  constructor(private readonly dir: string = env.AGENTS_DIR) {}

  get all(): AgentRegistryEntry[] {
    return [...this.entries.values()];
  }

  get(id: string): AgentDefinition | undefined {
    return this.entries.get(id)?.definition;
  }

  getEntry(id: string): AgentRegistryEntry | undefined {
    return this.entries.get(id);
  }

  async load(): Promise<void> {
    let files: string[];
    try {
      files = await fs.readdir(this.dir);
    } catch (err) {
      logger.error({ dir: this.dir, err }, "agents directory not readable");
      throw new Error(`Agents directory not readable: ${this.dir}`);
    }
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    const loaded = new Map<string, AgentRegistryEntry>();
    for (const file of jsonFiles) {
      const fullPath = path.join(this.dir, file);
      try {
        const raw = JSON.parse(await fs.readFile(fullPath, "utf8")) as Record<string, unknown>;
        const definition = agentDefinitionSchema.parse({
          ...raw,
          id: (raw.id as string | undefined) ?? file.replace(/\.json$/, ""),
        });
        loaded.set(definition.id, { definition, sourcePath: fullPath });
      } catch (err) {
        logger.warn({ file, err: errorMessage(err) }, "skipping invalid agent definition");
      }
    }

    this.entries = loaded;
    logger.info({ count: this.entries.size, dir: this.dir }, "agent registry loaded");
  }

  /** Persist a new custom agent as an agent.json file, then reload. */
  async addCustomAgent(input: Omit<AgentDefinition, "custom" | "id"> & { id: string }): Promise<AgentDefinition> {
    const definition = agentDefinitionSchema.parse({ ...input, custom: true });
    const filePath = path.join(this.dir, `${definition.id}.json`);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(definition, null, 2), "utf8");
    await this.load();
    logger.info({ id: definition.id }, "custom agent created");
    return definition;
  }

  /** Agents active at or above the given org mode level. */
  activeAtLevel(level: number): AgentDefinition[] {
    return this.all
      .filter((e) => e.definition.modeMin <= level)
      .sort((a, b) => a.definition.modeMin - b.definition.modeMin || (a.definition.isCore ? -1 : 1) - (b.definition.isCore ? -1 : 1))
      .map((e) => e.definition);
  }
}

export const registry = new AgentRegistry();
