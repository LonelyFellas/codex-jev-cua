import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverAndLoadExtensions, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { nativeToolNames } from "../src/native-tools.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const temporary = mkdtempSync(join(tmpdir(), "jev-npm-package-"));
function npm(args: string[], cwd: string) {
  return execFileSync("npm", args, { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
}
try {
  assert.ok(manifest.keywords.includes("pi-package"));
  for (const peer of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "typebox"]) {
    assert.equal(manifest.peerDependencies[peer], "*");
    assert.equal(manifest.dependencies?.[peer], undefined, "Host pi packages must remain peers, not bundled dependencies.");
  }
  // Exercise the real prepack lifecycle, including building dist. No publish command is used.
  npm(["pack", "--json", "--pack-destination", temporary], root);
  const tarball = join(temporary, `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`);
  assert.ok(existsSync(tarball));
  const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
  assert.ok(entries.every((entry) => !/(^|\/)(\.env[^/]*|runs|node_modules|test)(\/|$)/.test(entry)), "Package must exclude private configuration, traces, dependencies and tests.");
  for (const required of ["src/pi-extension.ts", "dist/index.js", "dist/index.d.ts", "skills/jev-codex-cua/SKILL.md", "skills/jev-cua-add-app/SKILL.md", "skills/jev-cua-access/SKILL.md", "src/app-access.ts", "src/app-access-grants.ts", "dist/app-access.js", "dist/app-access-grants.js", "src/add-app.ts", "src/sky/LICENSE.pi-codex-cua", "LICENSE", "NOTICE.md", "THIRD_PARTY_LICENSES.md", "docs/action-trace.md"]) {
    assert.ok(entries.includes(`package/${required}`), `Missing packed file: ${required}`);
  }
  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  // Emulate a consumer without dev dependencies or lifecycle scripts. Pi supplies its own
  // peer packages; legacy-peer-deps avoids downloading a second host into this isolated test.
  npm(["install", "--prefix", consumer, "--omit=dev", "--ignore-scripts", "--legacy-peer-deps", "--offline", "--no-audit", "--no-fund", tarball], consumer);
  const installed = join(consumer, "node_modules", manifest.name);
  assert.ok(existsSync(join(installed, "dist/index.js")));
  assert.equal(existsSync(join(consumer, "node_modules", "typescript")), false);
  const packedManifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const loaded = await discoverAndLoadExtensions(packedManifest.pi.extensions.map((relative: string) => join(installed, relative)), consumer, join(temporary, "agent"));
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert.deepEqual([...loaded.extensions[0]!.tools.keys()], ["cua_status", "jev_cua_status", ...nativeToolNames, "jev_cua_observe", "jev_cua_run"]);
  assert.ok(loaded.extensions[0]!.commands.has("cua-mode"));
  const skills = packedManifest.pi.skills.flatMap((relative: string) => {
    const result = loadSkillsFromDir({ dir: join(installed, relative), source: `npm:${manifest.name}` });
    assert.deepEqual(result.diagnostics, []);
    return result.skills;
  });
  assert.deepEqual(skills.map((skill: { name: string }) => skill.name).sort(), ["jev-codex-cua", "jev-cua-access", "jev-cua-add-app"]);
  assert.equal(skills.find((skill: { name: string }) => skill.name === "jev-cua-access")?.disableModelInvocation, true);
  const privateEnv = join(consumer, "private.env");
  writeFileSync(privateEnv, "DO_NOT_READ_CREDENTIAL_CONTENT", { mode: 0o000 });
  const accessFile = `${privateEnv}.access.json`;
  const accessCli = (...args: string[]) => JSON.parse(execFileSync(process.execPath,
    [join(installed, "dist/app-access.js"), ...args],
    { encoding: "utf8", env: { ...process.env, JEV_CUA_ENV_FILE: privateEnv } }));
  for (const appAccess of ["all", "allowlist"]) {
    assert.equal(accessCli(appAccess, "--expected-file", accessFile).appAccess, appAccess);
    assert.deepEqual(accessCli("status"), { file: accessFile, storedAppAccess: appAccess });
  }
  // Exercise privacy exclusions even for a custom grant filename under a shipped directory.
  for (const suffix of ["", ".lock", ".fixture.tmp"]) {
    writeFileSync(join(installed, `docs/private.env.access.json${suffix}`), "PRIVATE_GRANT_SENTINEL", { mode: 0o600 });
  }
  // Consumer has no compiler; this is a read-only pack inventory, not a publish lifecycle.
  const inventory = JSON.parse(npm(["pack", "--dry-run", "--json", "--ignore-scripts"], installed));
  assert.ok(inventory[0].files.every((file: { path: string }) => !file.path.includes(".access.json")), "Never pack saved app-access grants, locks or temporary files.");
  const api = await import(pathToFileURL(join(installed, "dist/index.js")).href);
  const result = await api.runTask({ appName: "Calculator", goal: "Enter 6", dryRun: true,
    driver: { async bind() {}, async observe() { return "0 standard window Calculator\n1 button 6"; } },
    decide: async () => ({ action: "click_element", targetIndex: 1, confidence: 1, done: 0, risk: 0 }),
  });
  assert.equal(result.status, "dry_run");
  console.log(`Package verification passed: ${manifest.name}@${manifest.version}; 14 registered tools, 3 skills, mode command, compiled API and access CLI, no consumer dev dependencies.`);
  console.log("No API calls, desktop actions, global pi settings changes or npm publication occurred.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
