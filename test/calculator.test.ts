import test from "node:test";
import assert from "node:assert/strict";
import { parseAX } from "../src/ax.ts";
import { evaluatePolicy, prepareAction } from "../src/policy.ts";
import { runTask } from "../src/loop.ts";
import type { Decision } from "../src/types.ts";

const decision = (overrides: Partial<Decision> = {}): Decision => ({ action: "click_element", targetIndex: 18, confidence: 0.44, done: 0.02, risk: 0.06, ...overrides });
const target = parseAX("18 button Description: 2, ID: Two")[0]!;

test("actual Calculator pause case uses reference threshold without relaxing other apps or risk gates", () => {
  const gate = (app: string, d = decision(), label = target.label) => evaluatePolicy({ decision: d, app, allowedApps: [app],
    target: { ...target, label }, action: prepareAction(d, {}), observation: "4 text 1" });
  assert.equal(gate("Calculator").verdict, "proceed");
  assert.equal(gate("Calendar").verdict, "escalate");
  assert.equal(gate("TextEdit").verdict, "escalate");
  assert.equal(gate("Calculator", decision({ confidence: 0.39 })).verdict, "escalate");
  assert.equal(gate("Calculator", decision({ confidence: 0.2 })).verdict, "stop");
  assert.equal(gate("Calculator", decision({ risk: 0.8 })).verdict, "confirm");
  assert.equal(gate("Calculator", decision(), "Delete").verdict, "confirm");
});

test("multi-digit loop preserves semantic history when AX indexes shift after clearing", async () => {
  // Scripted decider verifies the loop contract, NOT Jev's real-model success rate.
  const sequence = ["All Clear", "1", "2", "Add", "3", "0", "2", "3", "2", "Equals"];
  const values = ["8", "0", "1", "12", "12", "3", "30", "302", "3023", "30232", "30244"];
  const buttons = ["All Clear", "0", "1", "2", "3", "6", "7", "Add", "Equals"];
  let completed = 0;
  const ax = () => {
    // Both the historical expression and the result disappear on All Clear,
    // making the same element index mean a different button in later snapshots.
    const offset = completed === 0 || completed === sequence.length ? 2 : 0;
    const expression = completed === 0 ? "3+5" : "12+30232";
    return ["0 standard window Calculator", ...(offset ? [`3 text ${expression}`] : []),
      `4 text \u200e${values[completed]}`, ...buttons.map((label, i) => `${10 + offset + i} button ${label}`)].join("\n");
  };
  const clicked: string[] = [];
  const result = await runTask({
    appName: "Calculator", goal: "Calculate 12 + 30232", dryRun: false, maxSteps: 10,
    driver: { async bind() {}, async observe() { return ax(); }, async click(index) {
      const element = parseAX(ax()).find((e) => e.index === index)!;
      assert.equal(element.label, sequence[completed]);
      clicked.push(element.label); completed++;
    } },
    decide: async ({ candidates, recentActions }) => {
      assert.equal(recentActions.length, Math.min(completed, 6));
      if (completed > 0) {
        const last = JSON.parse(recentActions.at(-1)!);
        assert.equal(last.target, `button: ${sequence[completed - 1]}`);
        assert.ok(last.before.endsWith(values[completed - 1]!));
        assert.ok(last.after.endsWith(values[completed]!));
        assert.equal("index" in last, false);
      }
      const choice = candidates.find((e) => e.label === sequence[completed])!;
      return decision({ targetIndex: choice.index, confidence: completed === 2 ? 0.44 : 0.99 });
    },
    verify: (state) => parseAX(state).some((e) => e.role === "text" && e.label.replace(/\p{Cf}/gu, "") === "30244"),
  });
  assert.equal(result.status, "done");
  assert.equal(result.verified, true);
  assert.equal(result.steps, 10);
  assert.deepEqual(clicked, sequence);
});

test("handoff reports observed target semantics rather than only an unstable index", async () => {
  const result = await runTask({ appName: "Calculator", goal: "Enter 2", dryRun: false,
    driver: { async bind() {}, async observe() { return "0 standard window Calculator\n4 text 1\n18 button Description: 2, ID: Two"; } },
    decide: async () => decision({ confidence: 0.39 }),
  });
  assert.equal(result.status, "escalate");
  assert.deepEqual(result.target, { role: "button", label: "Description: 2, ID: Two" });
  assert.equal(result.steps, 0);
});
