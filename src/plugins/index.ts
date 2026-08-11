import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { env } from "../config/index.js";
import { toolRegistry, type AgentTool, type ToolContext } from "../agents/tools/index.js";
import { logger } from "../utils/logger.js";
import { errorMessage } from "../utils/errors.js";

/**
 * Plugin system (v1.0).
 *
 * A plugin is a directory in PLUGINS_DIR (default ./plugins) containing:
 *   plugin.json   — manifest: id, name, version, description, entry, tools[]
 *   <entry>.js    — ESM module exporting { handlers: { [toolName]: handler } }
 *
 * Example plugin.json:
 * {
 *   "id": "my-plugin",
 *   "name": "My plugin",
 *   "entry": "index.js",
 *   "tools": [{ "name": "my_tool", "description": "Does something", "parameters": {} }]
 * }
 *
 * Handlers receive (args: Record<string, unknown>, ctx: ToolContext) and
 * return a string (the tool result shown to the agent).
 */

const pluginToolSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]{1,64}$/),
  description: z.string().default(""),
  parameters: z.record(z.unknown()).default({}),
});

export const pluginSchema = z.object({
  id: z.string().regex(/^[a-z0-9-_]{1,64}$/),
  name: z.string().min(1),
  version: z.string().default("0.0.0"),
  description: z.string().default(""),
  entry: z
    .string()
    .min(1)
    .regex(/^(?!.*\.\.)(?!\/)[a-zA-Z0-9_][a-zA-Z0-9_./-]*\.js$/, "entry must be a relative .js module inside the plugin directory"),
  tools: z.array(pluginToolSchema).default([]),
});

export interface PluginHandler {
  (args: Record<string, unknown>, ctx: ToolContext): Promise<string> | string;
}

export interface PluginModule {
  handlers: Record<string, PluginHandler>;
}

export async function loadPlugins(): Promise<string[]> {
  const dir = path.resolve(env.PLUGINS_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    logger.info({ dir }, "no plugins directory — skipping plugin load");
    return [];
  }

  const loaded: string[] = [];
  for (const entry of entries) {
    const pluginDir = path.join(dir, entry);
    const stat = await fs.stat(pluginDir).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const manifestPath = path.join(pluginDir, "plugin.json");
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, "utf8");
    } catch {
      logger.warn({ plugin: entry }, "plugin has no plugin.json — skipping");
      continue;
    }

    let manifest: z.infer<typeof pluginSchema>;
    try {
      manifest = pluginSchema.parse(JSON.parse(raw));
    } catch (err) {
      logger.warn({ plugin: entry, err: errorMessage(err) }, "invalid plugin manifest — skipping");
      continue;
    }

    let mod: PluginModule;
    try {
      mod = (await import(pathToFileURL(path.join(pluginDir, manifest.entry)).href)) as PluginModule;
    } catch (err) {
      logger.error({ plugin: manifest.id, err: errorMessage(err) }, "failed to load plugin module");
      continue;
    }

    let registered = 0;
    for (const toolSpec of manifest.tools) {
      const handler = mod.handlers?.[toolSpec.name];
      if (typeof handler !== "function") {
        logger.warn({ plugin: manifest.id, tool: toolSpec.name }, "plugin declares a tool without a handler");
        continue;
      }
      const tool: AgentTool = {
        name: toolSpec.name,
        description: toolSpec.description || `Plugin tool (${manifest.id})`,
        parameters: toolSpec.parameters,
        execute: (args, ctx) => Promise.resolve(handler(args, ctx)),
      };
      if (toolRegistry.has(tool.name)) {
        logger.warn({ plugin: manifest.id, tool: tool.name }, "plugin tool overrides a built-in tool");
      }
      toolRegistry.register(tool);
      registered += 1;
    }

    if (registered > 0) {
      loaded.push(manifest.id);
      logger.info({ id: manifest.id, version: manifest.version, tools: registered }, "plugin loaded");
    }
  }
  return loaded;
}
