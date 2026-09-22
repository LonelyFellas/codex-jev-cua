import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addAppGrant, appGrantsPath, readAppGrants, validateAppName } from "../src/app-grants.ts";
import { loadPiConfig } from "../src/pi-config.ts";

const cli = fileURLToPath(new URL("../src/add-app.ts", import.meta.url));

test("app grants append and deduplicate without changing the credential file or existing allowlist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-grants-"));
  const envFile = join(directory, ".env.local");
  const contents = "# Existing configuration must remain byte-for-byte intact\nTYPESAFE_API_KEY=synthetic-secret\nJEV_CUA_ALLOWED_APPS=Calculator,Music\n";
  try {
    await writeFile(envFile, contents, { mode: 0o600 });
    const before = await stat(envFile);
    const path = appGrantsPath(envFile);
    assert.equal(addAppGrant("Wechat Devtools", path).added, true);
    assert.equal(addAppGrant("TextEdit", path).added, true);
    const first = await readFile(path, "utf8");
    const timestamp = (await stat(path)).mtimeMs;
    assert.equal(addAppGrant("Wechat Devtools", path).added, false);
    assert.equal(await readFile(path, "utf8"), first);
    assert.equal((await stat(path)).mtimeMs, timestamp);
    assert.deepEqual(readAppGrants(path), ["Wechat Devtools", "TextEdit"]);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(await readFile(envFile, "utf8"), contents);
    assert.equal((await stat(envFile)).mtimeMs, before.mtimeMs);
    assert.deepEqual(loadPiConfig({}, envFile).allowedApps, ["Calculator", "Music", "Wechat Devtools", "TextEdit"]);
    assert.deepEqual(loadPiConfig({ JEV_CUA_ALLOWED_APPS: "Music" }, envFile).allowedApps, ["Music", "Wechat Devtools", "TextEdit"]);
    assert.ok(!first.includes("synthetic-secret"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("only one exact application is accepted; no bulk, wildcard or removal mode", () => {
  for (const input of ["", "*", "all", "全部应用", "Music,Calculator", "Music\nCalculator", "Music\n", "--remove", "/Applications", "com.*", "Music?"]) {
    assert.throws(() => validateAppName(input));
  }
  assert.equal(validateAppName("Wechat Devtools"), "Wechat Devtools");
  assert.equal(validateAppName("com.apple.Music"), "com.apple.Music");
  assert.equal(validateAppName("/Applications/wechatwebdevtools.app"), "/Applications/wechatwebdevtools.app");
});

test("unsafe, malformed, symlinked or locked grant files fail without replacing data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-grants-boundary-"));
  const path = join(directory, "grants.json");
  try {
    await writeFile(path, "not JSON", { mode: 0o600 });
    assert.throws(() => addAppGrant("Music", path), /Invalid app grants/);
    assert.equal(await readFile(path, "utf8"), "not JSON");
    await writeFile(path, JSON.stringify({ version: 1, apps: ["Calculator"] }));
    await chmod(path, 0o644);
    assert.throws(() => addAppGrant("Music", path), /owner-only/);
    await chmod(path, 0o600);
    const linked = join(directory, "linked.json");
    await symlink(path, linked);
    assert.throws(() => addAppGrant("Music", linked), /safely/);
    assert.deepEqual(readAppGrants(path), ["Calculator"]);
    await writeFile(`${path}.lock`, "existing writer", { mode: 0o600 });
    assert.throws(() => addAppGrant("Music", path), /lock/);
    assert.equal(await readFile(`${path}.lock`, "utf8"), "existing writer");
    assert.deepEqual(readAppGrants(path), ["Calculator"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI only changes the separate grant file even when credentials are unreadable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-grant-cli-"));
  const envFile = join(directory, ".env.local");
  const env = { ...process.env, JEV_CUA_ENV_FILE: envFile, TYPESAFE_API_KEY: "synthetic-not-for-output" };
  const run = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", cli, ...args], { env, encoding: "utf8" });
  try {
    await writeFile(envFile, "DO_NOT_READ_THIS_CREDENTIAL_FILE", { mode: 0o000 });
    const result = run("Wechat Devtools");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { added: true, app: "Wechat Devtools", file: appGrantsPath(envFile) });
    assert.ok(!(result.stdout + result.stderr).includes("synthetic-not-for-output"));
    assert.notEqual(run("--remove", "Wechat Devtools").status, 0);
    assert.notEqual(run("Music", "Calculator").status, 0);
    assert.notEqual(run("*").status, 0);
    assert.deepEqual(readAppGrants(appGrantsPath(envFile)), ["Wechat Devtools"]);
    await chmod(envFile, 0o600);
    assert.equal(await readFile(envFile, "utf8"), "DO_NOT_READ_THIS_CREDENTIAL_FILE");
  } finally { await chmod(envFile, 0o600).catch(() => {}); await rm(directory, { recursive: true, force: true }); }
});
