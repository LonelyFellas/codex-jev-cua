import { DEFAULT_TASK_LIMITS } from "../src/task-budget.ts";

export const SUITE_VERSION = "desktop-v1";
export const TASKS = [
  { id: "calculator-add", app: "Calculator", setup: "使用基本模式，显示 0；准备不计时。", goal: "计算 12 + 30232。", verify: "最终显示 30244（允许本地化千位分隔符）；读取最终 AX 或截图确认。" },
  { id: "calculator-chain", app: "Calculator", setup: "使用基本模式，显示 0；准备不计时。", goal: "计算 (48 + 27) × 3；可以先得到加法结果，再乘以 3。", verify: "最终显示 225；不得仅验证按钮存在。" },
  { id: "textedit-type", app: "TextEdit", setup: "人工创建全新未保存纯文本文档，聚焦空白编辑区；不使用已有文档。", goal: "输入两行：第一行 Deskhand benchmark，第二行 中文输入 123。不要保存。", verify: "读取正文，精确核对两行内容（忽略末尾换行）；无额外内容。" },
  { id: "textedit-replace", app: "TextEdit", setup: "人工创建专用未保存纯文本文档，正文为 alpha beta gamma，光标置于末尾。", goal: "只将 beta 替换为 BETA，保留其余文本。不要保存。", verify: "读取正文为 alpha BETA gamma；无重复或丢失文本。" },
  { id: "browser-form", app: "Google Chrome", setup: "打开仓库 fixtures/benchmark/form.html 的 file URL，刷新；只使用本地页面。", goal: "将姓名填为 Deskhand，选择 Team，勾选同意测试，点击生成预览。", verify: "页面结果精确为 Deskhand | Team | agreed；不算真实提交，不联网。" },
  { id: "browser-delayed", app: "Google Chrome", setup: "打开同一本地表单并刷新，不预先加载详情。", goal: "点击加载详情，等待完成，将详情码填为 READY，然后点击验证详情。", verify: "页面结果精确为 Details verified；必须等控件实际出现后操作。" },
] as const;

