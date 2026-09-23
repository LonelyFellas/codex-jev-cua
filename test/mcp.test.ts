import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createNativeMcpServer } from "../src/mcp/server.ts";
import { NativeMcpSession, nativeConfig } from "../src/mcp/session.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { nativeSpecs } from "../src/native-specs.ts";
import { truncateHead } from "../src/bounded-text.ts";
import type { Dependencies } from "../src/mcp/session.ts";

const ax = 'App=com.apple.calculator (pid 42)\nWindow: "Calculator", App: Calculator.\n0 standard window Calculator\n1 button 6\n2 text 6';
function fixture(options: { approval?: boolean; limits?: Dependencies["limits"]; hang?: boolean } = {}) {
  const calls: string[] = []; let closed = 0;
  const deps: Dependencies = { limits: options.limits, config: () => ({ allowedApps: ["Calculator"], appAccess: "allowlist", envFile: "/synthetic" }),
    client: () => ({ close() { closed++; }, async callSky(method, _args, _turn, signal, approve) {
      calls.push(method);
      if (method === "list_apps") return { content: [{ type: "text", text: "1 app Mail" }] };
      if (options.hang) await new Promise((_resolve, reject) => {
        if (signal?.aborted) reject(signal.reason); else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      if (options.approval && !await approve?.("Allow Calculator?", signal!)) return { isError: true, content: [{ type: "text", text: "declined" }] };
      return { content: [{ type: "text", text: ax }, { type: "image", data: "AA==", mimeType: "image/png" }],
        diagnostics: { method, phase: method, dispatched: true, rpcOutcome: "returned", approval: "not_requested",
          timings: { bridgeTotalMs: 1, initializeMs: 0, discoveryMs: 0, rpcMs: 1, approvalMs: 0 } } };
    } }) };
  return { deps, calls, get closed() { return closed; } };
}
const signal = () => new AbortController().signal;
const spec = (name: string) => nativeSpecs.find((s) => s.name === name)!;

test("MCP handshake advertises only native tools, validates args and forwards explicit approvals", async () => {
  const f = fixture({ approval: true }); const { server } = createNativeMcpServer(f.deps);
  const client = new Client({ name: "test", version: "1" }, { capabilities: { elicitation: { form: {} } } });
  let prompts = 0;
  client.setRequestHandler(ElicitRequestSchema, async () => { prompts++; return { action: "accept", content: { confirm: true } }; });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const decode = (r: Awaited<ReturnType<typeof call>>) => JSON.parse((r.content as { text: string }[])[0]!.text);
  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 13); assert.ok(!JSON.stringify(tools).includes('"name":"jev_cua_run"'));
    assert.equal(decode(await call("cua_status")).mode, "native"); assert.equal(f.calls.length, 0);
    assert.equal((await call("cua_click", { app: "Calculator", stateId: "invented", element_index: 1 })).isError, true);
    assert.equal((await call("cua_task_begin", { app: "Calculator", goal: "6", approved: true })).isError, true);
    const { taskId } = decode(await call("cua_task_begin", { app: "Calculator", goal: "Show 6" })); assert.ok(taskId);
    assert.equal(prompts, 1);
    const first = decode(await call("cua_get_app_state", { app: "Calculator", taskId })); assert.ok(first.stateId);
    assert.equal(prompts, 2);
    const action = await call("cua_click", { app: "Calculator", taskId, stateId: first.stateId, element_index: 1 });
    assert.ok(decode(action).stateId); assert.ok((action.content as { type: string }[]).some((c) => c.type === "image"));
    assert.equal((await call("cua_task_begin", { app: "Calculator", goal: "Renew" })).isError, true);
    assert.equal(decode(await call("cua_task_end", { taskId })).ended, true);
    assert.equal((await call("cua_get_app_state", { app: "Calculator", taskId })).isError, true);
  } finally { await client.close(); await server.close(); }
});

