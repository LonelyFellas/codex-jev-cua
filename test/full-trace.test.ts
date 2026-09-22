import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTask } from "../src/loop.ts";
import { createTrace } from "../src/trace.ts";
import type { TaskOptions } from "../src/loop.ts";
import type { TaskResult } from "../src/types.ts";

// Test-side inspection of the versioned JSONL artifact, not application inputs.
type Event = Record<string, any>;
async function events(result: TaskResult): Promise<Event[]> {
  assert.ok(result.tracePath);
  return (await readFile(result.tracePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
}
const SECRET = "synthetic-private-api-key";
const d = { action: "click_element" as const, targetIndex: 10, confidence: 0.99, risk: 0, done: 0 };
const AX = "0 standard window Calculator\n4 text 0\n10 button 1";

test("full trace reconstructs every step of a failed 12-step run without changing its budget or choices", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-full-trace-"));
  try {
    const sequence = ["Clear", "1", "2", "Clear", "1", "2", "Clear", "1", "2", "Clear", "1", "2"];
    const buttons = ["Clear", "1", "2", "Add"];
    let display = "12";
    const clicked: string[] = [];
    const ax = () => `0 standard window Calculator\n4 text \u200e${display}\n${buttons.map((label, i) => `${10 + i} button ${label}`).join("\n")}`;
    const result = await runTask({
      appName: "Calculator", goal: "Calculate 12 + 30232", plan: "Use the given goal; diagnose repeated clearing.", dryRun: false, maxSteps: 12,
      traceDir: directory, traceMode: "full",
      driver: { async bind() {}, async observe() { return ax(); }, async click(index) {
        const label = buttons[index - 10]!;
        clicked.push(label);
        display = label === "Clear" ? "0" : display === "0" ? label : display + label;
      } },
      jevOptions: { apiKey: SECRET, maxRetries: 0, fetchImpl: async (_url, request) => {
        const payload = JSON.parse(String(request?.body));
        assert.equal(payload.state.goal, "Calculate 12 + 30232");
        const target = 10 + buttons.indexOf(sequence[clicked.length]!);
        return Response.json({ answers: { target: { choice: `i${target}`, confidence: 0.99, probabilities: { [`i${target}`]: 0.99 } },
          action: { choice: "click_element" }, risk: { noul: 0 }, done: { noul: 0 } }, usage: { input_tokens: 50 }, debug_echo: SECRET });
      } },
      verify: (state) => state.includes("30244"),
    });
    assert.equal(result.status, "max_steps");
    assert.equal(result.steps, 12);
    assert.equal(display, "12");
    assert.deepEqual(clicked, sequence);
    const log = await events(result);
    assert.deepEqual(log.map((e) => e.seq), log.map((_, i) => i + 1));
    assert.equal(new Set(log.map((e) => e.runId)).size, 1);
    assert.ok(log.every((e) => e.mode === "full" && e.schemaVersion === 1));
    assert.equal(log.filter((e) => e.event === "snapshot").length, 25);
    const dispatches = log.filter((e) => e.event === "dispatch_start");
    assert.equal(dispatches.length, 12);
    assert.deepEqual(dispatches.map((e) => e.target.label), sequence);
    assert.ok(dispatches.every((e) => e.method === "driver.click" && e.arguments[0] === e.target.index));
    for (let step = 1; step <= 12; step++) {
      const input = log.find((e) => e.event === "decision_input" && e.step === step)!;
      const decision = log.find((e) => e.event === "decision_output" && e.step === step)!;
      const sent = log.find((e) => e.event === "jev" && e.step === step && e.exchange.kind === "request")!;
      const received = log.find((e) => e.event === "jev" && e.step === step && e.exchange.kind === "response")!;
      const dispatched = dispatches[step - 1]!;
      assert.equal(input.snapshotId, 2 * step - 1);
      assert.equal(dispatched.snapshotId, 2 * step);
      assert.equal(input.input.candidates.length, 4);
      assert.equal(decision.target.label, sequence[step - 1]);
      assert.equal(sent.exchange.payload.questions.target.criteria[`i${decision.target.index}`], `button: ${sequence[step - 1]}`);
      assert.equal(received.exchange.body.answers.target.choice, `i${decision.target.index}`);
      assert.equal(log.find((e) => e.event === "gate" && e.step === step)?.gate.verdict, "proceed");
      assert.equal(log.find((e) => e.event === "dispatch_return" && e.step === step)?.methodReturned, true);
      assert.equal(log.find((e) => e.event === "snapshot" && e.step === step && e.at === "after_action")?.snapshotId, 2 * step + 1);
    }
    assert.equal(log.at(-1)?.event, "finish");
    assert.equal(log.at(-1)?.reason, "step_budget_exhausted");
    assert.equal(log.find((e) => e.event === "outcome")?.result.verified, false);
    const raw = await readFile(result.tracePath!, "utf8");
    assert.ok(!raw.includes(SECRET));
    assert.ok(raw.includes("[REDACTED]"));
    assert.ok(!raw.includes("Authorization"));
    assert.equal((await stat(result.tracePath!)).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failures preserve the last successful stage, dispatch intent and unknown outcome", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-trace-failures-"));
  try {
    for (const failure of ["decide", "execute", "post_action_observe"] as const) {
      let reads = 0;
      const result = await runTask({ appName: "Calculator", goal: "Enter 1", dryRun: false, maxSteps: 1,
        traceDir: directory, traceMode: "full", jevOptions: { apiKey: SECRET },
        driver: { async bind() {}, async observe() {
          if (++reads === 3 && failure === "post_action_observe") throw new Error(`read failed ${SECRET}`);
          return AX;
        }, async click() { if (failure === "execute") throw new Error(`dispatch failed ${SECRET}`); } },
        decide: async () => { if (failure === "decide") throw new Error(`model failed ${SECRET}`); return d; },
      });
      assert.equal(result.status, "error");
      assert.equal(result.reason, `${failure}_failed`);
      const log = await events(result);
      assert.equal(log.find((e) => e.event === "failure")?.phase, failure);
      assert.equal(log.filter((e) => e.event === "dispatch_start").length, failure === "decide" ? 0 : 1);
      assert.equal(log.filter((e) => e.event === "dispatch_return").length, failure === "post_action_observe" ? 1 : 0);
      assert.equal(log.at(-1)?.event, "finish");
      assert.equal(result.outcomeUnknown, failure !== "decide");
      assert.ok(!JSON.stringify(log).includes(SECRET));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("invalid decisions, stale observations, dry-run and cancellation all retain terminal evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-trace-stops-"));
  try {
    const base: TaskOptions = { appName: "Calculator", goal: "Enter 1", traceDir: directory, traceMode: "full",
      driver: { async bind() {}, async observe() { return AX; }, async click() { throw new Error("must not dispatch"); } }, decide: async () => d };
    const invalid = await runTask({ ...base, decide: async () => ({ ...d, risk: null }) });
    const invalidLog = await events(invalid);
    assert.equal(invalid.reason, "invalid_decision");
    assert.equal(invalidLog.find((e) => e.event === "decision_output")?.decision.risk, null);
    const preview = await runTask(base);
    const previewLog = await events(preview);
    assert.equal(preview.status, "dry_run");
    assert.equal(previewLog.find((e) => e.event === "action_prepared" && e.status === "prepared")?.action.kind, "click_element");
    assert.equal(previewLog.filter((e) => e.event === "dispatch_start").length, 0);
    let reads = 0;
    const stale = await runTask({ ...base, dryRun: false, driver: { ...base.driver, async observe() { return ++reads === 1 ? AX : AX.replace("text 0", "text 9"); } } });
    assert.equal(stale.reason, "observation_changed_before_action");
    const staleLog = await events(stale);
    assert.equal(staleLog.filter((e) => e.event === "snapshot").length, 2);
    assert.equal(staleLog.filter((e) => e.event === "dispatch_start").length, 0);
    const controller = new AbortController();
    const cancelled = await runTask({ ...base, signal: controller.signal, decide: async () => { controller.abort(); return d; } });
    const cancelledLog = await events(cancelled);
    assert.equal(cancelled.reason, "cancelled");
    assert.ok(cancelledLog.some((e) => e.event === "decision_output"));
    assert.equal(cancelledLog.at(-1)?.reason, "cancelled");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("full tracing rejects public directories and marks write-budget failure instead of dropping events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-trace-permissions-"));
  try {
    await chmod(directory, 0o755);
    assert.throws(() => createTrace(directory, { mode: "full" }), /owner-only/);
    await chmod(directory, 0o700);
    assert.throws(() => createTrace(undefined, { mode: "full" }), /explicit local directory/);
    const trace = createTrace(directory, { mode: "full", maxBytes: 300 });
    try {
      trace.record({ event: "start" });
      assert.throws(() => trace.full({ event: "snapshot", ax: "x".repeat(1000) }), /budget/);
      assert.equal(trace.incomplete, true);
      assert.throws(() => trace.record({ event: "finish" }), /incomplete/);
      const lines = (await readFile(trace.path!, "utf8")).trim().split("\n");
      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]!).event, "start");
    } finally { trace.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
