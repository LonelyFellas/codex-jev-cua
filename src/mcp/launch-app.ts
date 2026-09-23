import { execFile } from "node:child_process";
import { Type } from "typebox";
import type { NativeSpec } from "../native-specs.ts";
import { validateAppName } from "../app-grants.ts";

const bundleIdPattern = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
export type AppIdentityType = "name" | "bundleId";
export function launchArguments(app: string, identityType: AppIdentityType): string[] {
  if (validateAppName(app) !== app || app.startsWith("-") || /[\\/:]/.test(app)) {
    throw new Error("Launch requires one exact registered application name or Bundle ID, not a path, URL or command.");
  }
  if (identityType === "bundleId" && bundleIdPattern.test(app)) return ["-b", app];
  if (identityType === "name") return ["-a", app];
  throw new Error("Invalid application identity type or Bundle ID.");
}
export const launchAppSpec: NativeSpec = {
  name: "cua_launch_app", method: "launch_app", readOnly: false,
  description: "Launch or activate any installed task app via macOS LaunchServices when the user requested opening it, before reading its window. Use an exact registered app name (identityType=name) or Bundle ID (identityType=bundleId), identical to the task app. Requires taskId but no stateId; consumes one action and invalidates previous state. Does not read UI, grant Sky/system permission, or prove window readiness. Next use cua_get_app_state to verify. Never use as a fallback after denied approval or an unknown outcome; no automatic retry. No URLs, files or extra launch arguments.",
  parameters: Type.Object({ app: Type.String({ minLength: 1, maxLength: 200 }), identityType: Type.Union([Type.Literal("name"), Type.Literal("bundleId")]) }, { additionalProperties: false }),
};
export class LaunchAppError extends Error {
  readonly code: "launch_failed" | "launch_unsupported";
  constructor(code: "launch_failed" | "launch_unsupported") { super(code); this.name = "LaunchAppError"; this.code = code; }
}

/** Fixed executable and argv: never execute a shell, app-supplied command, document or URL. */
export async function launchApp(app: string, identityType: AppIdentityType, signal: AbortSignal): Promise<void> {
  const args = launchArguments(app, identityType);
  signal.throwIfAborted();
  if (process.platform !== "darwin") throw new LaunchAppError("launch_unsupported");
  await new Promise<void>((resolve, reject) => {
    execFile("/usr/bin/open", args, { signal, timeout: 10_000, maxBuffer: 8_192 }, (error) => {
      if (signal.aborted) reject(signal.reason);
      else if (error) reject(new LaunchAppError("launch_failed"));
      else resolve();
    });
  });
}
