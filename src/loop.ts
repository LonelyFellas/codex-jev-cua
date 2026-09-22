// TypeScript migration of the Jev-cu observation/decision/policy/action loop. See NOTICE.md.
import { setTimeout as delay } from "node:timers/promises";
import { buildContext, parseAX, selectCandidates } from "./ax.ts";
import { createJevDecider } from "./jev.ts";
import { DEFAULT_ALLOWED_APPS, evaluatePolicy, prepareAction, validDecision } from "./policy.ts";
import { createTrace } from "./trace.ts";
import type { TraceMode } from "./trace.ts";
import type { JevOptions } from "./jev.ts";
import type { AXElement, Decision, Decider, Driver, PreparedAction, Resources, Status, TaskResult } from "./types.ts";

export interface TaskOptions {
  driver: Driver;
  signal?: AbortSignal;
  appName: string;
  goal: string;
  dryRun?: boolean;
  maxSteps?: number;
  candidateMax?: number;
  allowedApps?: readonly string[];
  decide?: Decider;
  jevOptions?: JevOptions;
  resources?: Resources | ((step: number, decision: Readonly<Decision>) => Resources | Promise<Resources>);
  constraints?: string;
  plan?: string;
  verify?: (fullAX: string) => boolean | Promise<boolean>;
  emit?: (line: string) => void;
  traceDir?: string;
  traceMode?: TraceMode;
  verifySpec?: { role: string; labelEquals: string };
  plannerHandoff?: boolean;
}
const activeDrivers = new WeakSet<Driver>();

