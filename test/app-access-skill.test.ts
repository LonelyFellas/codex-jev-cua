import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appAccessPath, readAppAccessGrant, setAppAccessGrant } from "../src/app-access-grants.ts";
import { addAppGrant, appGrantsPath } from "../src/app-grants.ts";
import { loadPiConfig } from "../src/pi-config.ts";

const cli = fileURLToPath(new URL("../src/app-access.ts", import.meta.url));

test("explicit app access choice wins, restores allowlist, and preserves credentials and app grants", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-access-skill-"));
  const file = join(directory, ".env.local");
  const path = appAccessPath(file);
  const contents = "TYPESAFE_API_KEY=synthetic-do-not-log\nJEV_CUA_APP_ACCESS=all\nJEV_CUA_ALLOWED_APPS=Calculator\n";
  try {
    const initial = loadPiConfig({}, file);
    assert.equal(initial.appAccessSource, "default");
    assert.equal(initial.appAccessFile, path);
    await writeFile(file, contents, { mode: 0o600 });
    addAppGrant("Music", appGrantsPath(file));
    const grants = await readFile(appGrantsPath(file), "utf8");
    const envStat = await stat(file);
    assert.equal(loadPiConfig({}, file).appAccessSource, "env-file");
    assert.equal(loadPiConfig({ JEV_CUA_APP_ACCESS: "allowlist" }, file).appAccessSource, "environment");
    assert.equal(readAppAccessGrant(path), undefined);
    assert.equal(setAppAccessGrant("allowlist", path).changed, true);
    let config = loadPiConfig({ JEV_CUA_APP_ACCESS: "all" }, file);
    assert.equal(config.appAccess, "allowlist");
    assert.equal(config.appAccessSource, "grant-file");
    assert.deepEqual(config.allowedApps, ["Calculator", "Music"]);
    const saved = await readFile(path, "utf8");
    const savedStat = await stat(path);
    assert.equal(savedStat.mode & 0o777, 0o600);
    assert.equal(setAppAccessGrant("allowlist", path).changed, false);
    assert.equal((await stat(path)).mtimeMs, savedStat.mtimeMs);
    assert.equal(await readFile(path, "utf8"), saved);
    setAppAccessGrant("all", path);
    config = loadPiConfig({ JEV_CUA_APP_ACCESS: "allowlist" }, file);
    assert.equal(config.appAccess, "all");
    assert.equal(config.mode, undefined, "Changing app access must not opt into Jev.");
    assert.equal(await readFile(file, "utf8"), contents);
    assert.equal((await stat(file)).mtimeMs, envStat.mtimeMs);
    assert.equal(await readFile(appGrantsPath(file), "utf8"), grants);
    assert.ok(!(await readFile(path, "utf8")).includes("synthetic-do-not-log"));
    await rm(path);
    assert.equal(loadPiConfig({ JEV_CUA_APP_ACCESS: "allowlist" }, file).appAccess, "allowlist");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unsafe access files fail closed instead of falling back to an all environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-access-file-"));
  const file = join(directory, "missing.env");
  const path = appAccessPath(file);
  try {
    for (const contents of ["invalid", "null", "[]", '{"version":2,"appAccess":"all"}', '{"version":1}',
      '{"version":1,"appAccess":"ALL"}', '{"version":1,"appAccess":"all","extra":true}', " ".repeat(1025)]) {
      await writeFile(path, contents, { mode: 0o600 });
      assert.throws(() => setAppAccessGrant("all", path));
      assert.throws(() => loadPiConfig({ JEV_CUA_APP_ACCESS: "all" }, file));
      assert.equal(await readFile(path, "utf8"), contents);
    }
    await writeFile(path, '{"version":1,"appAccess":"all"}');
    await chmod(path, 0o644);
    assert.throws(() => setAppAccessGrant("allowlist", path), /owner-only/);
    assert.throws(() => loadPiConfig({ JEV_CUA_APP_ACCESS: "all" }, file), /owner-only/);
    await chmod(path, 0o600);
    const linked = join(directory, "linked.access.json");
    await symlink(path, linked);
    assert.throws(() => setAppAccessGrant("allowlist", linked), /safely/);
    const folder = join(directory, "folder.access.json");
    await mkdir(folder, { mode: 0o700 });
    assert.throws(() => readAppAccessGrant(folder), /regular file/);
    const fifoEnv = join(directory, "fifo.env");
    assert.equal(spawnSync("mkfifo", [appAccessPath(fifoEnv)]).status, 0);
    await chmod(appAccessPath(fifoEnv), 0o600);
    const fifoResult = spawnSync(process.execPath, ["--experimental-strip-types", cli, "status"], {
      env: { ...process.env, JEV_CUA_ENV_FILE: fifoEnv }, encoding: "utf8", timeout: 2000,
    });
    assert.equal(fifoResult.error, undefined, "An abnormal FIFO must be rejected without blocking.");
    assert.equal(fifoResult.status, 1);
    assert.match(fifoResult.stderr, /regular file/);
    await writeFile(`${path}.lock`, "existing writer", { mode: 0o600 });
    assert.throws(() => setAppAccessGrant("allowlist", path), /lock/);
    assert.equal(await readFile(`${path}.lock`, "utf8"), "existing writer");
    assert.equal(readAppAccessGrant(path), "all");
    assert.ok(!(await readdir(directory)).some((entry) => entry.endsWith(".tmp")));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI binds writes to the current plugin path and never opens the credential file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-access-cli-"));
  const file = join(directory, ".env.local");
  const path = appAccessPath(file);
  const run = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", cli, ...args], {
    encoding: "utf8", env: { ...process.env, JEV_CUA_ENV_FILE: file, TYPESAFE_API_KEY: "synthetic-hidden-key" },
  });
  try {
    await writeFile(file, "UNREADABLE_CREDENTIAL_CONTENT", { mode: 0o000 });
    assert.equal(run("--help").status, 0);
    assert.deepEqual(JSON.parse(run("status").stdout), { file: path, storedAppAccess: null });
    for (const args of [[], ["all"], ["*", "--expected-file", path], ["all", "--file", path],
      ["all", "--expected-file", file], ["all", "--expected-file", "relative.access.json"],
      ["all", "--expected-file", path, "--yes"], ["--remove"]]) {
      const result = run(...args);
      assert.notEqual(result.status, 0);
      assert.ok(!(result.stdout + result.stderr).includes("synthetic-hidden-key"));
    }
    assert.equal(readAppAccessGrant(path), undefined, "Invalid calls must not create any grant.");
    for (const appAccess of ["all", "allowlist"] as const) {
      const result = run(appAccess, "--expected-file", path);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { changed: true, appAccess, file: path });
      assert.ok(!(result.stdout + result.stderr).includes("UNREADABLE_CREDENTIAL_CONTENT"));
      assert.equal(JSON.parse(run(appAccess, "--expected-file", path).stdout).changed, false);
      assert.deepEqual(JSON.parse(run("status").stdout), { file: path, storedAppAccess: appAccess });
    }
    await chmod(file, 0o600);
    assert.equal(await readFile(file, "utf8"), "UNREADABLE_CREDENTIAL_CONTENT");
  } finally { await chmod(file, 0o600).catch(() => {}); await rm(directory, { recursive: true, force: true }); }
});
