import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPiConfig } from "../src/pi-config.ts";
import { appAccessPath, setAppAccessGrant } from "../src/app-access-grants.ts";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerJevCodexCua, type ExtensionDependencies } from "../src/pi-extension.ts";
import { formatNativeResult, newSnapshot, validateNativeAction } from "../src/native-state.ts";
import { nativeToolNames } from "../src/native-tools.ts";
import type { PiConfig } from "../src/pi-config.ts";
import type { SkyResult } from "../src/sky/client.ts";

const AX = "0 standard window Calculator\n1 button 6\n2 text field (settable) Value: 0\nThe focused UI element is 2 text field";
type Entry = { type: "custom"; customType: string; data: unknown };
function setup(options: { config?: PiConfig | (() => PiConfig); entries?: Entry[]; hasUI?: boolean; approved?: boolean; nativeApproval?: boolean; launch?: ExtensionDependencies["launchApp"]; budgetLimits?: ExtensionDependencies["budgetLimits"] } = {}) {
  let config = options.config ?? { allowedApps: ["Calculator", "Google Chrome"], envFile: "/unused" };
  const tools = new Map<string, ToolDefinition>();
  const commands = new Map<string, { handler(args: string, ctx: ExtensionCommandContext): Promise<void> }>();
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  let active = ["read", "external_tool"];
  const entries: Entry[] = [...(options.entries ?? [])];
  const notices: string[] = [];
  const calls: { method: string; args: Record<string, unknown>; turnId: string }[] = [];
  let created = 0; let closed = 0; let approvals = 0;
  const launches: string[] = [];
  let nativeResult: SkyResult = { content: [{ type: "text", text: AX }, { type: "image", mimeType: "image/png", data: "AA==" }] };
  let beforeRead: (() => Promise<void>) | undefined;
  let actionResult: SkyResult | undefined;
  const ctx = { hasUI: options.hasUI ?? true, model: { id: "test-model" }, thinkingLevel: "low",
    sessionManager: { getSessionId: () => "test-session", getBranch: () => entries },
    ui: { notify(message: string) { notices.push(message); }, async confirm() { approvals++; return options.approved ?? true; } },
  } as unknown as ExtensionContext;
  const pi = { registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); active.push(tool.name); },
    registerCommand(name: string, command: { handler(args: string, ctx: ExtensionCommandContext): Promise<void> }) { commands.set(name, command); },
    getActiveTools: () => active, setActiveTools(names: string[]) { active = names; },
    appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
    sendMessage(message: { content: string }) { notices.push(message.content); },
    on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) { handlers.set(name, handler); },
  } as unknown as ExtensionAPI;
  registerJevCodexCua(pi, { config: () => typeof config === "function" ? config() : config, runtimeCheck() {}, budgetLimits: options.budgetLimits,
    launchApp: async (app, identityType, signal) => { launches.push(`${identityType}:${app}`); await options.launch?.(app, identityType, signal); }, client: () => {
    created++;
    return { async callSky(method, args, turn, signal, approve) {
      calls.push({ method, args, turnId: turn.turnId });
      if (options.nativeApproval && !await approve?.("Allow Calculator?", signal ?? new AbortController().signal)) return { isError: true, content: [{ type: "text", text: "App approval declined" }] };
      if (method === "get_app_state") { await beforeRead?.(); return nativeResult; }
      return actionResult ?? { content: [{ type: "text", text: "Action returned; observe to verify." }] };
    }, close() { closed++; } };
  } });
  const emit = (event: string) => handlers.get(event)?.({}, ctx);
  emit("session_start");
  return { calls, tools, notices, entries, emit, launches,
    get active() { return active; }, get created() { return created; }, get closed() { return closed; }, get approvals() { return approvals; },
    setConfig(next: PiConfig) { config = next; }, setResult(next: SkyResult) { nativeResult = next; }, setActionResult(next: SkyResult) { actionResult = next; },
    pauseRead(callback: () => Promise<void>) { beforeRead = callback; },
    command: (args: string) => commands.get("cua-mode")!.handler(args, ctx as ExtensionCommandContext),
    call: (name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) => tools.get(name)!.execute("id", args, signal, undefined, ctx),
  };
}
function stateId(result: { details?: unknown }): string { return (result.details as { stateId: string }).stateId; }

