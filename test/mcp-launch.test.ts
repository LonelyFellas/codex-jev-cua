import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { launchApp, launchArguments, launchAppSpec, LaunchAppError } from "../src/launch-app.ts";
import { NativeMcpSession, type Dependencies } from "../src/mcp/session.ts";
import { createNativeMcpServer } from "../src/mcp/server.ts";
import { nativeSpecs } from "../src/native-specs.ts";

const signal = () => new AbortController().signal;
const approve = async () => true;
const bundleId = "com.tencent.xinWeChat";
function fixture(options: { maxActions?: number; launch?: Dependencies["launchApp"] } = {}) {
  const launches: string[] = []; const skyCalls: string[] = [];
  const config = { appAccess: "all" as "all" | "allowlist", allowedApps: [] as string[], envFile: "/synthetic" };
  const deps: Dependencies = {
    config: () => config, limits: { durationMs: 180_000, maxActions: options.maxActions ?? 30 },
    launchApp: async (app, type, signal) => { launches.push(`${type}:${app}`); await options.launch?.(app, type, signal); },
    client: () => ({ close() {}, async callSky(method) {
      skyCalls.push(method);
      return { content: [{ type: "text", text: "App=WeChat\n0 button Open" }] };
    } }),
  };
  return { deps, launches, skyCalls, config };
}

test("any exact registered app name or Bundle ID becomes one literal argument, never shell input", () => {
  for (const app of ["WeChat", "微信", "飞书", "Google Chrome", "Safari", "zoom.us", "Name With ' Quote", "App;echo injected"]) {
    assert.deepEqual(launchArguments(app, "name"), ["-a", app]);
  }
  assert.deepEqual(launchArguments(bundleId, "bundleId"), ["-b", bundleId]);
  for (const app of ["", "*", "all", "--args", "-n", " WeChat", "/Applications/WeChat.app", "../WeChat.app", "https://example.com", "WeChat\nMail", "WeChat,Mail"]) {
    assert.throws(() => launchArguments(app, "name"));
  }
  assert.throws(() => launchArguments("WeChat", "bundleId"));
});

test("launch supports name and Bundle ID tasks without Sky or a prior observation", async () => {
  for (const [app, identityType] of [[bundleId, "bundleId"], ["Google Chrome", "name"]] as const) {
    const f = fixture(); const s = new NativeMcpSession(f.deps);
    try {
      const { taskId } = await s.begin(app, "Open this application", signal(), approve);
      const result = await s.execute(launchAppSpec, { taskId, app, identityType }, signal(), approve);
      assert.equal(result.stateId, undefined);
      assert.match(JSON.stringify(result.content), /launch_request_accepted/);
      assert.equal(s.status().task?.budget.actions, 1);
      assert.deepEqual(f.launches, [`${identityType}:${app}`]);
      assert.deepEqual(f.skyCalls, []);
    } finally { s.close(); }
  }
});

test("no task, wrong task, cross-app launch and updated allowlist cannot dispatch", async () => {
  const f = fixture(); const s = new NativeMcpSession(f.deps);
  const args = { app: bundleId, identityType: "bundleId" };
  try {
    await assert.rejects(s.execute(launchAppSpec, args, signal(), approve), /taskId/);
    const { taskId } = await s.begin(bundleId, "Open", signal(), approve);
    await assert.rejects(s.execute(launchAppSpec, { ...args, taskId: "wrong" }, signal(), approve), /taskId/);
    await assert.rejects(s.execute(launchAppSpec, { ...args, taskId, app: "com.apple.Safari" }, signal(), approve), /bound/);
    f.config.appAccess = "allowlist";
    await assert.rejects(s.execute(launchAppSpec, { ...args, taskId }, signal(), approve), /not allowed/);
    assert.deepEqual(f.launches, []);
  } finally { s.close(); }
});

