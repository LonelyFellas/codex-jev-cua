import { readFileSync, statSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { appGrantsPath, readAppGrants } from "./app-grants.ts";

export type CuaMode = "native" | "jev";
export interface PiConfig { apiKey?: string; allowedApps: string[]; envFile: string; mode?: CuaMode }
export function loadPiConfig(env: NodeJS.ProcessEnv = process.env, defaultFile = fileURLToPath(new URL("../.env.local", import.meta.url))): PiConfig {
  const envFile = env.JEV_CUA_ENV_FILE ?? defaultFile;
  let local: Record<string, string | undefined> = {};
  try {
    const info = statSync(envFile);
    if (!info.isFile() || info.size > 16_384 || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) {
      throw new Error("Jev config must be a small owner-only file (chmod 600).");
    }
    local = parseEnv(readFileSync(envFile, "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT" && !env.JEV_CUA_ENV_FILE)) throw new Error("Cannot safely load Jev config; check JEV_CUA_ENV_FILE and file permissions (600).");
  }
  const apiKey = (env.TYPESAFE_API_KEY ?? local.TYPESAFE_API_KEY)?.trim() || undefined;
  const allowed = env.JEV_CUA_ALLOWED_APPS ?? local.JEV_CUA_ALLOWED_APPS ?? "Calculator";
  const allowedApps = [...new Set([
    ...allowed.split(",").map((value) => value.trim()).filter(Boolean),
    ...readAppGrants(appGrantsPath(envFile)),
  ])];
  const mode = env.JEV_CUA_MODE ?? local.JEV_CUA_MODE;
  if (mode !== undefined && mode !== "native" && mode !== "jev") throw new Error("JEV_CUA_MODE must be native or jev; auto routing is not supported.");
  // Never copy secrets into process.env, tool results or the Sky child process.
  return { apiKey, allowedApps, envFile, ...(mode ? { mode } : {}) };
}
