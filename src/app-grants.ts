import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export function appGrantsPath(envFile: string): string { return `${envFile}.apps.json`; }
export function configuredGrantPath(env: NodeJS.ProcessEnv = process.env): string {
  return appGrantsPath(env.JEV_CUA_ENV_FILE ?? fileURLToPath(new URL("../.env.local", import.meta.url)));
}
export function validateAppName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 200 || /[\p{Cc}\p{Cf},*?\[\]{}]/u.test(value) || name.startsWith("--")
      || /^(all|all apps|全部|所有|所有应用|全部应用)$/i.test(name)) {
    throw new Error("Specify exactly one application name, bundle ID or .app path; bulk grants, wildcards and control characters are not allowed.");
  }
  if (name.startsWith("/") && !/\.app\/?$/.test(name)) throw new Error("An application path must end in .app.");
  return name;
}

export function readAppGrants(path: string): string[] {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw new Error("Cannot open the app grants file safely.");
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > 16_384 || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) {
      throw new Error("App grants must be a small owner-only file (600).");
    }
    let data: unknown;
    try { data = JSON.parse(readFileSync(fd, "utf8")); } catch { throw new Error("Invalid app grants JSON; no changes were made."); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid app grants format.");
    const record = data as Record<string, unknown>;
    if (record.version !== 1 || !Array.isArray(record.apps) || record.apps.length > 100
        || Object.keys(record).some((key) => key !== "version" && key !== "apps")) throw new Error("Invalid app grants format.");
    const apps: string[] = [];
    for (const item of record.apps) {
      if (typeof item !== "string" || validateAppName(item) !== item) throw new Error("Invalid application entry in app grants file.");
      if (!apps.includes(item)) apps.push(item);
    }
    return apps;
  } finally { closeSync(fd); }
}

/** Append one explicit grant. Never opens the credential file, replaces the allowlist or removes entries. */
export function addAppGrant(app: string, path = configuredGrantPath()): { added: boolean; app: string; file: string } {
  const name = validateAppName(app);
  const lock = `${path}.lock`;
  let lockFd: number;
  try { lockFd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
  catch { throw new Error("Cannot lock app grants; another update may be running or the directory is not writable. No changes were made."); }
  let temporary: string | undefined;
  try {
    const apps = readAppGrants(path);
    if (apps.includes(name)) return { added: false, app: name, file: path };
    if (apps.length >= 100) throw new Error("App grants limit reached; no changes were made.");
    const body = JSON.stringify({ version: 1, apps: [...apps, name] }, null, 2) + "\n";
    if (Buffer.byteLength(body) > 16_384) throw new Error("App grants size limit reached; no changes were made.");
    temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    temporary = undefined;
    return { added: true, app: name, file: path };
  } finally {
    if (temporary) { try { unlinkSync(temporary); } catch { /* leave original grants intact */ } }
    closeSync(lockFd);
    unlinkSync(lock);
  }
}
