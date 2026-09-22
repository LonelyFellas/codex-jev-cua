// Core regression scenarios migrated/adapted from Jev-cu; see NOTICE.md.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAX, selectCandidates, buildContext, focusedIndex } from "../src/ax.ts";
import { buildQuestions, normalizeDecision, sanitizeLabel, createJevDecider } from "../src/jev.ts";
import { evaluatePolicy, matchSensitive, prepareAction } from "../src/policy.ts";
import { runTask } from "../src/loop.ts";
import { createCuaDriver } from "../src/cua-driver.ts";
import type { TaskOptions } from "../src/loop.ts";
import type { Decision, Driver, Resources } from "../src/types.ts";

const AX = 'Window: Calendar\n0 standard window Calendar\n  1 list Monday\n  20 button previous month\n  21 button Today\n  22 button next month\n  23 text September 2026';
const INPUT_AX = 'Window: Scratch\n0 standard window Scratch\n  4 text area Value: scratch\n  5 search field Search\nThe focused UI element is 4 text area';
const decision = (overrides: Partial<Decision> = {}): Decision => ({ action: "click_element", targetIndex: 22, confidence: 0.99, risk: 0, done: 0, ...overrides });
function fixture(options: Partial<TaskOptions> = {}) {
  let ax = AX;
  let clicks = 0;
  let binds = 0;
  let observations = 0;
  const driver: Driver = {
    async bind() { binds++; },
    async observe() { observations++; return ax; },
    async click(index) { assert.equal(index, 22); clicks++; ax = AX.replace("September", "October"); },
  };
  return {
    run: (extra: Partial<TaskOptions> = {}) => runTask({ appName: "Calendar", goal: "Next month", driver, decide: async () => decision(), ...options, ...extra }),
    driver, get clicks() { return clicks; }, get binds() { return binds; }, get observations() { return observations; },
  };
}