export interface Config {
  mode: "native" | "jev";
  execution: "live" | "controlled" | "simulated";
  commit: string;
  mainModel: string;
  jevModel: string;
  macOS: string;
  appVersions: string;
  runtime: string;
  display: string;
  repetitions: number;
}
export interface Result {
  status: "success" | "failed" | "blocked" | "cancelled";
  startedAt: string;
  endedAt: string;
  humanInterventions: number;
  plannerHandoffs: number;
  actions: number;
  wrongActions: number;
  evidence: string[];
  verification: string;
  reason: string;
}
export interface Slot { id: string; taskId: string; repetition: number; result: Result | null }
export interface Batch { suite: string; config: Config; tasks: typeof TASKS; slots: Slot[] }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 4000) throw new Error(`Invalid ${name}.`);
}
function count(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Invalid ${name}.`);
}
export function validateConfig(value: unknown): Config {
  const c = object(value);
  if (!["native", "jev"].includes(String(c.mode)) || !["live", "controlled", "simulated"].includes(String(c.execution))) throw new Error("Invalid mode/execution.");
  for (const key of ["commit", "mainModel", "jevModel", "macOS", "appVersions", "runtime", "display"]) text(c[key], key);
  if (!/^[a-f0-9]{40}$/.test(c.commit as string)) throw new Error("commit must be a full Git SHA.");
  if (c.mode === "native" && c.jevModel !== "none") throw new Error("Native jevModel must be none.");
  if (c.mode === "jev" && c.jevModel === "none") throw new Error("Record the actual Jev model/version or alias.");
  count(c.repetitions, "repetitions");
  if ((c.repetitions as number) < 1 || (c.repetitions as number) > 100) throw new Error("repetitions must be 1..100.");
  return c as unknown as Config;
}
export function createBatch(value: unknown): Batch {
  const config = validateConfig(value);
  return { suite: SUITE_VERSION, config, tasks: TASKS, slots: TASKS.flatMap((task) =>
    Array.from({ length: config.repetitions }, (_, i) => ({ id: `${task.id}/${i + 1}`, taskId: task.id, repetition: i + 1, result: null }))) };
}
function validateResult(value: unknown): asserts value is Result {
  const r = object(value);
  if (!["success", "failed", "blocked", "cancelled"].includes(String(r.status))) throw new Error("Invalid result status.");
  for (const key of ["startedAt", "endedAt"]) {
    text(r[key], key);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r[key] as string)
      || !Number.isFinite(Date.parse(r[key] as string)) || new Date(r[key] as string).toISOString() !== r[key]) throw new Error(`Invalid ISO UTC ${key}.`);
  }
  if (Date.parse(r.endedAt as string) < Date.parse(r.startedAt as string)) throw new Error("Negative duration.");
  for (const key of ["humanInterventions", "plannerHandoffs", "actions", "wrongActions"]) count(r[key], key);
  if ((r.wrongActions as number) > (r.actions as number)) throw new Error("wrongActions exceeds actions.");
  if (!Array.isArray(r.evidence) || !r.evidence.length) throw new Error("Every completed run requires evidence references.");
  for (const item of r.evidence) text(item, "evidence");
  if (typeof r.verification !== "string" || typeof r.reason !== "string") throw new Error("verification/reason must be strings.");
  if (r.status === "success") {
    text(r.verification, "successful verification");
    if (Date.parse(r.endedAt as string) - Date.parse(r.startedAt as string) > DEFAULT_TASK_LIMITS.durationMs
      || (r.actions as number) > DEFAULT_TASK_LIMITS.maxActions) throw new Error("Successful run exceeds the fixed task budget; record failure, not success.");
  } else text(r.reason, "failure/block/cancellation reason");
}
export function validateBatch(value: unknown): Batch {
  const b = object(value);
  const expected = createBatch(b.config);
  if (b.suite !== SUITE_VERSION || JSON.stringify(b.tasks) !== JSON.stringify(TASKS)) throw new Error("Unknown or modified task suite.");
  if (!Array.isArray(b.slots) || b.slots.length !== expected.slots.length) throw new Error("Missing or extra planned slots.");
  const seen = new Set<string>();
  for (const value of b.slots) {
    const slot = object(value);
    const match = expected.slots.find((s) => s.id === slot.id);
    if (!match || seen.has(match.id) || slot.taskId !== match.taskId || slot.repetition !== match.repetition) throw new Error("Invalid/duplicate slot.");
    seen.add(match.id);
    if (slot.result !== null) validateResult(slot.result);
  }
  return b as unknown as Batch;
}
export function recordResult(value: unknown, slotId: string, result: unknown): Batch {
  const batch = structuredClone(validateBatch(value));
  const slot = batch.slots.find((s) => s.id === slotId);
  if (!slot || slot.result !== null) throw new Error("Unknown slot or result already recorded; do not overwrite attempts.");
  validateResult(result);
  slot.result = result;
  return batch;
}
function timing(values: number[]) {
  values.sort((a, b) => a - b);
  const n = values.length;
  return { samples: n, medianMs: n ? (values[Math.floor((n - 1) / 2)]! + values[Math.floor(n / 2)]!) / 2 : null,
    p95Ms: n ? values[Math.ceil(n * 0.95) - 1]! : null };
}
function summarize(slots: Slot[]) {
  const runs = slots.flatMap((s) => s.result ? [s.result] : []);
  const success = runs.filter((r) => r.status === "success");
  const autonomous = success.filter((r) => r.humanInterventions === 0 && r.wrongActions === 0);
  const sum = (key: "humanInterventions" | "plannerHandoffs" | "actions" | "wrongActions") => runs.reduce((n, r) => n + r[key], 0);
  const duration = (r: Result) => Date.parse(r.endedAt) - Date.parse(r.startedAt);
  return { planned: slots.length, recorded: runs.length, pending: slots.length - runs.length, complete: runs.length === slots.length,
    statuses: Object.fromEntries(["success", "failed", "blocked", "cancelled"].map((s) => [s, runs.filter((r) => r.status === s).length])),
    finalSuccessRate: runs.length ? success.length / runs.length : null,
    autonomousSuccessRate: runs.length ? autonomous.length / runs.length : null,
    successfulFractionOfPlan: success.length / slots.length,
    allDuration: timing(runs.map(duration)), successfulDuration: timing(success.map(duration)),
    humanInterventions: sum("humanInterventions"), plannerHandoffs: sum("plannerHandoffs"), actions: sum("actions"), wrongActions: sum("wrongActions"),
    wrongActionRate: sum("actions") ? sum("wrongActions") / sum("actions") : null,
    runsWithWrongActions: runs.filter((r) => r.wrongActions > 0).length };
}
export function report(value: unknown) {
  const batch = validateBatch(value);
  return { suite: batch.suite, config: batch.config, limits: DEFAULT_TASK_LIMITS, warning: "Manual evidence; not independently verified. Never pool live, controlled and simulated runs. Rates use all recorded runs, including blocked/cancelled. Pending runs mean an incomplete benchmark.",
    overall: summarize(batch.slots), tasks: TASKS.map((task) => ({ id: task.id, ...summarize(batch.slots.filter((s) => s.taskId === task.id)) })) };
}
