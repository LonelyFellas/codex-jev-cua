export const DEFAULT_TASK_LIMITS = { durationMs: 180_000, maxActions: 30 } as const;
export const UNLIMITED_TASK_LIMITS = { durationMs: null, maxActions: null } as const;
export interface TaskLimits { durationMs: number | null; maxActions: number | null }
export class TaskBudgetError extends Error {
  readonly code: "task_deadline_exceeded" | "action_budget_exhausted";
  constructor(code: TaskBudgetError["code"]) { super(code); this.name = "TaskBudgetError"; this.code = code; }
}
/** Tracks elapsed time and actions even without caps. Changing mode never resets accounting. */
export class TaskBudget {
  private startedAt?: number;
  private actions = 0;
  private lastFinishedAt?: number;
  private currentLimits: TaskLimits = DEFAULT_TASK_LIMITS;
  private readonly now: () => number;
  constructor(limits: TaskLimits = DEFAULT_TASK_LIMITS, now = () => performance.now()) {
    this.now = now;
    this.setLimits(limits);
  }
  get limits(): Readonly<TaskLimits> { return this.currentLimits; }
  /** Called between operations, never used to renew elapsed time or action counts. */
  setLimits(limits: TaskLimits) {
    if ((limits.durationMs !== null && (!Number.isInteger(limits.durationMs) || limits.durationMs < 1 || limits.durationMs > 180_000))
      || (limits.maxActions !== null && (!Number.isInteger(limits.maxActions) || limits.maxActions < 1 || limits.maxActions > 30))) throw new Error("Invalid task budget limits.");
    this.currentLimits = { ...limits };
  }
  status() {
    const elapsedMs = this.startedAt === undefined ? 0 : Math.max(0, this.now() - this.startedAt);
    return { scope: "agent_turn", started: this.startedAt !== undefined, elapsedMs: Math.round(elapsedMs),
      remainingMs: this.limits.durationMs === null ? null : Math.max(0, Math.floor(this.limits.durationMs - elapsedMs)), actions: this.actions,
      remainingActions: this.limits.maxActions === null ? null : Math.max(0, this.limits.maxActions - this.actions), ...this.limits };
  }
  enter() {
    this.startedAt ??= this.now();
    const remaining = this.status().remainingMs;
    if (remaining === 0) throw new TaskBudgetError("task_deadline_exceeded");
    const controller = new AbortController();
    const timer = remaining === null ? undefined : setTimeout(() => controller.abort(new TaskBudgetError("task_deadline_exceeded")), remaining);
    const betweenCallsMs = this.lastFinishedAt === undefined ? 0 : Math.max(0, this.now() - this.lastFinishedAt);
    return { signal: controller.signal, betweenCallsMs: Math.round(betweenCallsMs),
      finish: () => { clearTimeout(timer); this.lastFinishedAt = this.now(); } };
  }
  beforeDispatch(action: boolean) {
    if (this.startedAt === undefined || this.status().remainingMs === 0) throw new TaskBudgetError("task_deadline_exceeded");
    if (!action) return;
    if (this.limits.maxActions !== null && this.actions >= this.limits.maxActions) throw new TaskBudgetError("action_budget_exhausted");
    this.actions++;
  }
}
