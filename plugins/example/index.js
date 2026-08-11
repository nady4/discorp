// Example DisCorp plugin module (v1.0 plugin system).
// Exports `handlers` keyed by tool name. Each handler receives
// (args, ctx) and returns a string shown to the agent.
export const handlers = {
  async example_hello(args, ctx) {
    const name = String(args.name ?? "world");
    return `Hello, ${name}! (from the example plugin, guild ${ctx.guildId})`;
  },
};
