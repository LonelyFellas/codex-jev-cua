import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerJevCodexCua } from "../src/pi-extension.ts";
import { loadPiConfig } from "../src/pi-config.ts";
import { SkyClient } from "../src/sky/client.ts";
import { resolveSkyRuntime } from "../src/sky/runtime.ts";

if (process.argv.slice(2).length !== 1 || process.argv[2] !== "--live") {
  console.error("Read-only live acceptance. Pass --live to read Calculator using real Sky. May focus/open Calculator and request official approval. No clicks, typing, Jev API calls or changes to user configuration.");
  process.exitCode = 1;
} else {
  await acceptAppAccess();
}

async function acceptAppAccess(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "jev-app-access-live-"));
  const file = join(directory, "config.env");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  let activeTools: string[] = [];
  let client: SkyClient | undefined;
  let reads = 0; let approvals = 0;
  let stage = "setup";
  const sessionId = randomUUID();
  const originalFetch = globalThis.fetch;
  const report = (event: string, details: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, readOnlyLiveTest: true, ...details }));
  const configure = (appAccess: "allowlist" | "all") => writeFile(file,
    `JEV_CUA_MODE=native\nJEV_CUA_ALLOWED_APPS=\nJEV_CUA_APP_ACCESS=${appAccess}\n`, { mode: 0o600 });
  const ctx = {
    hasUI: true, model: { id: "read-only-app-access-test" }, thinkingLevel: "low",
    sessionManager: { getSessionId: () => sessionId, getBranch: () => [] },
    ui: {
      notify() {},
      async confirm(_title: string, message: string, options?: { signal?: AbortSignal }) {
        if (!/Calculator|计算器/i.test(message)) throw new Error("Unexpected approval scope; stopped.");
        approvals++;
        report("official_approval_prompt", { promptNumber: approvals });
        try {
          const result = await promisify(execFile)("/usr/bin/osascript", ["-e", [
            "on run argv",
            'set response to display dialog (item 1 of argv) with title "应用范围只读测试 · 官方 Computer Use 授权" buttons {"Cancel", "Allow"} default button "Cancel" cancel button "Cancel" giving up after 60',
            'if gave up of response then return "Cancel"',
            "return button returned of response",
            "end run",
          ].join("\n"), message], { signal: options?.signal ?? controller.signal });
          const accepted = result.stdout.trim() === "Allow";
          report("official_approval_response", { accepted });
          return accepted;
        } catch {
          report("official_approval_response", { accepted: false });
          return false;
        }
      },
    },
  } as unknown as ExtensionContext;
  const pi = {
    registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); activeTools.push(tool.name); },
    registerCommand() {}, appendEntry() {},
    getActiveTools: () => activeTools,
    setActiveTools(names: string[]) { activeTools = names; },
    on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) { handlers.set(name, handler); },
  } as unknown as ExtensionAPI;
  const call = (name: string, args: Record<string, unknown> = {}) => tools.get(name)!.execute("app-access-test", args, controller.signal, undefined, ctx);
  try {
    globalThis.fetch = async () => { throw new Error("No HTTP/TypeSafe requests permitted in this test."); };
    await configure("allowlist");
    registerJevCodexCua(pi, {
      // Empty environment and isolated file: never load the user's key or grants.
      config: () => loadPiConfig({}, file), runtimeCheck: () => { resolveSkyRuntime(); },
      client: () => {
        client = new SkyClient(resolveSkyRuntime());
        return { close: () => client!.close(), async callSky(method, args, identity, signal, approve) {
          assert.equal(args.app, "Calculator");
          assert.equal(method, "get_app_state", "No native write dispatch permitted.");
          reads++;
          return client!.callSky(method, args, identity, signal, approve);
        } };
      },
    });
    handlers.get("session_start")?.({}, ctx);
    handlers.get("agent_start")?.({}, ctx);
    stage = "default_denial";
    await assert.rejects(call("cua_get_app_state", { app: "Calculator" }), /not allowed/);
    assert.equal(reads, 0);
    report("default_denied_before_sky");

    stage = "all_access_read";
    await configure("all");
    const status = (await call("cua_status")).details as Record<string, unknown>;
    assert.equal(status.appAccess, "all"); assert.equal(status.apiKeyConfigured, false);
    assert.equal(status.officialApproval, "runtime-controlled"); assert.equal(status.systemPermissions, "not-checked");
    await call("jev_cua_observe", { appName: "Calculator" });
    const observed = await call("cua_get_app_state", { app: "Calculator" });
    const details = observed.details as { stateId: string; screenshotAvailable: boolean };
    assert.ok(details.stateId);
    assert.ok(observed.content.some((item) => item.type === "text" && /Calculator|计算器/i.test(item.text)));
    report("real_sky_read_passed", { nativeReads: reads, screenshotAvailable: details.screenshotAvailable });

    stage = "revocation";
    await configure("allowlist");
    await assert.rejects(call("cua_press_key", { app: "Calculator", stateId: details.stateId, key: "Tab" }), /not allowed/);
    await assert.rejects(call("cua_get_app_state", { app: "Calculator" }), /not allowed/);
    await assert.rejects(call("jev_cua_observe", { appName: "Calculator" }), /not allowed/);
    assert.equal(reads, 2);
    assert.equal(((await call("cua_status")).details as Record<string, unknown>).appAccess, "allowlist");
    report("passed", { nativeReads: reads, nativeWrites: 0, officialApprovalPrompts: approvals,
      scope: "Real config loader, plugin handlers and Sky reads in an isolated scripted host. No live pi reload, clicks, typing or Jev API test." });
  } catch (error) {
    report("failed", { stage, errorName: error instanceof Error ? error.name : "UnknownError", nativeReads: reads,
      note: "Stopped without retrying or native writes; no AX content logged." });
    process.exitCode = 1;
  } finally {
    controller.abort(); client?.close(); handlers.get("session_shutdown")?.({}, ctx);
    globalThis.fetch = originalFetch;
    clearTimeout(timeout); process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel);
    await rm(directory, { recursive: true, force: true });
  }
}
