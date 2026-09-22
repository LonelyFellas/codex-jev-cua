import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerJevCodexCua } from "../src/pi-extension.ts";
import { loadPiConfig } from "../src/pi-config.ts";
import { createSkyDriver, skyText } from "../src/sky-driver.ts";
import { SkyClient, newTurnIdentity, prepareArguments, requestMeta } from "../src/sky/client.ts";
import { runTask } from "../src/loop.ts";
import { createJevDecider } from "../src/jev.ts";
import { nativeToolNames } from "../src/native-tools.ts";

const AX = 'Window: Calculator\n0 standard window Calculator\n  1 text 0\n  10 button 6\n  11 button Equals';
const decision = { action: "click_element" as const, targetIndex: 10, confidence: 1, done: 0, risk: 0 };

function harness(consent = true, hasUI = true, nativeApproval = false, traceDirectory?: string) {
  const tools = new Map<string, ToolDefinition>();
  let activeTools: string[] = [];
  const events = new Map<string, () => void>();
  const calls: string[] = [];
  let display = AX;
  let prompts = 0;
  const confirmations: string[] = [];
  let creations = 0;
  let closes = 0;
  const pi = {
    registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); activeTools.push(tool.name); },
    getActiveTools() { return activeTools; },
    setActiveTools(names: string[]) { activeTools = names; },
    appendEntry() {},
    registerCommand() {},
    on(name: string, fn: () => void) { events.set(name, fn); },
  } as unknown as ExtensionAPI;
  registerJevCodexCua(pi, {
    traceDirectory,
    config: () => ({ apiKey: "test-key", allowedApps: ["Calculator"], envFile: "/not-real", mode: "jev" }), runtimeCheck() {},
    client: () => {
      creations++;
      return {
        async callSky(method, args, _turn, signal, approve) {
          calls.push(method);
          if (nativeApproval && method === "get_app_state") {
            const accepted = await approve?.("Allow ChatGPT to use Calculator?", signal ?? new AbortController().signal);
            if (!accepted) return { isError: true, content: [{ type: "text", text: "App access declined" }] };
          }
          if (method === "get_app_state") { assert.equal(args.disableDiff, true); return { content: [{ type: "text", text: display }] }; }
          if (method === "click") { assert.equal(args.element_index, 10); display = AX.replace("text 0", "text 6"); }
          return { content: [{ type: "text", text: "ok" }] };
        },
        close() { closes++; },
      };
    },
  });
  const ctx = {
    hasUI, sessionManager: { getSessionId: () => "test-session" }, model: { id: "test-model" }, thinkingLevel: "low",
    ui: { async confirm(_title: string, message: string) { prompts++; confirmations.push(message); return consent; } },
  } as unknown as ExtensionContext;
  return {
    tools, events, calls, confirmations,
    call: (name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) => tools.get(name)!.execute("id", args, signal, undefined, ctx),
    get prompts() { return prompts; }, get creations() { return creations; }, get closes() { return closes; },
  };
}

