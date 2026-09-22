import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerJevCodexCua } from "../src/pi-extension.ts";
import { SkyClient } from "../src/sky/client.ts";
import { resolveSkyRuntime } from "../src/sky/runtime.ts";
import { parseAX } from "../src/ax.ts";
import { DEFAULT_ENDPOINT } from "../src/jev.ts";
import type { SkyResult } from "../src/sky/client.ts";

const exec = promisify(execFile);
if (process.argv.slice(2).length !== 1 || process.argv[2] !== "--live") {
  console.error("Controlled integration test only. Pass --live to use real Sky and Calculator (clear, then enter 6). Jev's response and caller choices are scripted; official approval is NEVER mocked. No TypeSafe API request or real key is used.");
  process.exitCode = 1;
} else {
  await acceptHandoff();
}

async function acceptHandoff(): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Live Sky acceptance requires macOS.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Controlled test wall-clock budget exhausted")), 120_000);
  const cancel = () => controller.abort(new Error("Controlled test cancelled"));
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, (event: unknown, context: ExtensionContext) => unknown>();
  let activeTools: string[] = [];
  const entries: { type: "custom"; customType: string; data: unknown }[] = [];
  const sessionId = randomUUID();
  const nativeCalls: string[] = [];
  let syntheticDecisions = 0;
  let approvals = 0;
  let client: SkyClient | undefined;
  let stage = "setup";
  let actionInFlight = false;
  const originalFetch = globalThis.fetch;
  const report = (event: string, details: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, controlledTest: true, ...details }));

  const ctx = {
    hasUI: true,
    model: { id: "controlled-handoff-test" }, thinkingLevel: "low",
    sessionManager: { getSessionId: () => sessionId, getBranch: () => entries },
    ui: {
      notify() {},
      async confirm(_title: string, message: string, options?: { signal?: AbortSignal }) {
        // Forward only the official Calculator approval to a genuine human-controlled UI.
        if (!/Calculator|计算器/i.test(message)) throw new Error("Unexpected approval scope; test stopped.");
        approvals++;
        report("official_approval_prompt", { promptNumber: approvals });
        try {
          const result = await exec("/usr/bin/osascript", ["-e", [
            "on run argv",
            'set response to display dialog (item 1 of argv) with title "受控接管测试 · 官方 Computer Use 授权" buttons {"Cancel", "Allow"} default button "Cancel" cancel button "Cancel" giving up after 60',
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
    registerCommand() {},
    getActiveTools: () => activeTools,
    setActiveTools(names: string[]) { activeTools = names; },
    appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
    on(name: string, handler: (event: unknown, context: ExtensionContext) => unknown) { handlers.set(name, handler); },
  } as unknown as ExtensionAPI;
  const call = (name: string, args: Record<string, unknown>) => tools.get(name)!.execute("controlled-test", args, controller.signal, undefined, ctx);
  const text = (result: { content: { type: string; text?: string }[] }) => result.content.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n");
  function display(ax: string): string | undefined {
    const nodes = parseAX(ax);
    const parentIndex = nodes.findIndex((node) => node.role === "scroll area" && /\bID: StandardInputView\b/.test(node.label));
    if (parentIndex < 0) return undefined;
    const parent = nodes[parentIndex]!;
    for (const node of nodes.slice(parentIndex + 1)) {
      if (node.depth <= parent.depth) break;
      if (node.role === "text") return node.label.replace(/\p{Cf}/gu, "").replaceAll(",", "");
    }
    return undefined;
  }
  try {
    // Isolated process only. No production endpoint/config/threshold is modified.
    globalThis.fetch = async (input, options) => {
      assert.equal(String(input), DEFAULT_ENDPOINT, "Unexpected HTTP request in the controlled test");
      syntheticDecisions++;
      assert.equal(syntheticDecisions, 1, "The test must not repeatedly fake model decisions");
      const payload = JSON.parse(String(options?.body));
      const entry = Object.entries(payload.questions.target.criteria as Record<string, string>).find(([, label]) => /\bID: Six\b/.test(label));
      assert.ok(entry, "Calculator digit 6 must be a real current candidate");
      report("synthetic_jev_response", { confidence: 0.1, risk: 0.01, action: "click_element", note: "Synthetic decision for handoff testing, NOT a real Jev failure." });
      return Response.json({ answers: { target: { choice: entry[0], confidence: 0.1 }, action: { choice: "click_element" }, risk: { noul: 0.01 }, done: { noul: 0 } } });
    };
    registerJevCodexCua(pi, {
      config: () => ({ apiKey: "synthetic-placeholder-not-a-real-key", mode: "jev", allowedApps: ["Calculator"], envFile: "not-used" }),
      runtimeCheck: () => { resolveSkyRuntime(); },
      client: () => {
        client = new SkyClient(resolveSkyRuntime());
        return { close: () => client!.close(), async callSky(method, args, identity, signal, approve): Promise<SkyResult> {
          assert.equal(args.app, "Calculator", "Only Calculator may be used in this test");
          assert.ok(method === "get_app_state" || method === "click", "No other desktop operations permitted");
          nativeCalls.push(method);
          if (method === "click") {
            assert.ok(nativeCalls.filter((name) => name === "click").length <= 2, "Never exceed two real action attempts");
            actionInFlight = true;
          }
          const result = await client!.callSky(method, args, identity, signal, approve);
          if (method === "get_app_state" && !result.isError) actionInFlight = false;
          return result;
        } };
      },
    });
    handlers.get("session_start")?.({}, ctx);
    handlers.get("agent_start")?.({}, ctx);
    assert.ok(!activeTools.includes("cua_click"), "Native writes must initially be unavailable in jev mode");
    stage = "jev_handoff";
    const decision = await call("jev_cua_run", { appName: "Calculator", goal: "Start a fresh calculation and enter digit 6", maxSteps: 2, dryRun: false });
    const outcome = decision.details as { status: string; steps: number; handoff?: { remainingSteps: number } };
    assert.equal(outcome.status, "needs_planner"); assert.equal(outcome.steps, 0); assert.equal(outcome.handoff?.remainingSteps, 2);
    assert.equal(nativeCalls.filter((name) => name === "click").length, 0);
    assert.ok(activeTools.includes("cua_click"));
    report("handoff_observed", { status: outcome.status, dispatchedActions: 0, remainingSteps: 2 });

    stage = "native_clear";
    let state = await call("cua_get_app_state", { app: "Calculator" });
    const clear = parseAX(text(state)).find((node) => node.role === "button" && (/\bID: AllClear\b/.test(node.label) || node.label === "Clear"));
    assert.ok(clear, "No observable Clear/All Clear button; do not guess");
    await call("cua_click", { app: "Calculator", stateId: (state.details as { stateId: string }).stateId, element_index: clear.index });
    state = await call("cua_get_app_state", { app: "Calculator" });
    assert.equal(display(text(state)), "0");
    stage = "native_enter_6";
    const six = parseAX(text(state)).find((node) => node.role === "button" && /\bID: Six\b/.test(node.label));
    assert.ok(six, "No observable digit 6 button; do not guess");
    await call("cua_click", { app: "Calculator", stateId: (state.details as { stateId: string }).stateId, element_index: six.index });
    stage = "verify_result";
    state = await call("cua_get_app_state", { app: "Calculator" });
    assert.equal(display(text(state)), "6");
    assert.equal(nativeCalls.filter((name) => name === "click").length, 2);
    assert.ok(!activeTools.includes("cua_click"), "Native writes must deactivate when the handoff budget is exhausted");
    const status = (await call("cua_status", {})).details as { mode: string; nativeHandoff?: { remainingSteps: number } };
    assert.equal(status.mode, "jev"); assert.equal(status.nativeHandoff?.remainingSteps, 0);
    report("passed", { finalDisplay: "6", syntheticDecisions, realNativeActions: 2, nativeReads: nativeCalls.filter((name) => name === "get_app_state").length,
      remainingSteps: 0, scope: "Real plugin handlers and Sky, isolated scripted host/caller; not a real Jev failure or a live LLM recovery decision." });
  } catch (error) {
    report("failed", { stage, errorName: error instanceof Error ? error.name : "UnknownError", actionOutcomeMayBeUnknown: actionInFlight,
      nativeActionAttempts: nativeCalls.filter((name) => name === "click").length, note: "Stopped without retrying. Inspect the current Calculator state before any further action." });
    process.exitCode = 1;
  } finally {
    controller.abort(); client?.close();
    handlers.get("session_shutdown")?.({}, ctx);
    globalThis.fetch = originalFetch;
    clearTimeout(timeout); process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel);
  }
}