test("pi native exceeds the old 180s/30-action cap while Jev keeps its limits", async (t) => {
  let now = 0; t.mock.method(performance, "now", () => now);
  const h = setup({ config: { mode: "native", apiKey: "synthetic", allowedApps: ["Calculator"], envFile: "/unused" } });
  for (let i = 0; i < 40; i++) {
    await h.call("cua_launch_app", { app: "Calculator", identityType: "name" });
    now += 10000;
  }
  const native = (await h.call("cua_status")).details as { taskBudget: { actions: number; durationMs: number | null; maxActions: number | null; remainingMs: number | null } };
  assert.equal(native.taskBudget.actions, 40);
  assert.equal(native.taskBudget.durationMs, null); assert.equal(native.taskBudget.maxActions, null); assert.equal(native.taskBudget.remainingMs, null);
  // Unlimited accounting must still permit state_changed's read-only recovery.
  h.setResult({ isError: true, content: [{ type: "text", text: "The user changed 'Calculator'. Re-query the latest state" }] });
  await assert.rejects(h.call("cua_get_app_state", { app: "Calculator" }), /only re-observe/);
  h.setResult({ content: [{ type: "text", text: AX }] });
  await h.call("cua_get_app_state", { app: "Calculator" });
  await h.command("jev");
  const jev = (await h.call("cua_status")).details as typeof native;
  assert.equal(jev.taskBudget.durationMs, 180000); assert.equal(jev.taskBudget.maxActions, 30);
  assert.equal(jev.taskBudget.actions, 40); assert.equal(jev.taskBudget.remainingMs, 0);
  await assert.rejects(h.call("cua_get_app_state", { app: "Calculator" }), /task_deadline_exceeded/);
});

test("pi launch opens arbitrary exact names and IDs without Sky or TypeSafe", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No TypeSafe"); });
  const h = setup({ config: { appAccess: "all", allowedApps: [], envFile: "/unused" } });
  assert.ok(h.active.includes("cua_launch_app"));
  const schema = h.tools.get("cua_launch_app")!.parameters as { properties: { identityType: { type: string; enum: string[] } } };
  assert.deepEqual(schema.properties.identityType.enum, ["name", "bundleId"]);
  assert.equal(schema.properties.identityType.type, "string");
  for (const [app, identityType] of [["Safari", "name"], ["WeChat", "name"], ["飞书", "name"], ["com.apple.TextEdit", "bundleId"]]) {
    const result = await h.call("cua_launch_app", { app, identityType });
    assert.match(JSON.stringify(result), /launch_request_accepted/);
    assert.equal(stateId(result), undefined);
  }
  assert.equal(h.launches.length, 4); assert.equal(h.created, 0); assert.equal(h.calls.length, 0);
  assert.equal(h.approvals, 0);
  const observed = await h.call("cua_get_app_state", { app: "Safari" });
  await h.call("cua_launch_app", { app: "Safari", identityType: "name" });
  await assert.rejects(h.call("cua_click", { app: "Safari", stateId: stateId(observed), element_index: 1 }), /stale/);
});

test("pi launch enforces scope, mode, budget and cancellation", async () => {
  const h = setup({ config: { mode: "native", apiKey: "synthetic", allowedApps: ["Calculator"], envFile: "/unused" }, budgetLimits: { durationMs: 180000, maxActions: 1 } });
  await assert.rejects(h.call("cua_launch_app", { app: "Safari", identityType: "name" }), /not allowed/);
  await h.command("jev");
  assert.ok(!h.active.includes("cua_launch_app"));
  await assert.rejects(h.call("cua_launch_app", { app: "Calculator", identityType: "name" }), /native-mode only/);
  await h.command("native");
  await h.call("cua_launch_app", { app: "Calculator", identityType: "name" });
  await assert.rejects(h.call("cua_launch_app", { app: "Calculator", identityType: "name" }), /action_budget_exhausted/);
  assert.equal(h.launches.length, 1);
  const cancelled = setup(); const controller = new AbortController(); controller.abort();
  await assert.rejects(cancelled.call("cua_launch_app", { app: "Calculator", identityType: "name" }, controller.signal));
  assert.equal(cancelled.launches.length, 0);
});

