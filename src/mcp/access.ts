#!/usr/bin/env node
import { lstatSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { appAccessPath, readAppAccessGrant, setAppAccessGrant } from "../app-access-grants.ts";
import { appGrantsPath, readAppGrants, addAppGrant, validateAppName } from "../app-grants.ts";

try {
  const [command, ...args] = process.argv.slice(2);
  const add = command === "add";
  const app = add ? args.shift() : undefined;
  if (!["status", "all", "allowlist", "add"].includes(command ?? "") || (add && !app)
    || args.length !== (command === "status" ? 2 : 4) || args[0] !== "--config"
    || (command !== "status" && args[2] !== "--expected-file")) {
    throw new Error("Usage: access.js status --config <observed-absolute-envFile> | all|allowlist --config <envFile> --expected-file <accessFile> | add <app> --config <envFile> --expected-file <appsFile>");
  }
  const config = args[1]!;
  if (!isAbsolute(config) || resolve(config) !== config || /[\r\n\0]/.test(config)) throw new Error("Use the exact absolute envFile from the active MCP status.");
  const accessFile = appAccessPath(config), appsFile = appGrantsPath(config);
  if (command !== "status" && args[3] !== (add ? appsFile : accessFile)) throw new Error("Expected file does not match the observed config path; no changes made.");
  if (add) validateAppName(app!);
  // Read only grants, never config/credentials. Validate both files before any write.
  const storedAppAccess = readAppAccessGrant(accessFile) ?? null;
  const apps = readAppGrants(appsFile);
  if (command === "status") console.log(JSON.stringify({ config, accessFile, appsFile, storedAppAccess, apps }));
  else {
    const parent = dirname(config);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const info = lstatSync(parent);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error("Grant directory must be owned by the current user, non-symlink and not writable by others.");
    console.log(JSON.stringify(add ? addAppGrant(app!, appsFile) : setAppAccessGrant(command as "all" | "allowlist", accessFile)));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "App access update failed."); process.exitCode = 1;
}
