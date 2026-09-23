import test from "node:test";
import assert from "node:assert/strict";
import { NativeMcpSession, type Dependencies } from "../src/mcp/session.ts";
import { nativeSpecs } from "../src/native-specs.ts";
import { launchAppSpec } from "../src/launch-app.ts";
import type { SkyResult } from "../src/sky/client.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createNativeMcpServer } from "../src/mcp/server.ts";

const spec = (method: string) => nativeSpecs.find(s => s.method === method)!;
const signal = () => new AbortController().signal;
const approval = async () => true;
const normal: SkyResult = { content: [{ type: "text", text: "0 window App\n1 button Inspect" }] };
const changed: SkyResult = { isError: true, content: [{ type: "text", text: "The user changed 'App'. Re-query the latest state" }] };
function fixture() {
  let result = normal; let closed = 0; let launches = 0;
  const calls: string[] = [];
  const observations: Record<string, unknown>[] = [];
  const config = { appAccess: "all" as "all" | "allowlist", allowedApps: [] as string[], envFile: "/synthetic" };
  const deps: Dependencies = { config: () => config, limits: { durationMs: 180_000, maxActions: 1 },
    launchApp: async () => { launches++; },
    client: () => ({ close() { closed++; }, async callSky(method, args) { calls.push(method); if (method === "get_app_state") observations.push(args); return result; } }) };
  return { deps, session: new NativeMcpSession(deps), config, calls, observations, setResult(value: SkyResult) { result = value; }, get closed() { return closed; }, get launches() { return launches; } };
}