test("pi launch failures stop fallback and concurrent launch is rejected", async () => {
  let release!: () => void;
  const h = setup({ launch: async () => new Promise<void>(resolve => { release = resolve; }) });
  const running = h.call("cua_launch_app", { app: "Calculator", identityType: "name" });
  await assert.rejects(h.call("cua_launch_app", { app: "Calculator", identityType: "name" }), /busy/);
  release(); await running;
  const failed = setup({ launch: async () => { throw new Error("private stderr"); } });
  await assert.rejects(failed.call("cua_launch_app", { app: "Calculator", identityType: "name" }), error => {
    assert.match(String(error), /launch_failed/); assert.ok(!String(error).includes("private stderr")); return true;
  });
  await assert.rejects(failed.call("cua_launch_app", { app: "Calculator", identityType: "name" }), /blocked/);
  assert.equal(failed.launches.length, 1);
});

test("pi state_changed recovery is app-independent, observation-only and retains action budget", async () => {
  for (const app of ["Mail", "TextEdit", "Safari"]) {
    const h = setup({ config: { appAccess: "all", allowedApps: [], envFile: "/unused" }, budgetLimits: { durationMs: 180000, maxActions: 1 } });
    const observed = await h.call("cua_get_app_state", { app });
    h.setActionResult({ isError: true, content: [{ type: "text", text: `The user changed '${app}'. Re-query the latest state` }] });
    await assert.rejects(h.call("cua_type_text", { app, stateId: stateId(observed), text: "test" }), /only re-observe/);
    const status = (await h.call("cua_status")).details as { recovery: unknown; taskBudget: { actions: number } };
    assert.deepEqual(status.recovery, { app, failedMethod: "type_text", previousActionOutcome: "unknown" });
    assert.equal(status.taskBudget.actions, 1); assert.equal(h.closed, 0);
    const count = h.calls.length;
    for (const [tool, args] of [["cua_type_text", { app, text: "test" }], ["cua_launch_app", { app, identityType: "name" }], ["cua_list_apps", {}], ["cua_get_app_state", { app: "Other" }], ["jev_cua_observe", { appName: app }]] as [string, Record<string, unknown>][]) {
      await assert.rejects(h.call(tool, args), /Recovery pending/);
    }
    assert.equal(h.calls.length, count); assert.equal(h.launches.length, 0);
    h.setResult({ isError: true, content: [{ type: "text", text: `The user changed '${app}'. Re-query the latest state` }] });
    await assert.rejects(h.call("cua_get_app_state", { app }), /only re-observe/);
    assert.deepEqual(((await h.call("cua_status")).details as { recovery: unknown }).recovery, status.recovery);
    h.setResult({ content: [{ type: "text", text: AX }] });
    const fresh = await h.call("cua_get_app_state", { app });
    assert.ok(stateId(fresh)); assert.notEqual(stateId(fresh), stateId(observed));
    assert.equal(h.calls.at(-1)?.args.disableDiff, true);
    assert.match(JSON.stringify(fresh.content), /previous operation took effect/);
    assert.equal(((await h.call("cua_status")).details as { recovery: unknown }).recovery, null);
    await assert.rejects(h.call("cua_click", { app, stateId: stateId(fresh), element_index: 1 }), /action_budget_exhausted/);
    assert.equal(h.calls.filter(c => c.method === "type_text").length, 1);
  }
});

test("pi official denial never enables launch or recovery", async () => {
  const h = setup({ nativeApproval: true, approved: false });
  await assert.rejects(h.call("cua_get_app_state", { app: "Calculator" }));
  assert.equal(((await h.call("cua_status")).details as { recovery: unknown }).recovery, null);
  await assert.rejects(h.call("cua_launch_app", { app: "Calculator", identityType: "name" }), /blocked/);
  assert.equal(h.launches.length, 0);
});