test("pi factory and local status never start a process or disclose key", async () => {
  const h = harness();
  assert.equal(h.creations, 0);
  assert.deepEqual([...h.tools.keys()], ["cua_status", "jev_cua_status", ...nativeToolNames, "jev_cua_observe", "jev_cua_run"]);
  const result = await h.call("jev_cua_status");
  assert.match(JSON.stringify(result), /apiKeyConfigured/);
  assert.ok(!JSON.stringify(result).includes("test-key"));
  assert.equal(h.creations, 0);
});
test("pi still refuses apps outside the user-configured allowlist", async () => {
  const h = harness();
  await assert.rejects(h.call("jev_cua_observe", { appName: "Mail" }), /not allowed/);
  await assert.rejects(h.call("jev_cua_run", { appName: "Mail", goal: "read" }), /not allowed/);
  assert.equal(h.prompts, 0);
});
test("pi dry-run and execution use fake Jev/Sky through the full registered tool", async (t) => {
  let http = 0;
  t.mock.method(globalThis, "fetch", async () => {
    http++;
    return Response.json({ answers: { target: { choice: "i10", confidence: 1 }, action: { choice: "click_element" }, risk: { noul: 0 }, done: { noul: 0 } } });
  });
  const h = harness();
  const preview = await h.call("jev_cua_run", { appName: "Calculator", goal: "Enter 6", dryRun: true });
  assert.match(JSON.stringify(preview), /dry_run/);
  assert.deepEqual(h.calls, ["get_app_state"]);
  const executed = await h.call("jev_cua_run", { appName: "Calculator", goal: "Enter 6", maxSteps: 1, verify: { role: "text", labelEquals: "6" } });
  assert.match(JSON.stringify(executed), /"verified":true/);
  assert.deepEqual(h.calls, ["get_app_state", "get_app_state", "get_app_state", "click", "get_app_state"]);
  assert.equal(http, 2);
  assert.equal(h.prompts, 0, "Ordinary preview/execution must not add plugin approval dialogs.");
  assert.equal(h.creations, 1);
  h.events.get("session_shutdown")!();
  assert.equal(h.closes, 1);
});
test("pi fullTrace is opt-in, disclosed in consent, and returns a usable private file path", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jev-pi-trace-"));
  t.mock.method(globalThis, "fetch", async () => Response.json({ answers: {
    target: { choice: "i10", confidence: 1 }, action: { choice: "click_element" }, risk: { noul: 0 }, done: { noul: 0 },
  } }));
  try {
    const h = harness(true, true, false, directory);
    await h.call("jev_cua_run", { appName: "Calculator", goal: "Enter 6" });
    assert.deepEqual(await readdir(directory), [], "Default run must not record app data.");
    const denied = harness(false, true, false, directory);
    await denied.call("jev_cua_run", { appName: "Calculator", goal: "Enter 6", fullTrace: true });
    assert.deepEqual(await readdir(directory), [], "Declining consent must not create a trace.");
    const recorded = await h.call("jev_cua_run", { appName: "Calculator", goal: "Enter 6", fullTrace: true });
    assert.ok(h.confirmations.at(-1)?.includes("完整轨迹"));
    assert.ok(h.confirmations.at(-1)?.includes(directory));
    const details = recorded.details as { tracePath?: string };
    assert.ok(details.tracePath);
    const data = await readFile(details.tracePath, "utf8");
    assert.ok(data.includes("decision_input"));
    assert.ok(data.includes("button 6"));
    assert.ok(!data.includes("test-key"));
    t.mock.method(globalThis, "fetch", async () => { throw new Error("network failed"); });
    await assert.rejects(h.call("jev_cua_run", { appName: "Calculator", goal: "Enter 6", fullTrace: true }), /Trace: .*\.jsonl; incomplete=false/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("only actual native app approval asks the user; denial and headless mode never silently accept", async () => {
  const h = harness(true, true, true);
  await h.call("jev_cua_observe", { appName: "Calculator" });
  assert.equal(h.prompts, 1, "Only the official native request should show a dialog.");
  for (const denied of [harness(false, true, true), harness(true, false, true)]) {
    await assert.rejects(denied.call("jev_cua_observe", { appName: "Calculator" }), /Sky rejected/);
    assert.deepEqual(denied.calls, ["get_app_state"]);
  }
});
test("normal headless read does not require a plugin dialog, while full trace still requires UI consent", async () => {
  const h = harness(true, false);
  await h.call("jev_cua_observe", { appName: "Calculator" });
  assert.equal(h.prompts, 0);
  await assert.rejects(h.call("jev_cua_run", { appName: "Calculator", goal: "Enter 6", fullTrace: true }), /Full trace recording requires/);
});
test("uncertain Jev choice returns useful planner context without dispatching or asking the user", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ answers: {
    target: { choice: "i10", confidence: 0.35 }, action: { choice: "click_element" }, risk: { noul: 0.05 }, done: { noul: 0.05 },
  } }));
  const h = harness();
  const result = await h.call("jev_cua_run", { appName: "Calculator", goal: "Enter 6", maxSteps: 5 });
  const details = result.details as { status: string; handoff: { remainingSteps: number; context: string; candidates: { index: number }[] } };
  assert.equal(details.status, "needs_planner");
  assert.equal(details.handoff.remainingSteps, 5);
  assert.ok(details.handoff.candidates.some((e) => e.index === 10));
  assert.match(details.handoff.context, /text 0/);
  assert.equal(h.prompts, 0);
  assert.deepEqual(h.calls, ["get_app_state"]);
});
test("pi observation does not call Jev", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("must not call"); });
  const h = harness();
  const result = await h.call("jev_cua_observe", { appName: "Calculator" });
  assert.match(JSON.stringify(result), /button 6/);
  assert.deepEqual(h.calls, ["get_app_state"]);
  assert.equal(h.prompts, 0);
});
test("config loads package env, enforces permissions and does not modify process.env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-config-"));
  const path = join(dir, ".env.local");
  const before = process.env.TYPESAFE_API_KEY;
  try {
    await writeFile(path, "TYPESAFE_API_KEY=synthetic-only\nJEV_CUA_ALLOWED_APPS=Calculator, TextEdit\n", { mode: 0o600 });
    assert.deepEqual(loadPiConfig({}, path), { apiKey: "synthetic-only", allowedApps: ["Calculator", "TextEdit"], envFile: path, appAccess: "all", appAccessFile: `${path}.access.json`, appAccessSource: "default" });
    assert.equal(loadPiConfig({ TYPESAFE_API_KEY: "override" }, path).apiKey, "override");
    assert.equal(loadPiConfig({ JEV_CUA_MODE: "native" }, path).mode, "native");
    assert.equal(loadPiConfig({ JEV_CUA_MODE: "jev" }, path).mode, "jev");
    assert.throws(() => loadPiConfig({ JEV_CUA_MODE: "auto" }, path), /native or jev/);
    assert.equal(process.env.TYPESAFE_API_KEY, before);
    await chmod(path, 0o644);
    assert.throws(() => loadPiConfig({}, path), /permissions/);
    assert.deepEqual(loadPiConfig({}, join(dir, "missing")).allowedApps, ["Calculator"]);
    assert.throws(() => loadPiConfig({ JEV_CUA_ENV_FILE: join(dir, "missing") }), /Cannot safely/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("Sky adapter discards screenshots, maps fields and normalizes navigation keys", async () => {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const driver = createSkyDriver({ async callSky(method, args) {
    calls.push({ method, args }); return { content: [{ type: "text", text: AX }, { type: "image", data: "DO_NOT_SEND", mimeType: "image/png" }] };
  } }, newTurnIdentity("session", "model"));
  await driver.bind("Calculator");
  assert.equal(await driver.observe(), AX);
  await driver.click!(10); await driver.setValue!(10, "6"); await driver.typeText!("6"); await driver.pressKey!("Shift+Tab"); await driver.scroll!(10, "down", 1);
  assert.deepEqual(calls.map((c) => c.method), ["get_app_state", "click", "set_value", "type_text", "press_key", "scroll"]);
  assert.equal(calls[4]?.args.key, "Shift_L+Tab");
  assert.equal(prepareArguments({ element_index: 10 }).element_index, "10");
  const meta = requestMeta(newTurnIdentity("session", "model", "low"));
  assert.equal(meta["x-codex-turn-metadata"].session_id, "session");
});
test("cancellation before start and after decision dispatches no action", async () => {
  for (const early of [true, false]) {
    const controller = new AbortController();
    let actions = 0; let reads = 0;
    if (early) controller.abort();
    const result = await runTask({ driver: { async bind() {}, async observe() { reads++; return AX; }, async click() { actions++; } },
      signal: controller.signal, appName: "Calculator", goal: "6", dryRun: false,
      decide: async () => { controller.abort(); return decision; } });
    assert.equal(result.reason, "cancelled");
    assert.equal(actions, 0);
    assert.equal(reads, early ? 0 : 1);
  }
});
test("cancellation after dispatch reports unknown outcome and never retries", async () => {
  const controller = new AbortController();
  let actions = 0;
  const result = await runTask({ driver: { async bind() {}, async observe() { return AX; }, async click() { actions++; controller.abort(); } },
    signal: controller.signal, appName: "Calculator", goal: "6", dryRun: false, decide: async () => decision });
  assert.equal(result.reason, "cancelled");
  assert.equal(result.outcomeUnknown, true);
  assert.equal(actions, 1);
});
test("Jev HTTP observes external cancellation", async () => {
  const controller = new AbortController();
  const decide = createJevDecider({ apiKey: "fake", signal: controller.signal, fetchImpl: async (_url, args) => {
    controller.abort(); assert.equal(args?.signal?.aborted, true); throw new Error("aborted");
  } });
  await assert.rejects(decide({ app: "Calculator", goal: "6", candidates: [{ index: 10, role: "button", label: "6", raw: "10 button 6", depth: 0 }], context: "", constraints: "", recentActions: [] }), /cancelled/);
});
test("partial native AX updates cannot be mistaken for full window state", () => {
  assert.throws(() => skyText({ content: [{ type: "text", text: "Updated elements:\n10 button 6" }] }), /full AX window tree/);
  assert.throws(() => skyText({ content: [{ type: "image", data: "omitted", mimeType: "image/png" }] }), /AX text/);
});
test("Sky spawn errors fail promptly and a closed client never restarts", async () => {
  const client = new SkyClient({ codexCliPath: "/nonexistent/jev-test-binary", clientPath: "unused", socketDirectory: tmpdir(), cwd: tmpdir() }, 1000);
  const turn = newTurnIdentity("session", "model");
  await assert.rejects(client.callSky("get_app_state", { app: "Calculator" }, turn), /launch|pipe|closed/);
  await assert.rejects(client.callSky("get_app_state", {}, turn), /closed/);
  client.close();
});
