import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerJevCodexCua } from "../src/pi-extension.ts";
import { TaskBudget } from "../src/task-budget.ts";
import { canReuseActionState, formatNativeResult, newSnapshot } from "../src/native-state.ts";
import type { SkyResult } from "../src/sky/client.ts";
import type { SkyDiagnostics } from "../src/sky/diagnostics.ts";
import { actionOutcome, SkyCallError } from "../src/sky/diagnostics.ts";

const body = 'Window: "Calculator", App: Calculator.\n0 standard window Calculator\n  1 button 6\n  2 text 6';
const observed = 'App=/System/Applications/Calculator.app/ (bundleID com.apple.calculator, pid 42)\n' + body;
const returned = 'App=com.apple.calculator (pid 42)\n' + body;
function result(text = returned): SkyResult { return { content: [{ type: "text", text }, { type: "image", mimeType: "image/png", data: "AA==" }] }; }
function diagnostic(method: string, overrides: Partial<SkyDiagnostics> = {}): SkyDiagnostics {
  return { method, phase: method, dispatched: true, rpcOutcome: "returned", approval: "not_requested",
    timings: { bridgeTotalMs: 7, initializeMs: 1, discoveryMs: 1, rpcMs: 5, approvalMs: 0 }, ...overrides };
}
function harness(limits = { durationMs: 180_000, maxActions: 30 }) {
  const tools = new Map<string, ToolDefinition>();
  const events = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const commands = new Map<string, { handler(args: string, ctx: ExtensionCommandContext): Promise<void> }>();
  let active: string[] = [];
  const ctx = { hasUI: true, model: { id: "synthetic" }, sessionManager: { getSessionId: () => "test", getBranch: () => [] },
    ui: { confirm: async () => true, notify() {} } } as unknown as ExtensionContext;
  let nextAction = result();
  let actionWaits = false;
  let closed = 0;
  const calls: string[] = [];
  const pi = { registerTool(t: ToolDefinition) { tools.set(t.name, t); active.push(t.name); },
    registerCommand(name: string, c: { handler(args: string, ctx: ExtensionCommandContext): Promise<void> }) { commands.set(name, c); },
    getActiveTools: () => active, setActiveTools: (a: string[]) => { active = a; }, appendEntry() {}, sendMessage() {},
    on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => events.set(name, handler),
  } as unknown as ExtensionAPI;
  registerJevCodexCua(pi, { budgetLimits: limits, config: () => ({ allowedApps: ["Calculator"], envFile: "/unused" }), runtimeCheck() {},
    client: () => ({ close() { closed++; }, async callSky(method, _args, _turn, signal) {
      calls.push(method);
      if (method !== "get_app_state" && actionWaits) {
        await new Promise((_resolve, reject) => {
          if (signal?.aborted) reject(signal.reason);
          else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      const r = method === "get_app_state" ? result(observed) : nextAction;
      return { ...r, diagnostics: r.diagnostics ?? diagnostic(method) };
    } }),
  });
  events.get("session_start")!({}, ctx);
  return { calls, get closed() { return closed; }, setAction(r: SkyResult) { nextAction = r; }, waitAction() { actionWaits = true; },
    call: (name: string, args: Record<string, unknown> = {}) => tools.get(name)!.execute("test", args, undefined, undefined, ctx),
    command: () => commands.get("cua-mode")!.handler("native", ctx as ExtensionCommandContext),
    newTurn: () => events.get("agent_start")!({}, ctx) };
}
const token = (r: { details?: unknown }) => (r.details as { stateId?: string }).stateId;

test("validated returned state allows consecutive actions without an extra observation", async () => {
  const h = harness();
  const first = await h.call("cua_get_app_state", { app: "Calculator" });
  const second = await h.call("cua_click", { app: "Calculator", stateId: token(first), element_index: 1 });
  assert.ok(token(second)); assert.notEqual(token(first), token(second));
  const details = second.details as { diagnostic: { stateSource: string; actionOutcome: string; observationOutcome: string; formatMs: number; toolElapsedMs: number } };
  assert.equal(details.diagnostic.stateSource, "action_returned_state");
  assert.equal(details.diagnostic.actionOutcome, "call_returned");
  assert.equal(details.diagnostic.observationOutcome, "available");
  assert.ok(details.diagnostic.formatMs >= 0); assert.ok(details.diagnostic.toolElapsedMs >= 0);
  await h.call("cua_click", { app: "Calculator", stateId: token(second), element_index: 1 });
  assert.deepEqual(h.calls, ["get_app_state", "click", "click"]);
  await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: token(first), element_index: 1 }), /stale/);
});

test("partial, cross-process, duplicate, truncated and screenshot-free action states are not reusable", () => {
  const snap = newSnapshot("Calculator", "turn", formatNativeResult(result(observed)));
  for (const r of [result(returned.replace("pid 42", "pid 99")), result(returned.replace("com.apple.calculator", "com.other.app")),
    result("1 button updated"), result(returned + "\n  1 text duplicate"), result(returned + "\npartial update"),
    result(returned + "\n" + "x".repeat(51000)), { content: [{ type: "text" as const, text: returned }] }]) {
    assert.equal(canReuseActionState(snap, formatNativeResult(r)), false);
  }
});