test("default native mode needs no key, does not call Jev and uses one shared client/turn", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Native must not contact TypeSafe"); });
  const h = setup();
  assert.equal(h.created, 0);
  assert.ok(h.active.includes("cua_click"));
  assert.ok(!h.active.includes("jev_cua_run"));
  assert.ok(h.active.includes("external_tool"));
  const status = await h.call("cua_status");
  assert.equal((status.details as { mode: string }).mode, "native");
  const state = await h.call("cua_get_app_state", { app: "Calculator" });
  assert.ok(state.content.some((c) => c.type === "image"));
  await h.call("cua_click", { app: "Calculator", stateId: stateId(state), element_index: 1 });
  assert.equal(h.created, 1);
  assert.equal(h.calls[0]?.turnId, h.calls[1]?.turnId);
  assert.equal(h.calls[1]?.args.stateId, undefined, "Local state tokens must not be passed as native MCP arguments.");
  assert.equal(h.approvals, 0);
  await assert.rejects(h.call("jev_cua_run", { appName: "Calculator", goal: "Enter 6" }), /Native mode/);
  assert.equal(h.calls.length, 2);
});

test("mode choice persists per session, preserves other tools and invalidates prior native state", async () => {
  const config: PiConfig = { apiKey: "synthetic-key", allowedApps: ["Calculator"], envFile: "/unused" };
  const h = setup({ config });
  const observed = await h.call("cua_get_app_state", { app: "Calculator" });
  await h.command("jev");
  assert.ok(h.active.includes("jev_cua_run"));
  assert.ok(!h.active.includes("cua_click"));
  assert.ok(h.active.includes("external_tool"));
  assert.ok(h.notices.at(-1)?.includes("TypeSafe"));
  assert.equal(h.calls.length, 1, "Switching mode must not invoke a desktop action or Jev.");
  const restored = setup({ config, entries: h.entries });
  assert.equal((await restored.call("cua_status")).details && restored.active.includes("jev_cua_run"), true);
  await h.command("native");
  await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: stateId(observed), element_index: 1 }), /stale/);
  assert.ok(!JSON.stringify(h.entries).includes("synthetic-key"));
});

test("missing/lost Jev key falls back without a request and does not silently opt back in", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("must not call"); });
  const h = setup({ config: { allowedApps: ["Calculator"], envFile: "/unused", mode: "jev" } });
  assert.equal((await h.call("cua_status")).details && h.active.includes("cua_click"), true);
  await h.command("jev");
  assert.ok(!h.active.includes("jev_cua_run"));
  const config: PiConfig = { apiKey: "synthetic", allowedApps: ["Calculator"], envFile: "/unused", mode: "jev" };
  h.setConfig(config);
  assert.equal((await h.call("cua_status")).details && h.active.includes("cua_click"), true);
  await h.command("jev");
  assert.ok(h.active.includes("jev_cua_run"));
  h.setConfig({ ...config, apiKey: undefined });
  await assert.rejects(h.call("jev_cua_run", { appName: "Calculator", goal: "Enter 6" }), /Native mode/);
  assert.equal(h.created, 0);
  const restored = setup({ config, entries: h.entries });
  assert.ok(!restored.active.includes("jev_cua_run"));
});

test("native menus are returned without Jev role filtering; coordinate clicks still require a screenshot", async () => {
  const h = setup();
  h.setResult({ content: [{ type: "text", text: "0 menu Secondary Actions: Cancel\n1 智能词库" }] });
  const menu = await h.call("cua_get_app_state", { app: "Calculator" });
  assert.match(JSON.stringify(menu.content), /智能词库/);
  await h.call("cua_click", { app: "Calculator", stateId: stateId(menu), element_index: 1 });
  const next = await h.call("cua_get_app_state", { app: "Calculator" });
  await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: stateId(next), x: 1, y: 1 }), /screenshot/);
});