test("MCP protocol exposes recovery and keeps accepted approval distinct from a refusal", async () => {
  const f = fixture(); const base = f.deps.client;
  f.deps.client = () => {
    const sky = base();
    return { close: () => sky.close(), async callSky(method, args, turn, signal, approve) {
      if (method === "type_text") assert.equal(await approve?.("Synthetic official approval", signal!), true);
      return sky.callSky(method, args, turn, signal, approve);
    } };
  };
  const { server } = createNativeMcpServer(f.deps);
  const client = new Client({ name: "recovery-test", version: "1" }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept" }));
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const text = (r: Awaited<ReturnType<typeof call>>) => (r.content as { text: string }[])[0]!.text;
  try {
    const { taskId } = JSON.parse(text(await call("cua_task_begin", { app: "TextEdit", goal: "Inspect" })));
    const { stateId } = JSON.parse(text(await call("cua_get_app_state", { app: "TextEdit", taskId })));
    f.setResult(changed);
    const failed = await call("cua_type_text", { app: "TextEdit", taskId, stateId, text: "test" });
    assert.equal(failed.isError, true); assert.match(text(failed), /only re-observe/);
    assert.match(text(failed), /accepted/); assert.doesNotMatch(text(failed), /Stop; do not automatically retry or bypass confirmation/);
    assert.equal(JSON.parse(text(await call("cua_status"))).task.id, taskId);
    f.setResult(normal);
    const observed = await call("cua_get_app_state", { app: "TextEdit", taskId });
    assert.equal(observed.isError, undefined); assert.match(JSON.stringify(observed), /Recovery observation/);
    assert.equal(f.calls.filter(m => m === "type_text").length, 1);
  } finally { await client.close(); await server.close(); }
});

for (const app of ["TextEdit", "Safari", "com.tencent.xinWeChat"]) {
  test(`MCP state_changed pauses ${app} for observation without replay or budget renewal`, async () => {
    const f = fixture(); const s = f.session;
    try {
      const { taskId } = await s.begin(app, "Inspect and perform a specific authorized action", signal(), approval);
      const initial = await s.execute(spec("get_app_state"), { app, taskId }, signal(), approval);
      f.setResult(changed);
      await assert.rejects(s.execute(spec("type_text"), { app, taskId, stateId: initial.stateId, text: "test" }, signal(), approval), /Task and remaining budget preserved/);
      assert.equal(s.status().task?.id, taskId); assert.equal(s.status().task?.budget.actions, 1);
      assert.equal(s.status().busy, false); assert.equal(f.closed, 0);
      assert.deepEqual(s.status().recovery, { app, failedMethod: "type_text", previousActionOutcome: "unknown" });
      const count = f.calls.length;
      for (const tool of [spec("click"), spec("list_apps"), launchAppSpec]) {
        await assert.rejects(s.execute(tool, { taskId, app, stateId: initial.stateId, identityType: "name", element_index: 1 }, signal(), approval), /Recovery pending/);
      }
      await assert.rejects(s.begin(app, "Reset", signal(), approval), /Task active/);
      assert.equal(f.calls.length, count); assert.equal(f.launches, 0);
      await assert.rejects(s.execute(spec("get_app_state"), { app, taskId }, signal(), approval), /Task and remaining budget preserved/);
      assert.equal(s.status().recovery?.failedMethod, "type_text", "Do not lose the original unknown operation during repeated state changes");
      f.setResult(normal);
      const fresh = await s.execute(spec("get_app_state"), { app, taskId }, signal(), approval);
      assert.ok(fresh.stateId); assert.notEqual(fresh.stateId, initial.stateId);
      assert.equal(f.observations.at(-1)?.disableDiff, true);
      assert.equal(s.status().recovery, null);
      assert.match(JSON.stringify(fresh.content), /does not prove it failed or succeeded/);
      await assert.rejects(s.execute(spec("click"), { app, taskId, stateId: initial.stateId, element_index: 1 }, signal(), approval), /stale/);
      const next = await s.execute(spec("get_app_state"), { app, taskId }, signal(), approval);
      await assert.rejects(s.execute(spec("click"), { app, taskId, stateId: next.stateId, element_index: 1 }, signal(), approval), /action_budget_exhausted/);
      assert.equal(f.calls.filter(m => m === "type_text").length, 1);
    } finally { s.close(); }
  });
}

test("MCP recovery does not reset elapsed time and stops at the original deadline", async (t) => {
  let now = 0; t.mock.method(performance, "now", () => now);
  const f = fixture(); const s = f.session;
  try {
    const { taskId } = await s.begin("TextEdit", "Inspect", signal(), approval);
    f.setResult(changed);
    await assert.rejects(s.execute(spec("get_app_state"), { app: "TextEdit", taskId }, signal(), approval), /state changed/);
    now = 1000; f.setResult(normal);
    await s.execute(spec("get_app_state"), { app: "TextEdit", taskId }, signal(), approval);
    assert.equal(s.status().task?.budget.remainingMs, 179000);
    f.setResult(changed);
    await assert.rejects(s.execute(spec("get_app_state"), { app: "TextEdit", taskId }, signal(), approval), /state changed/);
    now = 180001;
    await assert.rejects(s.execute(spec("get_app_state"), { app: "TextEdit", taskId }, signal(), approval), /task_deadline_exceeded/);
    assert.equal(s.status().task, null); assert.equal(s.status().recovery, null);
  } finally { s.close(); }
});

test("MCP recovery still checks app scope and cannot hide a cancelled or fatal task", async () => {
  for (const fatal of ["cancelled", "sky_tool_error", "declined"] as const) {
    const f = fixture(); const s = f.session;
    try {
      const { taskId } = await s.begin("TextEdit", "Inspect", signal(), approval);
      f.setResult(changed);
      await assert.rejects(s.execute(spec("get_app_state"), { app: "TextEdit", taskId }, signal(), approval), /state changed/);
      assert.equal(s.status().recovery?.previousActionOutcome, "not_applicable");
      f.config.appAccess = "allowlist";
      await assert.rejects(s.execute(spec("get_app_state"), { app: "TextEdit", taskId }, signal(), approval), /not allowed/);
      f.config.allowedApps.push("TextEdit");
      const controller = new AbortController();
      if (fatal === "cancelled") controller.abort();
      else if (fatal === "declined") f.setResult({ ...changed, diagnostics: { method: "get_app_state", phase: "get_app_state", dispatched: true, rpcOutcome: "tool_error", approval: "declined", code: "state_changed", timings: { bridgeTotalMs: 0, initializeMs: 0, discoveryMs: 0, rpcMs: 0, approvalMs: 0 } } });
      else f.setResult({ isError: true, content: [{ type: "text", text: "private error" }] });
      await assert.rejects(s.execute(spec("get_app_state"), { app: "TextEdit", taskId }, controller.signal, approval), /Desktop task stopped/);
      assert.equal(s.status().task, null); assert.equal(s.status().recovery, null);
    } finally { s.close(); }
  }
});
