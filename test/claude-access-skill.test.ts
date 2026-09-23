import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, symlinkSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeMcpSession, nativeConfig } from "../src/mcp/session.ts";

const access = fileURLToPath(new URL("../src/mcp/access.ts", import.meta.url));
const installer = fileURLToPath(new URL("../src/mcp/install-access-skill.ts", import.meta.url));
function run(script: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, ...env }, timeout: 5000 });
}

test("Claude access CLI never opens credentials, binds paths, preserves grants and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-access-")), config = join(dir, "private.env");
  const accessFile = config + ".access.json", appsFile = config + ".apps.json";
  writeFileSync(config, "DO_NOT_READ_SECRET", { mode: 0o000 });
  try {
    const invoke = (command: string, app?: string) => run(access, [command, ...(app ? [app] : []), "--config", config, ...(command === "status" ? [] : ["--expected-file", command === "add" ? appsFile : accessFile])], { JEV_CUA_ENV_FILE: "/wrong/pi.env", DESKHAND_CONFIG_FILE: "/wrong/claude.env" });
    const initial = invoke("status"); assert.equal(initial.status, 0, initial.stderr);
    assert.equal(JSON.parse(initial.stdout).config, config);
    assert.equal(invoke("add", "WeChat").status, 0);
    assert.equal(JSON.parse(invoke("add", "WeChat").stdout).added, false);
    assert.equal(invoke("add", "Google Chrome").status, 0);
    assert.equal(invoke("all").status, 0);
    assert.equal(JSON.parse(invoke("all").stdout).changed, false);
    assert.equal(invoke("allowlist").status, 0);
    const stored = JSON.parse(invoke("status").stdout);
    assert.deepEqual(stored.apps, ["WeChat", "Google Chrome"]); assert.equal(stored.storedAppAccess, "allowlist");
    assert.equal(statSync(accessFile).mode & 0o777, 0o600); assert.equal(statSync(appsFile).mode & 0o777, 0o600);
    assert.equal(statSync(config).mode & 0o777, 0);
    assert.ok(!initial.stdout.includes("SECRET"));
    chmodSync(config, 0o600); assert.equal(readFileSync(config, "utf8"), "DO_NOT_READ_SECRET");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("wrong target, wildcard, symlink, malformed grants and locks fail without replacing files", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-access-unsafe-")), config = join(dir, "env"), target = config + ".access.json";
  try {
    assert.notEqual(run(access, ["all", "--config", config, "--expected-file", join(dir, "other")]).status, 0);
    assert.equal(existsSync(target), false);
    assert.notEqual(run(access, ["add", "*", "--config", config, "--expected-file", config + ".apps.json"]).status, 0);
    assert.notEqual(run(access, ["all", "--config", "relative", "--expected-file", "relative.access.json"]).status, 0);
    writeFileSync(target, "invalid", { mode: 0o600 });
    assert.notEqual(run(access, ["all", "--config", config, "--expected-file", target]).status, 0);
    assert.equal(readFileSync(target, "utf8"), "invalid"); rmSync(target);
    const other = join(dir, "other"); writeFileSync(other, '{"version":1,"appAccess":"allowlist"}', { mode: 0o600 });
    symlinkSync(other, target);
    assert.notEqual(run(access, ["all", "--config", config, "--expected-file", target]).status, 0); rmSync(target);
    writeFileSync(target + ".lock", "busy", { mode: 0o600 });
    assert.notEqual(run(access, ["all", "--config", config, "--expected-file", target]).status, 0);
    assert.equal(readFileSync(target + ".lock", "utf8"), "busy"); assert.equal(existsSync(target), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("default missing parent can be provisioned; running MCP immediately sees explicit grants", () => {
  const home = mkdtempSync(join(tmpdir(), "claude-access-live-config-"));
  const session = new NativeMcpSession({ config: () => nativeConfig({}, home), client() { throw new Error("Must not touch desktop"); } });
  try {
    const before = session.status();
    assert.equal(before.accessManagement.version, 1); assert.equal(before.appAccess, "all");
    assert.equal(before.appAccessSource, "default");
    assert.equal(run(access, ["all", "--config", before.envFile, "--expected-file", before.appAccessFile!]).status, 0);
    assert.equal(session.status().appAccess, "all"); assert.equal(session.status().appAccessSource, "grant-file");
    assert.equal(run(access, ["add", "WeChat", "--config", before.envFile, "--expected-file", before.accessManagement.appsFile]).status, 0);
    assert.ok(session.status().allowedApps.includes("WeChat"));
    assert.equal(run(access, ["allowlist", "--config", before.envFile, "--expected-file", before.appAccessFile!]).status, 0);
    assert.equal(session.status().appAccess, "allowlist");
    assert.ok(session.status().allowedApps.includes("WeChat"));
    assert.equal(existsSync(before.envFile), false, "Must not create env file");
  } finally { session.close(); rmSync(home, { recursive: true, force: true }); }
});

test("Skill installer is explicit, idempotent and never overwrites user edits or symlinks", () => {
  const home = mkdtempSync(join(tmpdir(), "claude-skill-install-"));
  const env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, "custom-claude") };
  try {
    assert.notEqual(run(installer, [], env).status, 0);
    assert.equal(existsSync(env.CLAUDE_CONFIG_DIR), false);
    const first = run(installer, ["--install"], env); assert.equal(first.status, 0, first.stderr);
    const { path } = JSON.parse(first.stdout);
    assert.equal(path, join(env.CLAUDE_CONFIG_DIR, "skills/deskhand-access/SKILL.md"));
    assert.equal(JSON.parse(run(installer, ["--install"], env).stdout).installed, false);
    const content = readFileSync(path, "utf8");
    assert.match(content, /disable-model-invocation: true/); assert.match(content, /\$ARGUMENTS/); assert.match(content, /accessManagement.version=1/);
    writeFileSync(path, "USER CUSTOMIZATION");
    assert.notEqual(run(installer, ["--install"], env).status, 0); assert.equal(readFileSync(path, "utf8"), "USER CUSTOMIZATION");
    rmSync(path); const other = join(home, "other"); writeFileSync(other, content); symlinkSync(other, path);
    assert.notEqual(run(installer, ["--install"], env).status, 0); assert.equal(readFileSync(other, "utf8"), content);
    assert.equal(existsSync(join(home, ".pi")), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
