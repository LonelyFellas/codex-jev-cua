export interface SkyDiagnostics {
  method: string;
  requestId?: number;
  phase: string;
  dispatched: boolean;
  rpcOutcome: "not_returned" | "returned" | "tool_error" | "transport_error";
  approval: "not_requested" | "accepted" | "declined" | "cancelled";
  approvalReason?: "user_accepted" | "user_declined" | "caller_cancelled" | "unsupported_request" | "handler_unavailable" | "handler_error" | "concurrent_request" | "incomplete_request";
  code?: "session_stopped" | "no_windows_available" | "state_changed" | "sky_tool_error" | "transport_error" | "timeout" | "cancelled" | "task_deadline_exceeded";
  timings: { bridgeTotalMs: number; initializeMs: number; discoveryMs: number; rpcMs: number; approvalMs: number };
}
export class SkyCallError extends Error {
  readonly diagnostics: SkyDiagnostics;
  constructor(message: string, diagnostics: SkyDiagnostics) { super(message); this.name = "SkyCallError"; this.diagnostics = diagnostics; }
}
export function actionOutcome(diagnostic: SkyDiagnostics | undefined, isAction: boolean) {
  if (!isAction) return "not_applicable";
  if (diagnostic?.dispatched === false) return "not_dispatched";
  if (diagnostic?.rpcOutcome === "returned" && !diagnostic.code
    && !["declined", "cancelled"].includes(diagnostic.approval)) return "call_returned";
  // Sky's composite action + observation call does not expose a separate action receipt.
  return "unknown";
}
export function responseCode(text: string, isError: boolean): SkyDiagnostics["code"] {
  // Match only the standalone Sky control reply, never a phrase inside an AX tree.
  if (text.trim() === "This application session has been explicitly stopped by the user for this turn. Stop your work and send a final message noting they stopped the session and you're ready to continue if they want you to. Computer Use can be used again in the next assistant turn.") return "session_stopped";
  if (/^Computer Use server error -10005: noWindowsAvailable\b/.test(text.trim())) return "no_windows_available";
  if (/^The user changed '[^\r\n]+'\. Re-query the latest state/.test(text.trim())) return "state_changed";
  return isError ? "sky_tool_error" : undefined;
}
