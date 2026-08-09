import "dotenv/config";
import { loadEnv, type AppEnv } from "./env.js";

const env: AppEnv = loadEnv();

export { env };
export { loadEnv, EnvError } from "./env.js";
export type { AppEnv, ProviderKind } from "./env.js";
export { getModelCost, estimateCostUsd } from "./models.js";
export { ORG_MODE_LEVELS, modeLevel, parseMode, type OrgMode, type OrgModeLevel } from "./modes.js";