test("client without elicitation cannot start a task or reach Sky", async () => {
  const f = fixture(); const { server } = createNativeMcpServer(f.deps);
  const client = new Client({ name: "headless", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  try {
    const result = await client.callTool({ name: "cua_task_begin", arguments: { app: "Calculator", goal: "6" } });
    assert.equal(result.isError, true); assert.equal(f.calls.length, 0);
  } finally { await client.close(); await server.close(); }
});

test("task scope, single-use states and no-reset budgets hold independently of pi", async () => {
  const f = fixture({ limits: { durationMs: 180000, maxActions: 1 } }); const s = new NativeMcpSession(f.deps);
  try {
    await assert.rejects(s.begin("Mail", "read", signal(), async () => true), /not allowed/);
    const { taskId } = await s.begin("Calculator", "6", signal(), async () => true);
    const first = await s.execute(spec("cua_get_app_state"), { app: "Calculator", taskId }, signal(), async () => true);
    await assert.rejects(s.execute(spec("cua_click"), { app: "Mail", taskId, stateId: first.stateId, element_index: 1 }, signal(), async () => true), /bound/);
    const second = await s.execute(spec("cua_click"), { app: "Calculator", taskId, stateId: first.stateId, element_index: 1 }, signal(), async () => true);
    assert.ok(second.stateId);
    await assert.rejects(s.execute(spec("cua_click"), { app: "Calculator", taskId, stateId: second.stateId, element_index: 1 }, signal(), async () => true), /stopped/);
    assert.equal(f.calls.filter((c) => c === "click").length, 1); assert.equal(s.status().task, null);
    await assert.rejects(s.begin("Calculator", "renew", signal(), async () => false), /declined/);
    assert.equal(s.status().task, null);
  } finally { s.close(); }
});

test("official approval denial stops task, and cancellation aborts in-flight Sky calls", async () => {
  const denied = fixture({ approval: true }); const s = new NativeMcpSession(denied.deps);
  const { taskId } = await s.begin("Calculator", "6", signal(), async () => true);
  await assert.rejects(s.execute(spec("cua_get_app_state"), { app: "Calculator", taskId }, signal(), async () => false), /stopped/);
  assert.equal(s.status().task, null); assert.equal(denied.closed, 1);
  const f = fixture({ hang: true, limits: { durationMs: 100, maxActions: 30 } }); const h = new NativeMcpSession(f.deps);
  const task = await h.begin("Calculator", "6", signal(), async () => true);
  await assert.rejects(h.execute(spec("cua_get_app_state"), { app: "Calculator", taskId: task.taskId }, signal(), async () => true), /task_deadline_exceeded/);
  assert.equal(h.status().task, null); assert.equal(f.closed, 1);
});

test("deadline classification uses the abort reason even if the clock still shows time remaining", async (t) => {
  // Deterministically model a timer firing before the next monotonic clock sample reaches
  // the deadline; this must not depend on host timer resolution or CI scheduling.
  t.mock.method(performance, "now", () => 0);
  const f = fixture({ hang: true, limits: { durationMs: 10, maxActions: 30 } });
  const s = new NativeMcpSession(f.deps);
  try {
    const { taskId } = await s.begin("Calculator", "6", signal(), async () => true);
    await assert.rejects(s.execute(spec("cua_get_app_state"), { app: "Calculator", taskId }, signal(), async () => true), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /"reason":"task_deadline_exceeded"/);
      assert.match(error.message, /"remainingMs":10/);
      return true;
    });
    assert.equal(s.status().task, null);
    assert.equal(f.closed, 1);
  } finally { s.close(); }
});

