import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPiConfig } from "../src/pi-config.ts";
import { addAppGrant, appGrantsPath } from "../src/app-grants.ts";

test("native app access defaults to all; explicit choices preserve grants", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-access-"));
  const file = join(directory, ".env.local");
  try {
    assert.equal(loadPiConfig({}, file).appAccess, "all");
    assert.equal(loadPiConfig({}, file).appAccessSource, "default");
    assert.equal(loadPiConfig({ JEV_CUA_MODE: "native" }, file).appAccess, "all");
    assert.equal(loadPiConfig({ JEV_CUA_MODE: "jev" }, file).appAccess, "allowlist");
    await writeFile(file, "JEV_CUA_MODE=jev\n", { mode: 0o600 });
    assert.equal(loadPiConfig({}, file).appAccess, "allowlist");
    assert.equal(loadPiConfig({ JEV_CUA_MODE: "native" }, file).appAccess, "all");
    const contents = "JEV_CUA_APP_ACCESS=all\nJEV_CUA_ALLOWED_APPS=Calculator\n";
    await writeFile(file, contents, { mode: 0o600 });
    addAppGrant("Music", appGrantsPath(file));
    const grants = await readFile(appGrantsPath(file), "utf8");
    const all = loadPiConfig({}, file);
    assert.equal(all.appAccess, "all");
    assert.deepEqual(all.allowedApps, ["Calculator", "Music"]);
    assert.equal(all.mode, undefined, "App access must not implicitly opt into Jev.");
    const restricted = loadPiConfig({ JEV_CUA_APP_ACCESS: "allowlist" }, file);
    assert.equal(restricted.appAccess, "allowlist");
    assert.deepEqual(restricted.allowedApps, all.allowedApps);
    await writeFile(file, "JEV_CUA_APP_ACCESS=allowlist\n", { mode: 0o600 });
    assert.equal(loadPiConfig({}, file).appAccess, "allowlist");
    assert.equal(loadPiConfig({ JEV_CUA_APP_ACCESS: "all" }, file).appAccess, "all");
    await writeFile(file, "JEV_CUA_ALLOWED_APPS=*\n", { mode: 0o600 });
    assert.equal(loadPiConfig({ JEV_CUA_MODE: "jev" }, file).appAccess, "allowlist", "Wildcard entries cannot enable all-app access.");
    assert.equal(await readFile(appGrantsPath(file), "utf8"), grants);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("invalid access configuration and unsafe files fail closed even with all requested", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-access-invalid-"));
  const file = join(directory, ".env.local");
  try {
    for (const value of ["", "ALL", "*", "true", " all", "all ", "allowlist,all"]) {
      assert.throws(() => loadPiConfig({ JEV_CUA_APP_ACCESS: value }, file), /JEV_CUA_APP_ACCESS/);
    }
    await writeFile(file, "JEV_CUA_APP_ACCESS=invalid\n", { mode: 0o600 });
    assert.throws(() => loadPiConfig({}, file), /JEV_CUA_APP_ACCESS/);
    await chmod(file, 0o644);
    assert.throws(() => loadPiConfig({ JEV_CUA_APP_ACCESS: "all" }, file), /permissions/);
    await chmod(file, 0o600);
    await writeFile(appGrantsPath(file), "invalid JSON", { mode: 0o600 });
    assert.throws(() => loadPiConfig({ JEV_CUA_APP_ACCESS: "all" }, file), /Invalid app grants/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
