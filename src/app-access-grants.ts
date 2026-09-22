import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AppAccess = "allowlist" | "all";
export type AppAccessSource = "grant-file" | "environment" | "env-file" | "default";
export function appAccessPath(envFile: string): string { return resolve(`${envFile}.access.json`); }
export function configuredAccessPath(env: NodeJS.ProcessEnv = process.env): string {
  return appAccessPath(env.JEV_CUA_ENV_FILE ?? fileURLToPath(new URL("../.env.local", import.meta.url)));
}
export function validateAppAccess(value: unknown): AppAccess {
  if (value !== "allowlist" && value !== "all") throw new Error("App access must be exactly allowlist or all.");
  return value;
}
export function readAppAccessGrant(path: string): AppAccess | undefined {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error("Cannot open the app access file safely.");
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > 1024 || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) {
      throw new Error("App access must be a small owner-only regular file (600).");
    }
    let data: unknown;
    try { data = JSON.parse(readFileSync(fd, "utf8")); } catch { throw new Error("Invalid app access JSON; no changes were made."); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid app access format.");
    const record = data as Record<string, unknown>;
    if (record.version !== 1 || Object.keys(record).some((key) => key !== "version" && key !== "appAccess")) throw new Error("Invalid app access format.");
    return validateAppAccess(record.appAccess);
  } finally { closeSync(fd); }
}

/** Save an explicit user choice. Never opens credentials or modifies application lists. */
export function setAppAccessGrant(value: AppAccess, path = configuredAccessPath()): { changed: boolean; appAccess: AppAccess; file: string } {
  const appAccess = validateAppAccess(value);
  const lock = `${path}.lock`;
  let lockFd: number;
  try { lockFd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
  catch { throw new Error("Cannot lock app access; another update may be running or the directory is not writable. No changes were made."); }
  let temporary: string | undefined;
  try {
    if (readAppAccessGrant(path) === appAccess) return { changed: false, appAccess, file: path };
    temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify({ version: 1, appAccess }, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    temporary = undefined;
    return { changed: true, appAccess, file: path };
  } finally {
    if (temporary) { try { unlinkSync(temporary); } catch { /* leave the original file intact */ } }
    closeSync(lockFd);
    unlinkSync(lock);
  }
}
