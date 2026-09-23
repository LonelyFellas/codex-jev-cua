export const DEFAULT_TASK_LIMITS = { durationMs: 180_000, maxActions: 30 } as const;
export class TaskBudgetError extends Error {
  readonly code: "task_deadline_exceeded" | "action_budget_exhausted";
  constructor(code: TaskBudgetError["code"]) { super(code); this.name = "TaskBudgetError"; this.code = code; }
}
/** One agent turn, shared by all desktop calls. Reconnection/mode changes never reset it. */
export class TaskBudget {
  private startedAt?: number;
  private actions = 0;
  private lastFinishedAt?: number;
  readonly limits: { durationMs: number; maxActions: number };
  private readonly now: () => number;
  constructor(limits: { durationMs: number; maxActions: number } = DEFAULT_TASK_LIMITS, now = () => performance.now()) {
    this.now = now;
    if (!Number.isInteger(limits.durationMs) || limits.durationMs < 1 || limits.durationMs > 180_000
      || !Number.isInteger(limits.maxActions) || limits.maxActions < 1 || limits.maxActions > 30) throw new Error("Invalid task budget limits.");
    this.limits = { ...limits };
  }
  status() {
    const elapsedMs = this.startedAt === undefined ? 0 : Math.max(0, this.now() - this.startedAt);
    return { scope: "agent_turn", started: this.startedAt !== undefined, elapsedMs: Math.round(elapsedMs),
      remainingMs: Math.max(0, Math.floor(this.limits.durationMs - elapsedMs)), actions: this.actions,
      remainingActions: Math.max(0, this.limits.maxActions - this.actions), ...this.limits };
  }
  enter() {
    this.startedAt ??= this.now();
    const remaining = this.status().remainingMs;
    if (remaining <= 0) throw new TaskBudgetError("task_deadline_exceeded");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new TaskBudgetError("task_deadline_exceeded")), remaining);
    const betweenCallsMs = this.lastFinishedAt === undefined ? 0 : Math.max(0, this.now() - this.lastFinishedAt);
    return { signal: controller.signal, betweenCallsMs: Math.round(betweenCallsMs),
      finish: () => { clearTimeout(timer); this.lastFinishedAt = this.now(); } };
  }
  beforeDispatch(action: boolean) {
    if (this.startedAt === undefined || this.status().remainingMs <= 0) throw new TaskBudgetError("task_deadline_exceeded");
    if (!action) return;
    if (this.actions >= this.limits.maxActions) throw new TaskBudgetError("action_budget_exhausted");
    this.actions++;
  }
}
