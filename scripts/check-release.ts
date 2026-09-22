import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tag = process.env.GITHUB_REF_NAME ?? "";
assert.equal(process.env.GITHUB_REF_TYPE, "tag", "Publication requires a tag event.");
assert.match(tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Only stable vX.Y.Z tags may publish to latest.");
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
assert.equal(manifest.name, "jev-codex-cua");
assert.equal(manifest.version, tag.slice(1), "Tag must match package.json version.");
assert.equal(lock.version, manifest.version, "Lockfile version must match.");
assert.equal(lock.packages?.[""]?.version, manifest.version, "Lockfile root package version must match.");
assert.equal(manifest.repository?.url, "git+https://github.com/LonelyFellas/codex-jev-cua.git", "Repository must match the trusted publisher.");
assert.equal(manifest.publishConfig?.registry, "https://registry.npmjs.org/");
assert.equal(manifest.publishConfig?.access, "public");
assert.notEqual(manifest.private, true);
execFileSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], { stdio: "pipe" });
console.log(`Release source validated: ${manifest.name}@${manifest.version}, ${tag}, committed on origin/main.`);