export async function runTask(options: TaskOptions): Promise<TaskResult> {
  const { driver, appName, goal, verify, signal } = options;
  const check = () => signal?.throwIfAborted();
  const maxSteps = options.maxSteps ?? 30;
  const candidateMax = options.candidateMax ?? 40;
  if (!goal.trim() || !appName.trim()) throw new Error("appName and goal must be nonempty.");
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) throw new Error("maxSteps must be an integer in [1, 100].");
  if (!Number.isInteger(candidateMax) || candidateMax < 1 || candidateMax > 200) throw new Error("candidateMax must be an integer in [1, 200].");
  const started = performance.now();
  const allowedApps = [...(options.allowedApps ?? DEFAULT_ALLOWED_APPS)];
  if (!allowedApps.includes(appName)) return { status: "stop", steps: 0, verified: false, elapsedMs: 0, reason: "app_not_allowed" };
  if (activeDrivers.has(driver)) throw new Error("Driver already running a task; do not overlap tasks or other CU calls.");
  activeDrivers.add(driver);
  let steps = 0;
  let attemptedStep = 0;
  let snapshotSequence = 0;
  let observationSnapshot = 0;
  let phase = "start";
  let outcomeUnknown = false;
  let trace: ReturnType<typeof createTrace> | undefined;
  const emit = options.emit ?? (() => {});
  function snapshot(at: "initial" | "preflight" | "after_action", ax: string): number {
    const snapshotId = ++snapshotSequence;
    trace?.full({ event: "snapshot", step: attemptedStep, at, snapshotId, ax });
    return snapshotId;
  }
  function finish(status: Status, reason: string, extra: Partial<TaskResult> = {}): TaskResult {
    const result: TaskResult = { status, reason, steps, verified: false, elapsedMs: Math.round(performance.now() - started),
      tracePath: trace?.path, ...extra };
    trace?.full({ event: "outcome", step: attemptedStep, phase, result });
    trace?.record({ event: "finish", status, reason, elapsedMs: result.elapsedMs, step: steps });
    emit(`[deskhand] ${status}: ${reason} (${steps} actions, ${result.elapsedMs}ms)`);
    return result;
  }
  try {
    check();
    trace = createTrace(options.traceDir, { mode: options.traceMode,
      secrets: [options.jevOptions?.apiKey, process.env.TYPESAFE_API_KEY].filter((key): key is string => Boolean(key)) });
    trace.record({ event: "start" });
    trace.full({ event: "task", appName, goal, dryRun: options.dryRun !== false, maxSteps, candidateMax,
      plan: options.plan ?? "", constraints: options.constraints ?? "", allowedApps,
      resources: typeof options.resources === "function" ? "callback" : options.resources ?? {},
      verification: { enabled: Boolean(verify), specification: options.verifySpec ?? null },
      decider: options.decide ? "custom" : "jev", });
    phase = "bind";
    await driver.bind(appName);
    check();
    phase = "observe";
    let observation = await driver.observe();
    observationSnapshot = snapshot("initial", observation);
    let unchanged = 0;
    const recentActions: string[] = [];
    const jevSignal = signal && options.jevOptions?.signal ? AbortSignal.any([signal, options.jevOptions.signal]) : signal ?? options.jevOptions?.signal;
    const decide = options.decide ?? createJevDecider({ ...options.jevOptions, signal: jevSignal,
      onTrace: (event) => {
        trace?.full({ event: "jev", step: attemptedStep, exchange: event });
        options.jevOptions?.onTrace?.(event);
      },
    });
    for (let step = 1; step <= maxSteps; step++) {
      attemptedStep = step;
      check();
      phase = "verify";
      const alreadyVerified = verify && await verify(observation);
      trace.full({ event: "verification", step, at: "before_decision", snapshotId: observationSnapshot, enabled: Boolean(verify), passed: alreadyVerified ?? null });
      check();
      if (alreadyVerified) return finish("done", "verified", { verified: true });
      phase = "parse";
      const { candidates, total } = selectCandidates(parseAX(observation), goal, candidateMax);
      const decisionInput = { goal, app: appName, candidates, context: buildContext(observation),
        recentActions: [...recentActions], constraints: [options.plan ? `Plan (from planner): ${options.plan}` : "", options.constraints ?? ""].filter(Boolean).join("\n") };
      trace.full({ event: "decision_input", step, snapshotId: observationSnapshot, totalCandidates: total,
        clipped: total > candidates.length, input: decisionInput });
      if (!candidates.length) return finish("escalate", "no_candidates");
      phase = "decide";
      const decision = Object.freeze({ ...await decide(decisionInput) });
      trace.full({ event: "decision_output", step, snapshotId: observationSnapshot, decision,
        target: candidates.find((candidate) => candidate.index === decision.targetIndex) ?? null });
      check();
      if (!validDecision(decision)) return finish("escalate", "invalid_decision");
      const target = candidates.find((candidate) => candidate.index === decision.targetIndex);
      if (decision.targetIndex !== null && !target) return finish("escalate", "unknown_target");
      // Do not call planner callbacks for completed or invalid decisions.
      if (decision.done! >= 0.9) return finish(verify ? "escalate" : "model_done", verify ? "verification_not_satisfied" : "model_claimed_completion", { decision });
      if (decision.action === "ask_user") return finish("confirm", "model_requested_user", { decision });
      phase = "prepare";
      const resources = typeof options.resources === "function" ? await options.resources(step, decision) : options.resources ?? {};
      check();
      trace.full({ event: "action_prepared", step, resources, status: "preparing" });
      let action: PreparedAction;
      try { action = Object.freeze(prepareAction(decision, resources)); }
      catch (error) {
        trace.full({ event: "failure", step, phase, errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : "Action preparation failed" });
        return finish("escalate", "invalid_action_resources", { decision });
      }
      trace.full({ event: "action_prepared", step, status: "prepared", action, target: target ?? null });
      const gate = evaluatePolicy({ decision, app: appName, allowedApps, target, action, observation });
      trace.full({ event: "gate", step, gate });
      trace.record({ event: "decision", step, action: decision.action, index: decision.targetIndex, confidence: decision.confidence,
        risk: decision.risk, done: decision.done, latencyMs: decision.latencyMs, status: gate.verdict, reason: gate.reason, candidateCount: candidates.length });
      emit(`[deskhand] step=${step} candidates=${candidates.length}/${total} action=${action.kind} gate=${gate.verdict}`);
      const targetSummary = target ? { role: target.role, label: target.label.slice(0, 300) } : undefined;
      if (gate.verdict !== "proceed") {
        const canHandBack = options.plannerHandoff && ["uncertain_target", "low_confidence", "target_not_editable", "focus_not_target"].includes(gate.reason);
        const handoff: TaskResult["handoff"] = canHandBack ? {
          appName, goal, remainingSteps: maxSteps - steps, context: buildContext(observation).slice(0, 600),
          recentActions: recentActions.slice(-3).map((entry) => entry.slice(0, 240)),
          candidates: candidates.slice(0, 12).map((candidate) => ({ index: candidate.index, role: candidate.role.slice(0, 48), label: candidate.label.slice(0, 96) })),
          candidatesTruncated: candidates.length > 12,
          instruction: "Main agent: inspect current state, verify whether the task already succeeded, or refine the next subgoal within the existing user-authorized scope and remaining step budget. Do not repeat the same failed call, replay stale indexes, change policy thresholds, or automatically increase the budget. Ask the user only for missing intent/authorization or a genuine blocker.",
        } : undefined;
        return finish(canHandBack ? "needs_planner" : gate.verdict, gate.reason, { decision, planned: action, target: targetSummary, ...(handoff ? { handoff } : {}) });
      }
      if (options.dryRun !== false) return finish("dry_run", "preview_only", { decision, planned: action, target: targetSummary });
      // Jev HTTP latency can outlive the element indexes. Refresh, fail closed if anything changed.
      phase = "preflight_observe";
      const current = await driver.observe();
      const preflightSnapshot = snapshot("preflight", current);
      check();
      if (current !== observation) return finish("escalate", "observation_changed_before_action");
      phase = "execute";
      outcomeUnknown = true;
      const t = performance.now();
      await execute(driver, action, signal, (method, args) => {
        trace?.full({ event: "dispatch_start", step, snapshotId: preflightSnapshot, appName, method, arguments: args, action, target: target ?? null });
      });
      steps++;
      trace.full({ event: "dispatch_return", step, methodReturned: true, completedCalls: steps, elapsedMs: Math.round(performance.now() - t) });
      check();
      phase = "post_action_observe";
      const previous = observation;
      observation = await driver.observe();
      outcomeUnknown = false;
      observationSnapshot = snapshot("after_action", observation);
      check();
      const changed = observation !== previous;
      unchanged = changed ? 0 : unchanged + 1;
      recentActions.push(summarizeAction(action, target, previous, observation, changed));
      if (recentActions.length > 6) recentActions.shift();
      trace.record({ event: "action", step, action: action.kind, changed, elapsedMs: Math.round(performance.now() - t) });
      phase = "verify";
      const verified = verify && await verify(observation);
      trace.full({ event: "verification", step, at: "after_action", snapshotId: observationSnapshot, enabled: Boolean(verify), passed: verified ?? null });
      check();
      if (verified) return finish("done", "verified", { verified: true });
      if (unchanged >= 3) return finish("escalate", "repeated_no_change");
    }
    return finish("max_steps", "step_budget_exhausted");
  } catch (error) {
    // Only the explicitly enabled full local trace receives error text; public diagnostics stay structural.
    const result: TaskResult = { status: signal?.aborted ? "stop" : "error", reason: signal?.aborted ? "cancelled" : `${phase}_failed`, steps, verified: false,
      elapsedMs: Math.round(performance.now() - started), tracePath: trace?.path, outcomeUnknown,
      ...(trace?.incomplete ? { traceIncomplete: true } : {}) };
    try {
      trace?.full({ event: "failure", step: attemptedStep, phase, outcomeUnknown,
        errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : "Unknown failure" });
      trace?.full({ event: "outcome", step: attemptedStep, phase, result });
      trace?.record({ event: "finish", status: result.status, reason: result.reason, elapsedMs: result.elapsedMs, step: steps });
    } catch { result.traceIncomplete = true; }
    return result;
  } finally { trace?.close(); activeDrivers.delete(driver); }
}