test("native stale, cross-app, unknown-index and mixed click targets are rejected before dispatch", async () => {
  const h = setup();
  await assert.rejects(h.call("cua_get_app_state", { app: "Mail" }), /not allowed/);
  for (const wrong of [ { app: "Google Chrome", element_index: 1 }, { app: "Calculator", element_index: 99 }, { app: "Calculator", element_index: 1, x: 2, y: 2 } ]) {
    const observed = await h.call("cua_get_app_state", { app: "Calculator" });
    const count = h.calls.length;
    await assert.rejects(h.call("cua_click", { stateId: stateId(observed), ...wrong }));
    assert.equal(h.calls.length, count);
    await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: stateId(observed), element_index: 1 }), /stale/);
  }
  const observed = await h.call("cua_get_app_state", { app: "Calculator" });
  h.emit("agent_end");
  await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: stateId(observed), element_index: 1 }), /stale/);
  const snap = newSnapshot("Calculator", "turn", formatNativeResult({ content: [{ type: "text", text: AX }] }));
  snap.createdAt -= 61_000;
  assert.throws(() => validateNativeAction(snap, "click", { app: "Calculator", stateId: snap.id, element_index: 1 }, "turn"), /stale/);
});

test("the complete native action surface routes through the same client without any TypeSafe call", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("must not call"); });
  const h = setup();
  assert.equal(nativeToolNames.length, 11);
  const actions: [string, Record<string, unknown>][] = [
    ["cua_click", { element_index: 1 }], ["cua_drag", { from_x: 1, from_y: 1, to_x: 2, to_y: 2 }],
    ["cua_perform_secondary_action", { element_index: 1, action: "Press" }], ["cua_press_key", { key: "Tab" }],
    ["cua_scroll", { element_index: 1, direction: "down", pages: 1 }], ["cua_select_text", { element_index: 2, text: "0", selection_type: "text" }],
    ["cua_set_value", { element_index: 2, value: "6" }], ["cua_type_text", { text: "6" }],
  ];
  for (const [tool, args] of actions) {
    const observed = await h.call("cua_get_app_state", { app: "Calculator" });
    await h.call(tool, { app: "Calculator", stateId: stateId(observed), ...args });
    assert.equal(h.calls.at(-1)?.method, tool.slice(4));
  }
  assert.equal(h.created, 1);
  h.emit("session_shutdown");
  assert.equal(h.closed, 1);
});

test("Jev uncertainty opens only same-app, budgeted native handoff and never replays an action", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ answers: {
    target: { choice: "i1", confidence: 0.35 }, action: { choice: "click_element" }, risk: { noul: 0.05 }, done: { noul: 0.02 },
  } }));
  const h = setup({ config: { apiKey: "synthetic", mode: "jev", allowedApps: ["Calculator", "Google Chrome"], envFile: "/unused" } });
  const result = await h.call("jev_cua_run", { appName: "Calculator", goal: "Enter 6", maxSteps: 1 });
  assert.equal((result.details as { status: string }).status, "needs_planner");
  assert.deepEqual(h.calls.map((c) => c.method), ["get_app_state"]);
  assert.ok(h.active.includes("cua_click"));
  const other = await h.call("cua_get_app_state", { app: "Google Chrome" });
  await assert.rejects(h.call("cua_click", { app: "Google Chrome", stateId: stateId(other), element_index: 1 }), /handoff/);
  const observed = await h.call("cua_get_app_state", { app: "Calculator" });
  await h.call("cua_click", { app: "Calculator", stateId: stateId(observed), element_index: 1 });
  assert.ok(!h.active.includes("cua_click"));
  await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: stateId(observed), element_index: 1 }), /budget|handoff/);
});

test("Jev high-risk confirmation never enables a native fallback", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ answers: {
    target: { choice: "i1", confidence: 0.35 }, action: { choice: "click_element" }, risk: { noul: 0.9 }, done: { noul: 0.02 },
  } }));
  const h = setup({ config: { apiKey: "synthetic", mode: "jev", allowedApps: ["Calculator"], envFile: "/unused" } });
  const result = await h.call("jev_cua_run", { appName: "Calculator", goal: "Inspect", maxSteps: 1 });
  assert.equal((result.details as { status: string }).status, "confirm");
  assert.ok(!h.active.includes("cua_click"));
  const observed = await h.call("cua_get_app_state", { app: "Calculator" });
  await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: stateId(observed), element_index: 1 }), /handoff/);
});

test("official approval is preserved in native mode; headless/declined approval is not faked", async () => {
  for (const options of [{ hasUI: true, approved: false }, { hasUI: false, approved: true }]) {
    const h = setup({ ...options, nativeApproval: true });
    await assert.rejects(h.call("cua_get_app_state", { app: "Calculator" }), /declined/);
    assert.equal(h.closed, 1);
    assert.equal(h.approvals, options.hasUI ? 1 : 0);
  }
});

