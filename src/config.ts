import { homedir } from "node:os";
import { join } from "node:path";
import type { TallyPaths } from "./types.ts";

export const STATUS_KEY = "pi-tally";
export const COMMAND_NAME = "tally";
export const STORE_FILE_NAME = "pi-tally.json";
export const ACTIVE_DAY_MIN_PROMPTS = 10;

export function resolveTallyPaths(env: NodeJS.ProcessEnv = process.env): TallyPaths {
  const agentDir = env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const sessionsDir = env.PI_CODING_AGENT_SESSION_DIR || join(agentDir, "sessions");
  return {
    agentDir,
    sessionsDir,
    storeFile: join(agentDir, STORE_FILE_NAME),
  };
}
