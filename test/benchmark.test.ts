import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createBatch, recordResult, report, TASKS, validateBatch } from "../scripts/benchmark-core.ts";
import type { Config, Result } from "../scripts/benchmark-core.ts";

const config: Config = { mode: "native", execution: "simulated", commit: "a".repeat(40), mainModel: "test", jevModel: "none", macOS: "test", appVersions: "test", runtime: "test", display: "test", repetitions: 1 };
const result: Result = { status: "success", startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:10.000Z", humanInterventions: 0, plannerHandoffs: 0, actions: 5, wrongActions: 0, evidence: ["synthetic:test"], verification: "Synthetic final state assertion", reason: "" };

test("fixed task plan has all repetitions and empty metrics do not imply success", () => {
  const batch = createBatch({ ...config, repetitions: 3 });
  assert.equal(batch.slots.length, TASKS.length * 3);
  const summary = report(batch).overall;
  assert.equal(summary.recorded, 0);
  assert.equal(summary.complete, false);
  assert.equal(summary.finalSuccessRate, null);
  assert.equal(summary.allDuration.p95Ms, null);
});

test("failure, block, cancellation stay in denominator; assisted success is separate", () => {
  let batch = createBatch(config);
  const outcomes: Result[] = [result, { ...result, humanInterventions: 1 }, { ...result, wrongActions: 1 },
    { ...result, status: "failed", reason: "wrong final value" }, { ...result, status: "blocked", reason: "approval declined" },
    { ...result, status: "cancelled", reason: "user stopped" }];
  for (let i = 0; i < outcomes.length; i++) batch = recordResult(batch, batch.slots[i]!.id, outcomes[i]);
  const summary = report(batch).overall;
  assert.equal(summary.finalSuccessRate, 0.5);
  assert.equal(summary.autonomousSuccessRate, 1 / 6);
  assert.equal(summary.humanInterventions, 1);
  assert.equal(summary.wrongActions, 1);
  assert.equal(summary.wrongActionRate, 1 / 30);
  assert.equal(summary.complete, true);
  assert.equal(summary.allDuration.samples, 6);
  assert.equal(summary.successfulDuration.samples, 3);
});

test("over-budget success is rejected but failed overrun evidence is retained", () => {
  const batch = createBatch(config), slot = batch.slots[0]!.id;
  for (const patch of [{ endedAt: "2026-01-01T00:03:01.000Z" }, { actions: 31 }]) {
    assert.throws(() => recordResult(batch, slot, { ...result, ...patch }), /budget/);
    const failed = recordResult(batch, slot, { ...result, ...patch, status: "failed", reason: "budget exceeded" });
    assert.equal(report(failed).overall.statuses.failed, 1);
  }
});

test("record is immutable and cannot overwrite an attempt", () => {
  const initial = createBatch(config);
  const next = recordResult(initial, initial.slots[0]!.id, result);
  assert.equal(initial.slots[0]!.result, null);
  assert.throws(() => recordResult(next, next.slots[0]!.id, result), /already recorded/);
  assert.throws(() => recordResult(next, "unknown", result));
});

test("invalid evidence, counts, times and missing reasons fail closed", () => {
  for (const patch of [{ evidence: [] }, { verification: " " }, { actions: -1 }, { humanInterventions: 0.5 },
    { wrongActions: 6 }, { endedAt: "2025-01-01T00:00:00.000Z" }, { endedAt: "2026-02-30T00:00:00.000Z" },
    { status: "blocked", reason: "" }, { startedAt: "not a date" }]) {
    const batch = createBatch(config);
    assert.throws(() => recordResult(batch, batch.slots[0]!.id, { ...result, ...patch }));
  }
});

test("missing, duplicate, modified or unknown plans cannot be reported", () => {
  const missing = createBatch(config); missing.slots.pop();
  assert.throws(() => validateBatch(missing));
  const duplicate = createBatch(config); duplicate.slots[1] = duplicate.slots[0]!;
  assert.throws(() => validateBatch(duplicate));
  assert.throws(() => validateBatch({ ...createBatch(config), tasks: [] }));
  assert.throws(() => validateBatch({ ...createBatch(config), suite: "old" }));
  for (const patch of [{ mode: "auto" }, { execution: "demo" }, { repetitions: 0 }, { repetitions: 101 }, { commit: "main" }, { jevModel: "jev" }]) {
    assert.throws(() => createBatch({ ...config, ...patch }));
  }
});

test("timings include failures and compute median/nearest-rank P95", () => {
  let batch = createBatch(config);
  batch = recordResult(batch, batch.slots[0]!.id, result);
  batch = recordResult(batch, batch.slots[1]!.id, { ...result, status: "failed", reason: "timeout", endedAt: "2026-01-01T00:00:30.000Z" });
  const summary = report(batch).overall;
  assert.equal(summary.allDuration.medianMs, 20000);
  assert.equal(summary.allDuration.p95Ms, 30000);
  assert.equal(summary.successfulDuration.medianMs, 10000);
  assert.equal(summary.pending, 4);
});

test("CLI init/record/report keeps old files and refuses overwrites", () => {
  const dir = mkdtempSync(join(tmpdir(), "deskhand-benchmark-"));
  const cli = new URL("../scripts/benchmark.ts", import.meta.url);
  const run = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", cli.pathname, ...args], { encoding: "utf8" });
  try {
    const cfg = join(dir, "config.json"), first = join(dir, "first.json"), next = join(dir, "next.json"), record = join(dir, "result.json");
    writeFileSync(cfg, JSON.stringify(config)); writeFileSync(record, JSON.stringify(result));
    assert.equal(run("init", cfg, first).status, 0);
    assert.equal(statSync(first).mode & 0o777, 0o600);
    assert.notEqual(run("init", cfg, first).status, 0);
    assert.equal(run("record", first, "calculator-add/1", record, next).status, 0);
    assert.equal(JSON.parse(readFileSync(first, "utf8")).slots[0].result, null);
    const response = run("report", next);
    assert.equal(response.status, 0);
    assert.equal(JSON.parse(response.stdout).overall.recorded, 1);
    assert.notEqual(run("record", next, "calculator-add/1", record, join(dir, "bad.json")).status, 0);
    assert.notEqual(run("unknown").status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