test("all-app access covers native and text reads, preserves state checks, and revokes on the next call", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Native must not contact TypeSafe"); });
  const config: PiConfig = { appAccess: "all", allowedApps: ["Calculator"], envFile: "/unused" };
  const h = setup({ config });
  const status = (await h.call("cua_status")).details as Record<string, unknown>;
  assert.equal(status.appAccess, "all");
  assert.deepEqual(status.allowedApps, ["Calculator"]);
  assert.equal(status.officialApproval, "runtime-controlled");
  assert.equal(status.systemPermissions, "not-checked");
  assert.equal(h.created, 0);
  for (const app of ["Mail", "com.apple.TextEdit", "/Applications/Music.app"]) {
    await h.call("jev_cua_observe", { appName: app });
    const observed = await h.call("cua_get_app_state", { app });
    await h.call("cua_click", { app, stateId: stateId(observed), element_index: 1 });
    assert.equal(h.calls.at(-1)?.args.app, app);
    await assert.rejects(h.call("cua_click", { app, stateId: stateId(observed), element_index: 1 }), /stale/);
  }
  const observed = await h.call("cua_get_app_state", { app: "Mail" });
  h.setConfig({ ...config, appAccess: "allowlist" });
  const before = h.calls.length;
  await assert.rejects(h.call("cua_click", { app: "Mail", stateId: stateId(observed), element_index: 1 }), /not allowed/);
  await assert.rejects(h.call("cua_get_app_state", { app: "Mail" }), /not allowed/);
  await assert.rejects(h.call("jev_cua_observe", { appName: "Mail" }), /not allowed/);
  assert.equal(h.calls.length, before);
  await h.call("cua_get_app_state", { app: "Calculator" });
  assert.equal(h.approvals, 0, "All-app access must not add per-action plugin prompts.");
  assert.equal(((await h.call("cua_status")).details as Record<string, unknown>).appAccess, "allowlist");
});

test("all-app access still requires one concrete application and does not accept tool-argument grants", async () => {
  const h = setup({ config: { appAccess: "all", allowedApps: [], envFile: "/unused" } });
  for (const app of ["*", "all", "全部应用", "Mail,Music", "", "Mail\n", " Mail "]) {
    await assert.rejects(h.call("cua_get_app_state", { app }));
    await assert.rejects(h.call("jev_cua_observe", { appName: app }));
  }
  assert.equal(h.created, 0);
  const restricted = setup();
  await assert.rejects(restricted.call("cua_get_app_state", { app: "Mail", appAccess: "all" }), /not allowed/);
  assert.equal(restricted.created, 0);
  const legacyName = "/Applications/Editor [Beta].app";
  for (const appAccess of ["allowlist", "all"] as const) {
    restricted.setConfig({ appAccess, allowedApps: [legacyName], envFile: "/unused" });
    await restricted.call("cua_get_app_state", { app: legacyName });
    assert.equal(restricted.calls.at(-1)?.args.app, legacyName, "Keep existing exact allowlist matching compatible.");
  }
});