test("launch invalidates old UI state; get_app_state is still required before clicks", async () => {
  const f = fixture(); const s = new NativeMcpSession(f.deps);
  const read = nativeSpecs.find(s => s.name === "cua_get_app_state")!;
  const click = nativeSpecs.find(s => s.name === "cua_click")!;
  try {
    const { taskId } = await s.begin(bundleId, "Open", signal(), approve);
    const state = await s.execute(read, { taskId, app: bundleId }, signal(), approve);
    await s.execute(launchAppSpec, { taskId, app: bundleId, identityType: "bundleId" }, signal(), approve);
    await assert.rejects(s.execute(click, { taskId, app: bundleId, stateId: state.stateId, element_index: 0 }, signal(), approve));
    assert.deepEqual(f.skyCalls, ["get_app_state"]);
  } finally { s.close(); }
});

test("a read failure never silently launches an app", async () => {
  const f = fixture();
  f.deps.client = () => ({ close() {}, async callSky() {
    return { isError: true, content: [{ type: "text", text: "Computer Use server error -10005: noWindowsAvailable" }] };
  } });
  const s = new NativeMcpSession(f.deps);
  try {
    const { taskId } = await s.begin(bundleId, "Read only", signal(), approve);
    await assert.rejects(s.execute(nativeSpecs.find(s => s.name === "cua_get_app_state")!, { taskId, app: bundleId }, signal(), approve), /stopped/);
    assert.deepEqual(f.launches, []); assert.equal(s.status().task, null);
  } finally { s.close(); }
});

test("launch shares the task action budget and never retries failed launches", async () => {
  for (const fail of [false, true]) {
    const f = fixture({ maxActions: 1, launch: async () => { if (fail) throw new LaunchAppError("launch_failed"); } });
    const s = new NativeMcpSession(f.deps);
    try {
      const { taskId } = await s.begin(bundleId, "Open", signal(), approve);
      const args = { taskId, app: bundleId, identityType: "bundleId" };
      if (fail) await assert.rejects(s.execute(launchAppSpec, args, signal(), approve), /launch_failed/);
      else await s.execute(launchAppSpec, args, signal(), approve);
      await assert.rejects(s.execute(launchAppSpec, args, signal(), approve));
      assert.equal(f.launches.length, 1); assert.equal(s.status().task, null);
    } finally { s.close(); }
  }
});

test("request cancellation aborts the launcher, stops the task and does not replay", async () => {
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const f = fixture({ launch: async (_app, _type, signal) => {
    entered();
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } });
  const s = new NativeMcpSession(f.deps); const controller = new AbortController();
  try {
    const { taskId } = await s.begin(bundleId, "Open", signal(), approve);
    const pending = s.execute(launchAppSpec, { taskId, app: bundleId, identityType: "bundleId" }, controller.signal, approve);
    await started; controller.abort();
    await assert.rejects(pending, /cancelled/);
    assert.equal(f.launches.length, 1); assert.equal(s.status().task, null);
  } finally { s.close(); }
  // Aborted requests cannot reach the actual OS launcher on any platform.
  await assert.rejects(launchApp(bundleId, "bundleId", controller.signal));
});

test("MCP exposes launch with strict schema and one task approval, without synthetic state", async () => {
  const f = fixture(); const { server } = createNativeMcpServer(f.deps);
  const client = new Client({ name: "launch-test", version: "1" }, { capabilities: { elicitation: { form: {} } } });
  let prompts = 0;
  client.setRequestHandler(ElicitRequestSchema, async () => { prompts++; return { action: "accept" }; });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  try {
    assert.ok((await client.listTools()).tools.some(t => t.name === "cua_launch_app"));
    const begin = await client.callTool({ name: "cua_task_begin", arguments: { app: "Safari", goal: "Open Safari" } });
    const { taskId } = JSON.parse((begin.content as { text: string }[])[0]!.text);
    const args = { taskId, app: "Safari", identityType: "name" };
    const invalid = await client.callTool({ name: "cua_launch_app", arguments: { ...args, url: "https://example.com" } });
    assert.equal(invalid.isError, true); assert.equal(f.launches.length, 0);
    const result = await client.callTool({ name: "cua_launch_app", arguments: args });
    assert.equal(result.isError, undefined); assert.equal(prompts, 1);
    assert.deepEqual(f.launches, ["name:Safari"]); assert.deepEqual(f.skyCalls, []);
  } finally { await client.close(); await server.close(); }
});
