export interface AXElement {
  index: number;
  role: string;
  label: string;
  depth: number;
  raw: string;
}
export interface Candidate extends AXElement { score: number }
export const ACTIONS = ["click_element", "click_at", "drag", "set_value", "type_text", "press_key", "scroll", "wait", "ask_user"] as const;
export type ActionKind = typeof ACTIONS[number];
export interface Decision {
  action: ActionKind | null;
  targetIndex: number | null;
  confidence: number | null;
  risk: number | null;
  done: number | null;
  latencyMs?: number;
  usage?: Record<string, unknown>;
}
export interface DecisionInput {
  goal: string;
  app: string;
  candidates: readonly AXElement[];
  context: string;
  recentActions: readonly string[];
  constraints: string;
}
export type Decider = (input: DecisionInput) => Promise<Decision>;
export type Direction = "up" | "down" | "left" | "right";
export type Point = readonly [number, number];
export interface Resources {
  text?: string;
  key?: string;
  direction?: Direction;
  at?: Point;
  from?: Point;
  to?: Point;
}
export type PreparedAction =
  | { kind: "click_element"; index: number }
  | { kind: "set_value" | "type_text"; index: number; text: string }
  | { kind: "press_key"; index: number; key: string }
  | { kind: "scroll"; index: number; direction: Direction }
  | { kind: "click_at"; at: Point }
  | { kind: "drag"; from: Point; to: Point }
  | { kind: "wait" }
  | { kind: "ask_user" };
export interface Driver {
  bind(appName: string): Promise<unknown>;
  observe(): Promise<string>;
  click?(index: number): Promise<unknown>;
  setValue?(index: number, value: string): Promise<unknown>;
  typeText?(text: string): Promise<unknown>;
  pressKey?(key: string): Promise<unknown>;
  scroll?(index: number, direction: Direction, pages: number): Promise<unknown>;
}
export type Verdict = "proceed" | "confirm" | "escalate" | "stop" | "model_done";
export interface Gate { verdict: Verdict; reason: string }
export type Status = Exclude<Verdict, "proceed"> | "done" | "dry_run" | "max_steps" | "error" | "needs_planner";
export interface TaskResult {
  status: Status;
  steps: number;
  verified: boolean;
  elapsedMs: number;
  reason: string;
  planned?: PreparedAction;
  target?: { role: string; label: string };
  decision?: Decision;
  tracePath?: string;
  traceIncomplete?: boolean;
  outcomeUnknown?: boolean;
  diagnostic?: {
    phase: string;
    actionOutcome: "not_dispatched" | "unknown" | "call_returned";
    observationOutcome: "not_attempted" | "available" | "unavailable";
  };
  handoff?: {
    appName: string;
    goal: string;
    remainingSteps: number;
    context: string;
    recentActions: string[];
    candidates: { index: number; role: string; label: string }[];
    candidatesTruncated: boolean;
    instruction: string;
  };
}
