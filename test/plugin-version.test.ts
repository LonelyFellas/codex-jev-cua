import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentVersion, versionStatus, checkVersion } from "../src/mcp/version.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNativeMcpServer } from "../src/mcp/server.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path: string) => JSON.parse(read(path));

test("Plugin distribution pins MCP and bundles the matching Claude skill, not pi skills", () => {
  const marketplace = json(".claude-plugin/marketplace.json");
  assert.equal(marketplace.name, "deskhand");
  assert.equal(marketplace.plugins[0].source, "./plugins/deskhand");
  const plugin = json("plugins/deskhand/.claude-plugin/plugin.json");
  assert.equal(plugin.name, "deskhand");
  assert.equal(plugin.version, currentVersion);
  const mcp = json("plugins/deskhand/.mcp.json").mcpServers.deskhand;
  assert.equal(mcp.command, "npx");
  assert.deepEqual(mcp.args, ["--yes", `--package=jev-codex-cua@${currentVersion}`, "deskhand-mcp"]);
  assert.deepEqual(mcp.env, { DESKHAND_DISTRIBUTION: "claude-plugin" });
  assert.equal(read("plugins/deskhand/skills/deskhand-access/SKILL.md"), read("claude-skills/deskhand-access/SKILL.md"));
  assert.equal(json("package-lock.json").version, currentVersion);
});

test("MCP checks updates only on explicit true, with no desktop access", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => Response.json({ name: "jev-codex-cua", version: "99.0.0" }));
  const { server } = createNativeMcpServer({
    config: () => ({ allowedApps: [], appAccess: "all", envFile: "/synthetic" }),
    client: () => { throw new Error("Must not access desktop"); },
  });
  const client = new Client({ name: "version-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try {
    assert.equal(client.getServerVersion()?.version, currentVersion);
    for (const args of [{}, { checkUpdates: false }]) {
      const result = await client.callTool({ name: "cua_status", arguments: args });
      assert.equal(result.isError, undefined);
      assert.match(JSON.stringify(result), /not-checked/);
    }
    assert.equal(request.mock.callCount(), 0);
    const invalid = await client.callTool({ name: "cua_status", arguments: { checkUpdates: "true" } });
    assert.equal(invalid.isError, true); assert.equal(request.mock.callCount(), 0);
    const result = await client.callTool({ name: "cua_status", arguments: { checkUpdates: true } });
    assert.equal(result.isError, undefined); assert.match(JSON.stringify(result), /99.0.0/);
    assert.equal(request.mock.callCount(), 1);
  } finally { await client.close(); await server.close(); }
});

test("local version status does not invoke fetch and never guesses latest", () => {
  const status = versionStatus();
  assert.equal(status.currentVersion, json("package.json").version);
  assert.equal(status.latestVersion, null);
  assert.equal(status.updateCheck, "not-checked");
  assert.match(status.upgradeMethod, /\/plugin/);
});

test("opt-in check validates registry and compares versions numerically", async () => {
  for (const [version, expected] of [["99.0.0", true], [currentVersion, false], ["0.1.0", false]] as const) {
    const result = await checkVersion(undefined, async (url, options) => {
      assert.equal(url, "https://registry.npmjs.org/jev-codex-cua/latest");
      assert.ok(options?.signal); assert.equal(options?.redirect, "error");
      return Response.json({ name: "jev-codex-cua", version });
    });
    assert.equal(result.latestVersion, version);
    assert.equal("updateAvailable" in result && result.updateAvailable, expected);
  }
});

test("failed, aborted and invalid checks retain local status without exposing errors", async () => {
  const responses = [new Response("", { status: 503 }), Response.json({ name: "other", version: "99.0.0" }),
    Response.json({ name: "jev-codex-cua", version: "99.0.0-beta" }), new Response("invalid")];
  for (const response of responses) {
    const result = await checkVersion(undefined, async () => response);
    assert.equal(result.updateCheck, "unavailable"); assert.equal(result.latestVersion, null);
    assert.equal(result.currentVersion, currentVersion);
  }
  const controller = new AbortController(); controller.abort();
  const result = await checkVersion(controller.signal, async (_url, options) => {
    assert.equal(options?.signal?.aborted, true);
    throw new Error("secret proxy credentials");
  });
  assert.equal(result.updateCheck, "unavailable");
  assert.ok(!JSON.stringify(result).includes("secret"));
});
