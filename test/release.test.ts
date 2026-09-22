import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/check-release.ts", import.meta.url));
test("release guard accepts matching stable tags on main and rejects mismatches or unmerged sources", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-release-"));
  const manifest = { name: "jev-codex-cua", version: "0.2.0",
    repository: { url: "git+https://github.com/LonelyFellas/codex-jev-cua.git" },
    publishConfig: { registry: "https://registry.npmjs.org/", access: "public" } };
  const lock = { version: "0.2.0", packages: { "": { version: "0.2.0" } } };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  const run = (tag = "v0.2.0", type = "tag") => spawnSync(process.execPath, ["--experimental-strip-types", script], {
    cwd: directory, encoding: "utf8", env: { ...process.env, GITHUB_REF_TYPE: type, GITHUB_REF_NAME: tag },
  });
  try {
    await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
    await writeFile(join(directory, "package-lock.json"), JSON.stringify(lock));
    git("init", "--quiet"); git("add", ".");
    git("-c", "user.name=Release Test", "-c", "user.email=release-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    assert.equal(run().status, 0);
    for (const [tag, type] of [["v0.2.0", "branch"], ["v0.2.1", "tag"], ["v0.2.0-beta.1", "tag"], ["v00.2.0", "tag"], ["v0.2.0;echo unsafe", "tag"]]) {
      assert.notEqual(run(tag, type).status, 0);
    }
    await writeFile(join(directory, "package-lock.json"), JSON.stringify({ ...lock, version: "0.1.0" }));
    assert.notEqual(run().status, 0);
    await writeFile(join(directory, "package-lock.json"), JSON.stringify(lock));
    await writeFile(join(directory, "package.json"), JSON.stringify({ ...manifest, private: true }));
    assert.notEqual(run().status, 0);
    await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
    git("-c", "user.name=Release Test", "-c", "user.email=release-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "--quiet", "-m", "unmerged");
    assert.notEqual(run().status, 0, "Unmerged tag sources must never publish.");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