test("all-app Jev runs keep sensitive-action gates and same-app handoff budgets", async (t) => {
  let confidence = 1;
  t.mock.method(globalThis, "fetch", async () => Response.json({ answers: {
    target: { choice: "i1", confidence }, action: { choice: "click_element" }, risk: { noul: 0 }, done: { noul: 0 },
  } }));
  const config: PiConfig = { apiKey: "synthetic", mode: "jev", appAccess: "all", allowedApps: ["Calculator"], envFile: "/unused" };
  const h = setup({ config });
  const args = { appName: "Mail", goal: "Inspect", maxSteps: 1 };
  const preview = await h.call("jev_cua_run", { ...args, dryRun: true });
  assert.equal((preview.details as { status: string }).status, "dry_run");
  for (const label of ["Send", "Pay", "Delete", "Password"]) {
    h.setResult({ content: [{ type: "text", text: `0 standard window Mail\n1 button ${label}` }] });
    const before = h.calls.length;
    const result = await h.call("jev_cua_run", args);
    assert.equal((result.details as { status: string }).status, "confirm");
    assert.deepEqual(h.calls.slice(before).map((c) => c.method), ["get_app_state"]);
    assert.ok(!h.active.includes("cua_click"));
  }
  h.setResult({ content: [{ type: "text", text: AX }] });
  confidence = 0.35;
  const result = await h.call("jev_cua_run", args);
  assert.equal((result.details as { status: string }).status, "needs_planner");
  const other = await h.call("cua_get_app_state", { app: "Music" });
  await assert.rejects(h.call("cua_click", { app: "Music", stateId: stateId(other), element_index: 1 }), /handoff/);
  const observed = await h.call("cua_get_app_state", { app: "Mail" });
  await h.call("cua_click", { app: "Mail", stateId: stateId(observed), element_index: 1 });
  await assert.rejects(h.call("cua_click", { app: "Mail", stateId: stateId(observed), element_index: 1 }), /budget|handoff/);
  h.setConfig({ ...config, appAccess: "allowlist" });
  const before = h.calls.length;
  await assert.rejects(h.call("jev_cua_run", args), /not allowed/);
  assert.equal(h.calls.length, before);
  assert.equal(h.approvals, 0);
});

test("all-app access never fakes official approval in either mode", async () => {
  for (const mode of ["native", "jev"] as const) {
    for (const options of [{ hasUI: true, approved: false }, { hasUI: false, approved: true }]) {
      const h = setup({ ...options, nativeApproval: true,
        config: { mode, apiKey: "synthetic", appAccess: "all", allowedApps: [], envFile: "/unused" } });
      await assert.rejects(mode === "native"
        ? h.call("cua_get_app_state", { app: "Mail" })
        : h.call("jev_cua_run", { appName: "Mail", goal: "Inspect", maxSteps: 1 }), /declined|failed/);
      assert.deepEqual(h.calls.map((c) => c.method), ["get_app_state"]);
      assert.equal(h.closed, 1);
      assert.equal(h.approvals, options.hasUI ? 1 : 0);
    }
  }
});

test("saved Skill choice is reflected by the same plugin instance and controls app scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-skill-runtime-"));
  const file = join(directory, "config.env");
  try {
    await writeFile(file, "JEV_CUA_ALLOWED_APPS=Calculator\n", { mode: 0o600 });
    const h = setup({ config: () => loadPiConfig({}, file) });
    const before = (await h.call("cua_status")).details as Record<string, unknown>;
    assert.equal(before.appAccessFile, appAccessPath(file));
    assert.equal(before.appAccessSource, "default");
    assert.equal(before.appAccess, "all");
    await h.call("cua_get_app_state", { app: "Music" });
    setAppAccessGrant("all", appAccessPath(file));
    const enabled = (await h.call("cua_status")).details as Record<string, unknown>;
    assert.equal(enabled.appAccess, "all");
    assert.equal(enabled.appAccessSource, "grant-file");
    assert.equal(enabled.systemPermissions, "not-checked");
    const observed = await h.call("cua_get_app_state", { app: "Music" });
    setAppAccessGrant("allowlist", appAccessPath(file));
    await assert.rejects(h.call("cua_click", { app: "Music", stateId: stateId(observed), element_index: 1 }), /not allowed/);
    assert.deepEqual(h.calls.map((c) => c.method), ["get_app_state", "get_app_state"]);
    assert.equal(((await h.call("cua_status")).details as Record<string, unknown>).appAccess, "allowlist");
    await h.call("cua_get_app_state", { app: "Calculator" });
    assert.equal(h.approvals, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("busy native calls prevent both mode switching and overlapping operations", async () => {
  const h = setup({ config: { apiKey: "synthetic", allowedApps: ["Calculator"], envFile: "/unused" } });
  let release!: () => void;
  h.pauseRead(() => new Promise<void>((resolve) => { release = resolve; }));
  const running = h.call("cua_get_app_state", { app: "Calculator" });
  await h.command("jev");
  assert.ok(h.notices.at(-1)?.includes("仍在运行"));
  await assert.rejects(h.call("jev_cua_observe", { appName: "Calculator" }), /busy/);
  release();
  await running;
  assert.ok(!h.active.includes("jev_cua_run"));
});
