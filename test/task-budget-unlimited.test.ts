import test from "node:test";
import assert from "node:assert/strict";
import { TaskBudget, DEFAULT_TASK_LIMITS, UNLIMITED_TASK_LIMITS } from "../src/task-budget.ts";

test("unlimited native accounting has no deadline timer or action cap", (t) => {
  const timers = t.mock.method(globalThis, "setTimeout");
  let now = 0;
  const budget = new TaskBudget(UNLIMITED_TASK_LIMITS, () => now);
  const lease = budget.enter();
  now = 86_400_000;
  for (let i = 0; i < 1000; i++) budget.beforeDispatch(true);
  assert.equal(lease.signal.aborted, false);
  assert.equal(timers.mock.callCount(), 0);
  const status = budget.status();
  assert.equal(status.actions, 1000); assert.equal(status.elapsedMs, now);
  for (const field of ["durationMs", "maxActions", "remainingMs", "remainingActions"] as const) assert.equal(status[field], null);
  assert.deepEqual(JSON.parse(JSON.stringify(status)), status);
  lease.finish();
});

test("mode limit changes preserve elapsed time and action accounting", () => {
  let now = 0;
  const budget = new TaskBudget(UNLIMITED_TASK_LIMITS, () => now);
  const lease = budget.enter(); budget.beforeDispatch(true); lease.finish();
  now = 1000;
  budget.setLimits(DEFAULT_TASK_LIMITS);
  assert.equal(budget.status().remainingMs, 179000);
  assert.equal(budget.status().remainingActions, 29);
  budget.setLimits(UNLIMITED_TASK_LIMITS);
  now = 200000;
  for (let i = 0; i < 40; i++) budget.beforeDispatch(true);
  budget.setLimits(DEFAULT_TASK_LIMITS);
  assert.equal(budget.status().actions, 41);
  assert.throws(() => budget.enter(), /task_deadline_exceeded/);
  budget.setLimits(UNLIMITED_TASK_LIMITS);
  budget.beforeDispatch(true);
  assert.equal(budget.status().actions, 42);
});

test("Jev/default finite limits still stop at the configured action budget", () => {
  const budget = new TaskBudget(); const lease = budget.enter();
  try {
    for (let i = 0; i < 30; i++) budget.beforeDispatch(true);
    assert.throws(() => budget.beforeDispatch(true), /action_budget_exhausted/);
    assert.equal(budget.status().remainingActions, 0);
  } finally { lease.finish(); }
});
