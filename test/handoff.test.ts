import test from "node:test";
import assert from "node:assert/strict";
import { runTask } from "../src/loop.ts";
import type { Decision } from "../src/types.ts";

const decision: Decision = { action: "click_element", targetIndex: 10, confidence: 0.99, risk: 0.05, done: 0 };
const ax = "0 standard window Calculator\n4 text 0\n10 button 1\n11 button 2";

test("planner handoff preserves goal, completed history and remaining budget without replay", async () => {
  let state = ax;
  let decisions = 0;
  const clicks: number[] = [];
  const result = await runTask({ appName: "Calculator", goal: "Enter 12", dryRun: false, maxSteps: 3, plannerHandoff: true,
    driver: { async bind() {}, async observe() { return state; }, async click(index) { clicks.push(index); state = ax.replace("text 0", "text 1"); } },
    decide: async () => ++decisions === 1 ? decision : { ...decision, targetIndex: 11, confidence: 0.35 },
  });
  assert.equal(result.status, "needs_planner");
  assert.equal(result.steps, 1);
  assert.equal(result.handoff?.goal, "Enter 12");
  assert.equal(result.handoff?.remainingSteps, 2);
  assert.match(result.handoff!.context, /text 1/);
  assert.equal(JSON.parse(result.handoff!.recentActions[0]!).target, "button: 1");
  assert.deepEqual(clicks, [10]);
});

test("risk and sensitive-action gates are not relabeled as planner uncertainty", async () => {
  for (const testCase of [
    { decision: { ...decision, risk: 0.8, confidence: 0.35 }, state: ax },
    { decision, state: ax.replace("button 1", "button Delete") },
    { decision: { ...decision, action: "ask_user" as const }, state: ax },
  ]) {
    let actions = 0;
    const result = await runTask({ appName: "Calculator", goal: "Inspect calculator", dryRun: false, maxSteps: 3, plannerHandoff: true,
      driver: { async bind() {}, async observe() { return testCase.state; }, async click() { actions++; } }, decide: async () => testCase.decision });
    assert.equal(result.status, "confirm");
    assert.equal(result.handoff, undefined);
    assert.equal(actions, 0);
  }
});