test("MCP config stays native, uses an independent path and preserves explicit app access", () => {
  const home = mkdtempSync(join(tmpdir(), "deskhand-mcp-config-"));
  try {
    const base = nativeConfig({ JEV_CUA_ENV_FILE: "/do/not/read/pi.env", JEV_CUA_MODE: "jev" }, home);
    assert.equal(base.appAccess, "allowlist"); assert.equal(base.mode, "native");
    assert.equal(base.envFile, join(home, ".config/deskhand/cua.env"));
    const path = join(home, "native.env");
    writeFileSync(path, "JEV_CUA_APP_ACCESS=all\nJEV_CUA_MODE=jev\nTYPESAFE_API_KEY=synthetic\n", { mode: 0o600 });
    const all = nativeConfig({ DESKHAND_CONFIG_FILE: path }, home);
    assert.equal(all.appAccess, "all"); assert.equal(all.apiKey, undefined); assert.equal(all.mode, "native");
    assert.throws(() => nativeConfig({ DESKHAND_CONFIG_FILE: join(home, "missing") }, home));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("closing during approval cannot resurrect a task", async () => {
  const f = fixture(); const s = new NativeMcpSession(f.deps);
  let resolve!: (value: boolean) => void;
  const pending = s.begin("Calculator", "6", signal(), () => new Promise<boolean>((r) => { resolve = r; }));
  s.close(); resolve(true);
  await assert.rejects(pending, /closed/); assert.equal(s.status().task, null); assert.equal(f.calls.length, 0);
});

test("elicitation acceptance without explicit checked confirmation is not approval", async () => {
  const f = fixture(); const { server } = createNativeMcpServer(f.deps);
  const client = new Client({ name: "test", version: "1" }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: { confirm: false } }));
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  try {
    const r = await client.callTool({ name: "cua_task_begin", arguments: { app: "Calculator", goal: "6" } });
    assert.equal(r.isError, true); assert.equal(f.calls.length, 0);
  } finally { await client.close(); await server.close(); }
});

test("session shutdown cancels an in-flight bridge request and closes its connection", async () => {
  const f = fixture({ hang: true }); const s = new NativeMcpSession(f.deps);
  const { taskId } = await s.begin("Calculator", "6", signal(), async () => true);
  const pending = s.execute(spec("cua_get_app_state"), { app: "Calculator", taskId }, signal(), async () => true);
  assert.deepEqual(f.calls, ["get_app_state"]);
  s.close();
  await assert.rejects(pending, /stopped/);
  assert.equal(f.closed, 1);
  assert.equal(s.status().task, null);
  assert.equal(s.status().busy, false);
});

test("app discovery never republishes window tokens or accepts its indexes for actions", async () => {
  const f = fixture(); const s = new NativeMcpSession(f.deps);
  try {
    const { taskId } = await s.begin("Calculator", "6", signal(), async () => true);
    const observed = await s.execute(spec("cua_get_app_state"), { app: "Calculator", taskId }, signal(), async () => true);
    const apps = await s.execute(spec("cua_list_apps"), { taskId }, signal(), async () => true);
    assert.equal(apps.stateId, undefined);
    const header = JSON.parse(apps.content[0]!.type === "text" ? apps.content[0]!.text : "{}");
    assert.equal(header.stateId, undefined);
    assert.equal(header.diagnostic.observationOutcome, "not_reusable");
    assert.doesNotMatch(header.instruction, /Use only this observation's indexes/);
    await assert.rejects(s.execute(spec("cua_click"), { app: "Calculator", taskId, stateId: observed.stateId, element_index: 1 }, signal(), async () => true), /stale/);
    assert.deepEqual(f.calls, ["get_app_state", "list_apps"]);
    const fresh = await s.execute(spec("cua_get_app_state"), { app: "Calculator", taskId }, signal(), async () => true);
    await s.execute(spec("cua_click"), { app: "Calculator", taskId, stateId: fresh.stateId, element_index: 1 }, signal(), async () => true);
    assert.equal(f.calls.at(-1), "click");
  } finally { s.close(); }
});

test("real stdio CLI exits promptly on EOF while waiting for task approval", { timeout: 8000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "deskhand-mcp-eof-"));
  const child = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../src/mcp/cli.ts", import.meta.url))],
    { env: { PATH: process.env.PATH, HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(child, "exit");
  const lines = createInterface({ input: child.stdout });
  let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const send = (message: object) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const approval = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      guard = setTimeout(() => reject(new Error("No elicitation from CLI: " + stderr)), 4000);
      lines.on("line", (line) => {
        try {
          const message = JSON.parse(line);
          if (message.id === 1 && message.result) {
            send({ method: "notifications/initialized" });
            send({ id: 2, method: "tools/call", params: { name: "cua_task_begin", arguments: { app: "Calculator", goal: "Synthetic EOF test; no desktop access" } } });
          }
          if (message.method === "elicitation/create") resolve();
        } catch (error) { reject(error); }
      });
    });
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: { elicitation: { form: {} } }, clientInfo: { name: "eof-test", version: "1" } } });
    await approval; clearTimeout(guard);
    child.stdin.end();
    await Promise.race([exited, new Promise((_, reject) => { guard = setTimeout(() => reject(new Error("CLI stayed alive after stdin EOF")), 1500); })]);
    assert.equal(child.exitCode, 0, stderr);
    assert.equal(child.signalCode, null);
  } finally {
    clearTimeout(guard); lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited; rmSync(home, { recursive: true, force: true });
  }
});

test("shared text cap preserves unicode boundaries and enforces byte/line limits", () => {
  assert.deepEqual(truncateHead("你好\nabc", { maxBytes: 6, maxLines: 10 }), { content: "你好", truncated: true });
  assert.deepEqual(truncateHead("a\nb", { maxBytes: 10, maxLines: 1 }), { content: "a", truncated: true });
  assert.deepEqual(truncateHead("a\nb", { maxBytes: 10, maxLines: 2 }), { content: "a\nb", truncated: false });
});