test("RPC success without observation is not task success and does not mint a token", async () => {
  const h = harness(); const first = await h.call("cua_get_app_state", { app: "Calculator" });
  h.setAction({ content: [{ type: "text", text: "Action returned." }] });
  const next = await h.call("cua_click", { app: "Calculator", stateId: token(first), element_index: 1 });
  assert.equal(token(next), undefined);
  assert.equal((next.details as { diagnostic: { observationOutcome: string } }).diagnostic.observationOutcome, "not_reusable");
});

test("noWindowsAvailable after dispatch stays unknown, is redacted and clears state", async () => {
  const h = harness(); const first = await h.call("cua_get_app_state", { app: "Calculator" });
  h.setAction({ isError: true, content: [{ type: "text", text: "Computer Use server error -10005: noWindowsAvailable SECRET_UI" }],
    diagnostics: diagnostic("click", { rpcOutcome: "tool_error", code: "no_windows_available" }) });
  await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: token(first), element_index: 1 }), (e: unknown) => {
    assert.ok(e instanceof Error); assert.match(e.message, /no_windows_available/); assert.doesNotMatch(e.message, /SECRET_UI/);
    const d = (e as Error & { diagnostics: { actionOutcome: string; observationOutcome: string } }).diagnostics;
    assert.equal(d.actionOutcome, "unknown"); assert.equal(d.observationOutcome, "unavailable"); return true;
  });
  assert.equal(h.closed, 1);
  await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: token(first), element_index: 1 }), /stale/);
  assert.equal(h.calls.filter((m) => m === "click").length, 1);
});

test("state-changed replies and declined approval cannot mint an action token", async () => {
  for (const r of [
    { content: [{ type: "text" as const, text: "The user changed 'Calculator'. Re-query the latest state with get_app_state before sending more actions." }], diagnostics: diagnostic("click", { code: "state_changed" }) },
    { ...result(), diagnostics: diagnostic("click", { approval: "declined" }) },
  ]) {
    const h = harness(); const first = await h.call("cua_get_app_state", { app: "Calculator" }); h.setAction(r);
    await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: token(first), element_index: 1 }), /unknown/);
    assert.equal(h.calls.length, 2);
  }
});

test("action budget survives mode changes and reconnection; final reads remain allowed", async () => {
  const h = harness({ durationMs: 180_000, maxActions: 1 });
  const first = await h.call("cua_get_app_state", { app: "Calculator" });
  await h.call("cua_click", { app: "Calculator", stateId: token(first), element_index: 1 });
  await h.command();
  const final = await h.call("cua_get_app_state", { app: "Calculator" });
  await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: token(final), element_index: 1 }), /action_budget_exhausted/);
  const again = await h.call("cua_get_app_state", { app: "Calculator" });
  await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: token(again), element_index: 1 }), /action_budget_exhausted/);
  assert.equal(h.calls.filter((m) => m === "click").length, 1);
  h.newTurn(); const fresh = await h.call("cua_get_app_state", { app: "Calculator" });
  await h.call("cua_click", { app: "Calculator", stateId: token(fresh), element_index: 1 });
});

test("task deadline aborts in-flight action and prevents further dispatch", async () => {
  const h = harness({ durationMs: 150, maxActions: 30 });
  const first = await h.call("cua_get_app_state", { app: "Calculator" }); h.waitAction();
  await assert.rejects(h.call("cua_click", { app: "Calculator", stateId: token(first), element_index: 1 }), /task_deadline_exceeded/);
  assert.ok(h.closed > 0);
  await assert.rejects(h.call("cua_get_app_state", { app: "Calculator" }), /task_deadline_exceeded/);
  assert.equal(h.calls.length, 2);
  const status = await h.call("cua_status");
  assert.equal((status.details as { taskBudget: { remainingMs: number } }).taskBudget.remainingMs, 0);
});

test("monotonic task clock accounts for gaps and never refills on a new call", () => {
  let now = 0; const budget = new TaskBudget({ durationMs: 100, maxActions: 1 }, () => now);
  assert.equal(budget.status().started, false);
  const first = budget.enter(); budget.beforeDispatch(true); now = 20; first.finish();
  now = 80; const second = budget.enter();
  assert.equal(second.betweenCallsMs, 60); assert.equal(budget.status().remainingMs, 20);
  assert.throws(() => budget.beforeDispatch(true), /action_budget/);
  budget.beforeDispatch(false); second.finish(); now = 101;
  assert.throws(() => budget.enter(), /deadline/);
});

test("outcome classification never equates transport failure to known action failure", () => {
  assert.equal(actionOutcome(diagnostic("click", { dispatched: false, rpcOutcome: "transport_error" }), true), "not_dispatched");
  assert.equal(actionOutcome(diagnostic("click", { rpcOutcome: "transport_error" }), true), "unknown");
  assert.equal(actionOutcome(diagnostic("get_app_state", { rpcOutcome: "tool_error" }), false), "not_applicable");
  assert.throws(() => formatNativeResult({ ...result(), diagnostics: diagnostic("click", { approval: "cancelled" }) }), SkyCallError);
});
