import test from "node:test";
import assert from "node:assert/strict";
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkyClient, newTurnIdentity } from "../src/sky/client.ts";

async function setup(timeout = 10_000, clientPath = "unused") {
  const directory = await mkdtemp(join(tmpdir(), "jev-fake-sky-"));
  const executable = join(directory, "sky-process.ts");
  await copyFile(new URL("./fixtures/sky-process.ts", import.meta.url), executable);
  await chmod(executable, 0o700);
  const client = new SkyClient({ codexCliPath: executable, clientPath, socketDirectory: directory, cwd: directory }, timeout);
  return { client, async cleanup() { client.close(); await rm(directory, { recursive: true, force: true }); } };
}
const turn = newTurnIdentity("test-session", "test-model", "low");

test("real child-process protocol initializes, preserves metadata and translates element indexes", async () => {
  const s = await setup();
  const old = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "synthetic-only";
  try {
    const result = await s.client.callSky("click", { app: "Calculator", element_index: 10 }, turn);
    const content = result.content?.[0];
    assert.equal(content?.type, "text");
    const text = content?.type === "text" ? content.text : "";
    const decoded = JSON.parse(text);
    assert.equal(decoded.args.element_index, "10");
    assert.equal(decoded.meta["x-codex-turn-metadata"].session_id, "test-session");
    assert.equal(decoded.credentialInherited, false);
    const state = await s.client.callSky("get_app_state", { app: "Calculator", disableDiff: true }, turn);
    const stateText = state.content?.[0];
    const stateArgs = JSON.parse(stateText?.type === "text" ? stateText.text : "").args;
    assert.deepEqual(stateArgs, { app: "Calculator" }, "Unsupported disableDiff must not reach native Sky.");
  } finally {
    if (old === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = old;
    await s.cleanup();
  }
});
test("in-flight native cancellation closes connection and forbids implicit replay", async () => {
  const s = await setup();
  try {
    await s.client.callSky("get_app_state", {}, turn);
    const controller = new AbortController();
    const pending = s.client.callSky("hang", {}, turn, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, /cancelled/);
    await assert.rejects(s.client.callSky("get_app_state", {}, turn), /closed/);
  } finally { await s.cleanup(); }
});
test("native deadline and explicit close reject pending promises", async () => {
  // Allow the real Node/TypeScript subprocess to initialize on a loaded machine.
  const s = await setup(3000);
  try {
    await s.client.callSky("get_app_state", {}, turn);
    await assert.rejects(s.client.callSky("hang", {}, turn), /timeout.*during hang/);
  } finally { await s.cleanup(); }
  const other = await setup();
  try {
    await other.client.callSky("get_app_state", {}, turn);
    const pending = other.client.callSky("hang", {}, turn);
    other.client.close();
    await assert.rejects(pending, /closed/);
  } finally { await other.cleanup(); }
});
test("initialization deadline identifies its stage rather than reporting user cancellation", async () => {
  const s = await setup(300, "hang-initialize");
  try {
    await assert.rejects(s.client.callSky("get_app_state", { app: "Calculator" }, turn), /timeout.*during initialize/);
  } finally { await s.cleanup(); }
});
test("unsupported native arguments are rejected before dispatch", async () => {
  const s = await setup();
  try {
    await assert.rejects(s.client.callSky("click", { app: "Calculator", bogus: true }, turn), /Unsupported Sky arguments.*bogus/);
  } finally { await s.cleanup(); }
});
test("server elicitation supports string and numeric IDs and forwards explicit user consent", async () => {
  const s = await setup();
  try {
    for (const method of ["approve", "approve_numeric"]) {
      let asked = 0;
      const result = await s.client.callSky(method, {}, turn, undefined, async (message, signal) => {
        asked++; assert.match(message, /Calculator/); assert.equal(signal.aborted, false); return true;
      });
      const item = result.content?.[0];
      assert.deepEqual(JSON.parse(item?.type === "text" ? item.text : "").approvalReply, { action: "accept", content: {} });
      assert.equal(asked, 1);
    }
  } finally { await s.cleanup(); }
});
test("no handler, rejected consent and unsupported forms never automatically approve", async () => {
  const s = await setup();
  try {
    let asked = 0;
    for (const method of ["approve", "unsupported_form"]) {
      const result = await s.client.callSky(method, {}, turn, undefined, method === "approve" ? undefined : async () => { asked++; return true; });
      const item = result.content?.[0];
      assert.equal(JSON.parse(item?.type === "text" ? item.text : "").approvalReply.action, "decline");
    }
    assert.equal(asked, 0);
    const declined = await s.client.callSky("approve", {}, turn, undefined, async () => false);
    const item = declined.content?.[0];
    assert.equal(JSON.parse(item?.type === "text" ? item.text : "").approvalReply.action, "decline");
    const unknown = await s.client.callSky("unknown_server_method", {}, turn);
    const unknownItem = unknown.content?.[0];
    assert.equal(JSON.parse(unknownItem?.type === "text" ? unknownItem.text : "").error.code, -32601);
  } finally { await s.cleanup(); }
});
test("human approval time does not consume the network deadline", async () => {
  const s = await setup(3000);
  try {
    await s.client.callSky("get_app_state", {}, turn);
    const result = await s.client.callSky("approve", {}, turn, undefined, async () => {
      await new Promise((resolve) => setTimeout(resolve, 3100)); return true;
    });
    const item = result.content?.[0];
    assert.equal(JSON.parse(item?.type === "text" ? item.text : "").approvalReply.action, "accept");
  } finally { await s.cleanup(); }
});
test("cancelling during approval aborts its signal and never sends acceptance", async () => {
  const s = await setup();
  try {
    const controller = new AbortController();
    let approvalSignal: AbortSignal | undefined;
    const result = s.client.callSky("approve", {}, turn, controller.signal, async (_message, signal) => {
      approvalSignal = signal; controller.abort(); return true;
    });
    await assert.rejects(result, /cancelled/);
    assert.equal(approvalSignal?.aborted, true);
    await assert.rejects(s.client.callSky("get_app_state", {}, turn), /closed/);
  } finally { await s.cleanup(); }
});
test("RPC errors are redacted and close the client", async () => {
  const s = await setup();
  try {
    await assert.rejects(s.client.callSky("rpc_error", {}, turn), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /-10005/);
      assert.ok(!error.message.includes("SECRET_APP_TEXT"));
      return true;
    });
    await assert.rejects(s.client.callSky("get_app_state", {}, turn), /closed/);
  } finally { await s.cleanup(); }
});