test("AX parses LF/CRLF, localized roles and full labels", () => {
  assert.deepEqual(parseAX(AX), parseAX(AX.replaceAll("\n", "\r\n")));
  const elements = parseAX('0 标准窗口 计算器\n  4 文本 0\n  15 按钮 Description: 6, ID: Six');
  assert.equal(elements[2]?.index, 15);
  assert.equal(elements[2]?.role, "button");
  assert.ok(buildContext('0 标准窗口 计算器\n4 文本 42').includes("42"));
  assert.equal(parseAX("27 button Mode, Secondary Actions: Delete, Remove")[0]?.label, "Mode");
  assert.equal(focusedIndex(INPUT_AX), 4);
});
test("candidate selection ranks relevant buttons rather than truncating by index", () => {
  const elements = parseAX([...Array.from({ length: 100 }, (_, i) => `${i} list Day ${i}`), "203 button previous month", "204 button next month"].join("\n"));
  const result = selectCandidates(elements, "previous month", 3);
  assert.equal(result.candidates[0]?.index, 203);
  assert.equal(result.clipped, true);
  assert.equal(result.total, 102);
  assert.equal(selectCandidates(parseAX("1 unknown thing\n2 button (disabled)")).candidates.length, 0);
});
test("duplicate or unsafe AX indexes fail closed", () => {
  assert.throws(() => parseAX("1 button One\n1 button Two"));
  assert.throws(() => parseAX("9999999999999999999 button One"));
  assert.throws(() => selectCandidates([], "", 0));
});
test("questions and responses retain candidate membership", () => {
  const { questions, criteria } = buildQuestions("next month", parseAX(AX));
  assert.ok(questions.target.criteria.i22?.includes("next month"));
  const normalized = normalizeDecision({ target: { choice: "i22", confidence: "0.9" }, action: { choice: "click_element" }, risk: { noul: 0.01 }, done: { probability: 0.02 } }, criteria);
  assert.equal(normalized.targetIndex, 22);
  assert.equal(normalized.confidence, 0.9);
  assert.equal(normalizeDecision({ target: { choice: "i999" } }, criteria).targetIndex, null);
  assert.equal(normalizeDecision({ target: { choice: "i22", confidence: "" }, action: { choice: "execute_shell" }, risk: { noul: 2 } }, criteria).action, null);
  assert.ok(!sanitizeLabel("button https://example.com/private " + "x".repeat(200)).includes("https://"));
  assert.equal(sanitizeLabel("x".repeat(200)).length, 120);
});
test("default dry-run observes and decides but never executes", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.status, "dry_run");
  assert.equal(result.planned?.kind, "click_element");
  assert.equal(f.clicks, 0);
  assert.equal(f.observations, 1);
});
test("allowlist checked before bind, observe, verify and API", async () => {
  const f = fixture({ allowedApps: [], decide: async () => { throw new Error("must not call"); } });
  const result = await f.run();
  assert.equal(result.reason, "app_not_allowed");
  assert.equal(f.binds, 0);
  assert.equal(f.observations, 0);
});
test("full loop verifies the last allowed action", async () => {
  const f = fixture({ dryRun: false, maxSteps: 1, verify: (ax) => ax.includes("October") });
  const result = await f.run();
  assert.equal(result.status, "done");
  assert.equal(result.verified, true);
  assert.equal(result.steps, 1);
  assert.equal(f.clicks, 1);
  assert.equal(f.observations, 3);
});
test("already complete goal requires no decision or action", async () => {
  const f = fixture({ verify: () => true, decide: async () => { throw new Error("must not call"); } });
  assert.equal((await f.run()).status, "done");
  assert.equal(f.clicks, 0);
});
test("model completion never overrides verification", async () => {
  const f = fixture({ decide: async () => decision({ done: 0.99 }) });
  assert.equal((await f.run()).status, "model_done");
  assert.equal((await f.run({ verify: () => false })).status, "escalate");
  assert.equal((await f.run({ decide: async () => decision({ done: 2 }) })).reason, "invalid_decision");
});
test("sensitive original label cannot be hidden by truncation", async () => {
  const fullAX = `0 standard window Calendar\n22 button ${"Details ".repeat(50)}Delete Event`;
  let clicks = 0;
  const f = fixture({ dryRun: false, driver: { async bind() {}, async observe() { return fullAX; }, async click() { clicks++; } } });
  const result = await f.run();
  assert.equal(result.status, "confirm");
  assert.equal(result.reason, "sensitive_delete");
  assert.equal(clicks, 0);
});
test("invalid target, missing probability and low confidence cannot execute", async () => {
  for (const d of [decision({ targetIndex: 999 }), decision({ risk: null }), decision({ confidence: 0.2 }), decision({ confidence: 0.4 }), decision({ risk: 0.8 }), decision({ action: "ask_user" })]) {
    const f = fixture({ dryRun: false, decide: async () => d });
    const result = await f.run();
    assert.ok(["escalate", "confirm", "stop"].includes(result.status));
    assert.equal(f.clicks, 0);
  }
});
test("element action cannot be replaced by planner coordinates", async () => {
  assert.throws(() => prepareAction(decision(), { at: [100, 100] }));
  const f = fixture({ dryRun: false, resources: { at: [100, 100] } });
  assert.equal((await f.run()).reason, "invalid_action_resources");
  assert.equal(f.clicks, 0);
});
test("coordinate actions require handoff even at high confidence", async () => {
  const f = fixture({ dryRun: false, resources: { at: [100, 100] }, decide: async () => decision({ action: "click_at" }) });
  const result = await f.run();
  assert.equal(result.status, "confirm");
  assert.equal(f.clicks, 0);
});
test("missing text/key/direction does not default to destructive input", () => {
  for (const action of ["type_text", "set_value", "press_key", "scroll"] as const) assert.throws(() => prepareAction(decision({ action }), {}));
  assert.deepEqual(prepareAction(decision({ action: "set_value" }), { text: "" }), { kind: "set_value", index: 22, text: "" });
});
test("fresh observation is required immediately before action", async () => {
  let reads = 0;
  let actions = 0;
  const f = fixture({ dryRun: false, driver: { async bind() {}, async observe() { return ++reads === 1 ? AX : AX.replace("next month", "Delete Event"); }, async click() { actions++; } } });
  assert.equal((await f.run()).reason, "observation_changed_before_action");
  assert.equal(actions, 0);
});
test("three consecutive no-change actions escalate", async () => {
  let clicks = 0;
  const f = fixture({ dryRun: false, driver: { async bind() {}, async observe() { return AX; }, async click() { clicks++; } } });
  const result = await f.run();
  assert.equal(result.reason, "repeated_no_change");
  assert.equal(clicks, 3);
});
test("action errors are not retried and indicate unknown outcome", async () => {
  let clicks = 0;
  const f = fixture({ dryRun: false, driver: { async bind() {}, async observe() { return AX; }, async click() { clicks++; throw new Error("secret input"); } } });
  const result = await f.run();
  assert.equal(result.status, "error");
  assert.equal(result.reason, "execute_failed");
  assert.equal(result.outcomeUnknown, true);
  assert.equal(clicks, 1);
  assert.ok(!JSON.stringify(result).includes("secret input"));
});
test("post-action observation failure stops without retrying action", async () => {
  let reads = 0;
  const f = fixture({ dryRun: false, driver: { async bind() {}, async observe() { if (++reads === 3) throw new Error("read fail"); return AX; }, async click() {} } });
  const result = await f.run();
  assert.equal(result.reason, "post_action_observe_failed");
  assert.equal(result.steps, 1);
  assert.equal(result.outcomeUnknown, true);
});
test("planner resources callback runs once per decision", async () => {
  let called = 0;
  const f = fixture({ resources: async (step, d) => { called++; assert.equal(step, 1); assert.equal(d.targetIndex, 22); return {}; } });
  assert.equal((await f.run()).status, "dry_run");
  assert.equal(called, 1);
});
test("typing, setting values, navigation and scrolling dispatch exact explicit parameters", async () => {
  for (const kind of ["type_text", "set_value", "press_key", "scroll"] as const) {
    const calls: unknown[][] = [];
    const resources: Resources = { text: "你好 world", key: "Tab", direction: "down" };
    const driver: Driver = { async bind() {}, async observe() { return INPUT_AX; },
      async typeText(text) { calls.push([text]); }, async setValue(i, text) { calls.push([i, text]); },
      async pressKey(key) { calls.push([key]); }, async scroll(i, direction, pages) { calls.push([i, direction, pages]); } };
    const result = await runTask({ driver, appName: "TextEdit", goal: "edit scratch", dryRun: false, maxSteps: 1, resources,
      decide: async () => decision({ action: kind, targetIndex: 4 }) });
    assert.equal(result.status, "max_steps");
    assert.deepEqual(calls, [kind === "type_text" ? ["你好 world"] : kind === "set_value" ? [4, "你好 world"] : kind === "press_key" ? ["Tab"] : [4, "down", 1]]);
  }
});
test("typing checks focus; Return and embedded newlines require handoff", () => {
  const target = parseAX(INPUT_AX).find((e) => e.index === 4)!;
  function gate(kind: "type_text" | "press_key", resources: Resources, observation = INPUT_AX) {
    const d = decision({ action: kind, targetIndex: 4 });
    return evaluatePolicy({ decision: d, app: "TextEdit", allowedApps: ["TextEdit"], target, action: prepareAction(d, resources), observation });
  }
  assert.equal(gate("type_text", { text: "hello" }, INPUT_AX.replace("is 4", "is 5")).reason, "focus_not_target");
  assert.equal(gate("press_key", { key: "Return" }).verdict, "confirm");
  assert.equal(gate("type_text", { text: "hello\n" }).verdict, "confirm");
  assert.equal(matchSensitive("button 立即支付"), "payment");
});
test("trace logs omit AX, goal, text, errors and secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskhand-test-"));
  try {
    const f = fixture({ traceDir: directory, goal: "secret goal", resources: { text: "secret text" } });
    const result = await f.run();
    const log = await readFile(result.tracePath!, "utf8");
    assert.ok(!/secret|September|Calendar/.test(log));
    assert.deepEqual(log.trim().split("\n").map((line) => JSON.parse(line).event), ["start", "decision", "finish"]);
    assert.equal((await stat(result.tracePath!)).mode & 0o777, 0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("driver rejects overlapping tasks and releases lock afterward", async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const f = fixture({ decide: async () => { await wait; return decision(); } });
  const first = f.run();
  await assert.rejects(f.run(), /already running/);
  release();
  assert.equal((await first).status, "dry_run");
  assert.equal((await f.run()).status, "dry_run");
});
test("cua adapter requests a full, non-emitted AX tree and preserves method receiver", async () => {
  let seen: unknown;
  const app = { marker: "receiver", async getAXState(options: unknown) { seen = options; return AX; }, async click(index: number) { assert.equal(this.marker, "receiver"); assert.equal(index, 22); } };
  const driver = createCuaDriver({ async getApp() { return app; } });
  await assert.rejects(driver.observe(), /bind/);
  await driver.bind("Calendar");
  assert.equal(await driver.observe(), AX);
  assert.deepEqual(seen, { emit: false, disableDiffing: true });
  await driver.click!(22);
});

const input = { goal: "next month", app: "Calendar", candidates: parseAX(AX), context: buildContext(AX), recentActions: [], constraints: "" };
const answers = { target: { choice: "i22", confidence: 0.9 }, action: { choice: "click_element" }, risk: { noul: 0 }, done: { noul: 0 } };
test("Jev client sends text-only four-question payload", async () => {
  const decide = createJevDecider({ apiKey: "test-key", fetchImpl: async (_url, options) => {
    assert.equal(options?.redirect, "error");
    const payload = JSON.parse(String(options?.body));
    assert.deepEqual(Object.keys(payload.questions), ["target", "action", "done", "risk"]);
    assert.ok(!JSON.stringify(payload).includes("image"));
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer test-key");
    return Response.json({ answers, usage: { input_tokens: 100 } });
  } });
  const result = await decide(input);
  assert.equal(result.targetIndex, 22);
  assert.equal(result.usage?.input_tokens, 100);
});
test("Jev retries rate limits/server failures only and limits attempts", async () => {
  let calls = 0;
  const delays: number[] = [];
  const decide = createJevDecider({ apiKey: "test", sleep: async (ms) => { delays.push(ms); }, fetchImpl: async () => {
    calls++; return calls < 3 ? new Response("", { status: calls === 1 ? 429 : 503 }) : Response.json({ answers });
  } });
  await decide(input);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 3000]);
  calls = 0;
  await assert.rejects(createJevDecider({ apiKey: "test", fetchImpl: async () => { calls++; return new Response("SECRET", { status: 401 }); } })(input), /Jev HTTP 401/);
  assert.equal(calls, 1);
});
test("Jev timeout covers body reading, and invalid response fails without retries", async () => {
  await assert.rejects(createJevDecider({ apiKey: "test", timeoutMs: 5, fetchImpl: async (_url, options) => {
    const stream = new ReadableStream({ start(controller) { options!.signal!.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true }); } });
    return new Response(stream);
  } })(input), /timed out/);
  await assert.rejects(createJevDecider({ apiKey: "test", fetchImpl: async () => Response.json({ wrong: true }) })(input), /invalid answers/);
  await assert.rejects(createJevDecider({ apiKey: "", fetchImpl: async () => { throw new Error("no call"); } })(input), /TYPESAFE_API_KEY/);
});
