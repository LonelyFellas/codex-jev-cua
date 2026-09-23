// Adapted from manaflow-ai/pi-codex-cua (MIT). See LICENSE.pi-codex-cua.
// Changes: bounded framing, cancellation/deadlines, fail-closed lifecycle and redacted diagnostics.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { SkyRuntime } from "./runtime.ts";
import { SkyCallError, responseCode } from "./diagnostics.ts";
import type { SkyDiagnostics } from "./diagnostics.ts";
import { TaskBudgetError } from "../task-budget.ts";

export type SkyContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface SkyResult { content?: SkyContent[]; isError?: boolean; diagnostics?: SkyDiagnostics }
interface ToolSchema { name: string; inputSchema?: { properties?: Record<string, unknown>; additionalProperties?: boolean } }
interface DiscoveryResult extends SkyResult { tools?: ToolSchema[] }
export class SkyTimeoutError extends Error {
  constructor(phase: string, timeoutMs: number) {
    super(`Sky timeout after ${timeoutMs}ms during ${phase}. The connection was closed; no retry was attempted.`);
    this.name = "SkyTimeoutError";
  }
}
export interface TurnIdentity {
  sessionId: string; threadId: string; turnId: string; startedAt: number; model: string; reasoningEffort?: string;
}
export function newTurnIdentity(sessionId: string, model: string, reasoningEffort?: string): TurnIdentity {
  return { sessionId, threadId: sessionId, turnId: randomUUID(), startedAt: Date.now(), model, reasoningEffort };
}
export function requestMeta(turn: TurnIdentity) {
  return {
    "x-codex-turn-metadata": {
      session_id: turn.sessionId, thread_id: turn.threadId, turn_id: turn.turnId,
      turn_started_at_unix_ms: turn.startedAt, model: turn.model,
      ...(turn.reasoningEffort ? { reasoning_effort: turn.reasoningEffort } : {}), sandbox: "danger-full-access",
    },
    "codex/plugin_id": "computer-use@openai-bundled", threadId: turn.threadId,
  };
}
export function prepareArguments(args: Record<string, unknown>): Record<string, unknown> {
  return { ...args, ...(typeof args.element_index === "number" ? { element_index: String(args.element_index) } : {}) };
}
export type SkyApprovalHandler = (message: string, signal: AbortSignal) => Promise<boolean>;
export class SkyApprovalUnavailableError extends Error {
  constructor() { super("Official approval requires an interactive UI; no user decision was made."); }
}
interface Pending { resolve: (result: SkyResult) => void; reject: (error: Error) => void }
export class SkyClient {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private busy = false;
  private initialized = false;
  private phase = "not_started";
  private schemas = new Map<string, ToolSchema>();
  private approvalHandler?: SkyApprovalHandler;
  private callSignal?: AbortSignal;
  private pauseDeadline?: () => void;
  private resumeDeadline?: () => void;
  private approvalPending = false;
  private diagnostic?: SkyDiagnostics;
  private finishApprovalTiming?: () => void;
  private buffer = "";
  private readonly decoder = new StringDecoder("utf8");

  private readonly runtime: SkyRuntime;
  private readonly timeoutMs: number;
  constructor(runtime: SkyRuntime, timeoutMs = 30_000) {
    this.runtime = runtime;
    this.timeoutMs = timeoutMs;
  }

