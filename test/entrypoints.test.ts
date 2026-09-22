import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
test("installer materializes source path, refuses overwrite and uninstalls only its own skill", async () => {
  const home = await mkdtemp(join(tmpdir(), "deskhand-home-"));
  const env = { ...process.env, HOME: home };
  const install = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", join(root, "src/install-skill.ts"), ...args], { env, encoding: "utf8" });
  try {
    assert.equal(install().status, 0);
    const file = join(home, ".codex/skills/deskhand/SKILL.md");
    const installed = await readFile(file, "utf8");
    assert.ok(!installed.includes("{{REPO_DIR}}"));
    assert.ok(installed.includes(root.replace(/\/$/, "")));
    assert.notEqual(install().status, 0);
    assert.equal(await readFile(file, "utf8"), installed);
    assert.equal(install("--uninstall").status, 0);
    await assert.rejects(access(file));
    assert.equal(install("--uninstall").status, 0);
  } finally { await rm(home, { recursive: true, force: true }); }
});
test("controlled real-desktop handoff test refuses to run without explicit --live", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", join(root, "scripts/accept-handoff.ts")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Pass --live/);
  assert.equal(result.stdout, "");
});
test("read-only app-access acceptance refuses to run without explicit --live", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", join(root, "scripts/accept-app-access.ts")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Pass --live/);
  assert.equal(result.stdout, "");
});
test("online evaluation requires explicit --live opt-in", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", join(root, "src/eval.ts")], {
    encoding: "utf8", env: { ...process.env, TYPESAFE_API_KEY: "not-a-real-key" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--live/);
  assert.equal(result.stdout, "");
});