function summarizeAction(action: PreparedAction, target: AXElement | undefined, before: string, after: string, changed: boolean): string {
  const visibleText = (ax: string) => parseAX(ax).filter((e) => e.role === "text").slice(0, 6)
    .map((e) => e.label.replace(/\p{Cf}/gu, "")).join(" | ").slice(0, 240);
  // Indexes belong to one snapshot; a later Calculator layout can reuse an old index
  // for a different digit. Keep the selected label and observed values, not a stale iN.
  return JSON.stringify({ action: action.kind, target: target ? `${target.role}: ${target.label}`.slice(0, 200) : null,
    before: visibleText(before), after: visibleText(after), changed });
}

async function execute(driver: Driver, action: PreparedAction, signal?: AbortSignal, onDispatch?: (method: string, args: unknown[]) => void): Promise<void> {
  signal?.throwIfAborted();
  switch (action.kind) {
    case "click_element":
      if (!driver.click) throw new Error("click unavailable");
      onDispatch?.("driver.click", [action.index]);
      await driver.click(action.index); return;
    case "set_value":
      if (!driver.setValue) throw new Error("setValue unavailable");
      onDispatch?.("driver.setValue", [action.index, action.text]);
      await driver.setValue(action.index, action.text); return;
    case "type_text":
      if (!driver.typeText) throw new Error("typeText unavailable");
      onDispatch?.("driver.typeText", [action.text]);
      await driver.typeText(action.text); return;
    case "press_key":
      if (!driver.pressKey) throw new Error("pressKey unavailable");
      onDispatch?.("driver.pressKey", [action.key]);
      await driver.pressKey(action.key); return;
    case "scroll":
      if (!driver.scroll) throw new Error("scroll unavailable");
      onDispatch?.("driver.scroll", [action.index, action.direction, 1]);
      await driver.scroll(action.index, action.direction, 1); return;
    case "wait": onDispatch?.("wait", [500]); await delay(500, undefined, { signal }); return;
    default: throw new Error("Action requires manual handoff.");
  }
}