  async callSky(method: string, args: Record<string, unknown>, turn: TurnIdentity, signal?: AbortSignal, approve?: SkyApprovalHandler): Promise<SkyResult> {
    if (this.closed) throw new Error("Sky connection closed. Start a new task and observe before acting.");
    if (this.busy) throw new Error("Sky connection is busy; concurrent CU calls are not supported.");
    signal?.throwIfAborted();
    this.busy = true;
    const startedAt = performance.now();
    const diagnostic: SkyDiagnostics = { method, phase: "preflight", dispatched: false, rpcOutcome: "not_returned", approval: "not_requested",
      timings: { bridgeTotalMs: 0, initializeMs: 0, discoveryMs: 0, rpcMs: 0, approvalMs: 0 } };
    this.diagnostic = diagnostic;
    this.phase = "preflight";
    const controller = new AbortController();
    let remainingMs = this.timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let armedAt = 0;
    this.pauseDeadline = () => {
      if (timer) { clearTimeout(timer); timer = undefined; remainingMs -= performance.now() - armedAt; }
    };
    this.resumeDeadline = () => {
      if (timer || this.closed) return;
      armedAt = performance.now();
      timer = setTimeout(() => controller.abort(new SkyTimeoutError(this.phase, this.timeoutMs)), Math.max(0, remainingMs));
    };
    this.resumeDeadline();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    this.callSignal = combined;
    this.approvalHandler = approve;
    this.approvalPending = false;
    try {
      if (!this.initialized) await this.start(combined);
      this.phase = "validate_arguments";
      combined.throwIfAborted();
      const schema = this.schemas.get(method);
      if (!schema) throw new Error(`Sky does not advertise tool ${method}.`);
      const prepared = prepareArguments(args);
      // Some Sky versions expose disableDiff at a higher-level JS layer only.
      // Never send unsupported options through the strict native MCP interface.
      if (method === "get_app_state" && !Object.hasOwn(schema.inputSchema?.properties ?? {}, "disableDiff")) delete prepared.disableDiff;
      if (method === "select_text" && prepared.selection_type !== undefined
          && !Object.hasOwn(schema.inputSchema?.properties ?? {}, "selection_type") && Object.hasOwn(schema.inputSchema?.properties ?? {}, "selection")) {
        prepared.selection = prepared.selection_type;
        delete prepared.selection_type;
      }
      if (schema.inputSchema?.additionalProperties === false) {
        const unexpected = Object.keys(prepared).filter((key) => !Object.hasOwn(schema.inputSchema?.properties ?? {}, key));
        if (unexpected.length) throw new Error(`Unsupported Sky arguments for ${method}: ${unexpected.join(", ")}`);
      }
      this.phase = method;
      const rpcStarted = performance.now();
      try {
        const result = await this.request("tools/call", { name: method, arguments: prepared, _meta: requestMeta(turn) }, combined);
        // A tool reply arriving before its approval completes is not usable state.
        if (this.approvalPending && !["declined", "cancelled"].includes(diagnostic.approval)) {
          diagnostic.approval = "cancelled";
          diagnostic.approvalReason = "incomplete_request";
        }
        // Never accept diagnostic fields supplied by the remote service.
        diagnostic.rpcOutcome = result.isError ? "tool_error" : "returned";
        const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.type === "text" ? c.text : "").join("\n");
        diagnostic.code = responseCode(text, Boolean(result.isError));
        return { ...result, diagnostics: diagnostic };
      } finally { diagnostic.timings.rpcMs = Math.round(performance.now() - rpcStarted); }
    } catch (error) {
      this.close();
      diagnostic.rpcOutcome = "transport_error";
      diagnostic.code = signal?.reason instanceof TaskBudgetError ? "task_deadline_exceeded"
        : signal?.aborted ? "cancelled" : controller.signal.aborted ? "timeout" : "transport_error";
      const failure = controller.signal.aborted && !signal?.aborted ? controller.signal.reason : error;
      throw new SkyCallError(failure instanceof Error ? failure.message : "Sky call failed.", diagnostic);
    } finally {
      this.finishApprovalTiming?.(); this.finishApprovalTiming = undefined;
      diagnostic.phase = this.phase;
      diagnostic.timings.bridgeTotalMs = Math.round(performance.now() - startedAt);
      this.diagnostic = undefined;
      clearTimeout(timer);
      this.approvalHandler = undefined; this.callSignal = undefined;
      this.pauseDeadline = undefined; this.resumeDeadline = undefined;
      this.busy = false;
    }
  }

  private async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const env = { ...process.env };
    // The desktop bridge has no need for the Jev credential.
    delete env.TYPESAFE_API_KEY;
    // This is the first-party signed process chain used upstream, not a permission bypass.
    const child = spawn(this.runtime.codexCliPath, [
      "sandbox", "-P", ":danger-full-access", "--allow-unix-socket", this.runtime.socketDirectory,
      this.runtime.clientPath, "mcp",
    ], { stdio: ["pipe", "pipe", "pipe"], cwd: this.runtime.cwd, env });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => {
      this.buffer += this.decoder.write(chunk);
      if (Buffer.byteLength(this.buffer) > 64 * 1024 * 1024) { this.fail(new Error("Sky response exceeded 64 MiB.")); return; }
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        this.onLine(line);
      }
    });
    // Drain diagnostics without retaining or echoing possibly sensitive app content.
    child.stderr.resume();
    child.stdin.on("error", () => this.fail(new Error("Sky input pipe failed.")));
    child.stdout.on("error", () => this.fail(new Error("Sky output pipe failed.")));
    child.once("error", () => this.fail(new Error("Sky process failed to launch.")));
    child.once("exit", () => this.fail(new Error("Sky process exited. Outcome may be unknown; do not replay actions.")));
    this.phase = "initialize";
    const initializeStarted = performance.now();
    try {
      await this.request("initialize", {
        protocolVersion: "2025-06-18", capabilities: { elicitation: {} }, clientInfo: { name: "jev-codex-cua", version: "0.1.0" },
      }, signal);
    } finally { if (this.diagnostic) this.diagnostic.timings.initializeMs = Math.round(performance.now() - initializeStarted); }
    signal.throwIfAborted();
    this.write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    this.phase = "tools/list";
    const discoveryStarted = performance.now();
    let discovery: DiscoveryResult;
    try { discovery = await this.request("tools/list", {}, signal) as DiscoveryResult; }
    finally { if (this.diagnostic) this.diagnostic.timings.discoveryMs = Math.round(performance.now() - discoveryStarted); }
    if (!Array.isArray(discovery.tools) || discovery.tools.some((tool) => !tool || typeof tool.name !== "string")) throw new Error("Sky returned an invalid tool catalog.");
    this.schemas = new Map(discovery.tools.map((tool) => [tool.name, tool]));
    this.initialized = true;
  }

  private onLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("bad frame");
      message = value as Record<string, unknown>;
    } catch { this.fail(new Error("Invalid Sky protocol frame.")); return; }
    // Server-initiated JSON-RPC requests may use STRING IDs, independent of our numeric IDs.
    if (typeof message.method === "string" && (typeof message.id === "string" || typeof message.id === "number")) {
      void this.onServerRequest(message.id, message.method, message.params);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (pending && ("result" in message || "error" in message)) {
      this.pending.delete(message.id);
      if (message.error) {
        const error = message.error as { code?: unknown };
        pending.reject(new Error(`Sky RPC error ${typeof error.code === "number" ? error.code : "unknown"}. Check desktop permissions and runtime compatibility.`));
      } else if (message.result && typeof message.result === "object" && !Array.isArray(message.result)) {
        pending.resolve(message.result as SkyResult);
      } else { pending.reject(new Error("Invalid Sky RPC response.")); }
    }
  }

  private async onServerRequest(id: string | number, method: string, params: unknown): Promise<void> {
    if (method !== "elicitation/create") {
      this.write({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unsupported client method" } });
      return;
    }
    const request = params as { message?: unknown; mode?: unknown; requestedSchema?: { type?: unknown; properties?: unknown; required?: unknown } } | null;
    const schema = request?.requestedSchema;
    // We support confirmation only: never collect credentials, fill arbitrary forms or open URLs.
    const emptyObject = schema?.type === "object" && schema.properties != null && typeof schema.properties === "object"
      && !Array.isArray(schema.properties) && Object.keys(schema.properties).length === 0
      && (schema.required === undefined || (Array.isArray(schema.required) && schema.required.length === 0));
    const valid = request && typeof request.message === "string" && request.message.length > 0 && request.message.length <= 4000
      && (request.mode === undefined || request.mode === "form") && emptyObject;
    const signal = this.callSignal;
    const diagnostic = this.diagnostic;
    // Preserve a refusal/cancellation for the entire call. A subsequent request
    // must not overwrite it, but sequential prompts after acceptance are valid.
    const stopped = () => diagnostic?.approval === "declined" || diagnostic?.approval === "cancelled";
    if (stopped()) {
      this.write({ jsonrpc: "2.0", id, result: { action: "cancel" } });
      return;
    }
    if (!valid || !signal || signal.aborted || !this.approvalHandler || this.approvalPending) {
      if (diagnostic) {
        diagnostic.approval = "cancelled";
        diagnostic.approvalReason = !valid ? "unsupported_request" : !signal || signal.aborted ? "caller_cancelled"
          : !this.approvalHandler ? "handler_unavailable" : "concurrent_request";
      }
      this.write({ jsonrpc: "2.0", id, result: { action: "cancel" } });
      return;
    }
    this.approvalPending = true;
    this.pauseDeadline?.();
    const approvalStarted = performance.now();
    let timingFinished = false;
    const finishTiming = () => {
      if (!timingFinished && diagnostic) diagnostic.timings.approvalMs += Math.round(performance.now() - approvalStarted);
      timingFinished = true;
    };
    this.finishApprovalTiming = finishTiming;
    try {
      const accepted = await this.approvalHandler(request.message as string, signal);
      const cancelled = signal.aborted || this.callSignal !== signal || this.closed || stopped();
      if (diagnostic && !stopped()) {
        diagnostic.approval = cancelled ? "cancelled" : accepted === true ? "accepted" : "declined";
        diagnostic.approvalReason = cancelled ? "caller_cancelled" : accepted === true ? "user_accepted" : "user_declined";
      }
      this.write({ jsonrpc: "2.0", id, result: cancelled ? { action: "cancel" } : accepted === true ? { action: "accept", content: {} } : { action: "decline" } });
    } catch (error) {
      if (diagnostic && !stopped()) {
        diagnostic.approval = "cancelled";
        diagnostic.approvalReason = signal.aborted ? "caller_cancelled"
          : error instanceof SkyApprovalUnavailableError ? "handler_unavailable" : "handler_error";
      }
      this.write({ jsonrpc: "2.0", id, result: { action: "cancel" } });
    } finally {
      finishTiming();
      if (this.callSignal === signal) {
        this.approvalPending = false;
        this.resumeDeadline?.();
      }
    }
  }

  private request(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<SkyResult> {
    signal.throwIfAborted();
    if (!this.child || this.closed) return Promise.reject(new Error("Sky is not running."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        signal.removeEventListener("abort", abort);
        this.write({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "Task cancelled" } });
        reject(signal.reason instanceof SkyTimeoutError ? signal.reason : new Error(`Sky call cancelled by caller during ${this.phase}; no retry was attempted.`));
        this.close();
      };
      this.pending.set(id, {
        resolve: (value) => { signal.removeEventListener("abort", abort); resolve(value); },
        reject: (error) => { signal.removeEventListener("abort", abort); reject(error); },
      });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      if (method === "tools/call" && this.diagnostic) {
        this.diagnostic.dispatched = true;
        this.diagnostic.requestId = id;
      }
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }
  private write(message: unknown): void {
    if (!this.closed) this.child?.stdin.write(JSON.stringify(message) + "\n");
  }
  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.close();
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(new Error("Sky connection closed; pending outcome may be unknown."));
    this.pending.clear();
    this.child?.kill("SIGKILL");
    this.child = undefined;
    this.buffer = "";
  }
}
