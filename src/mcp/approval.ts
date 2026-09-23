import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

type ApprovalClient = Pick<Server, "getClientCapabilities" | "elicitInput">;
export type ApprovalOutcome = "accepted" | "declined" | "cancelled" | "unsupported" | "request_cancelled" | "timed_out" | "request_failed";
export interface ApprovalResult {
  outcome: ApprovalOutcome;
  errorCode?: number;
}
export function supportsApproval(client: ApprovalClient): boolean {
  return !!client.getClientCapabilities()?.elicitation?.form;
}

/** Accept approves only the displayed request. Never infer approval from tool args or app scope. */
export async function requestApproval(client: ApprovalClient, message: string, signal: AbortSignal): Promise<ApprovalResult> {
  if (signal.aborted) return { outcome: "request_cancelled" };
  if (!supportsApproval(client)) return { outcome: "unsupported" };
  try {
    const result = await client.elicitInput({ mode: "form",
      message: `${message}\n\nChoose Accept to approve this specific request, or Decline/Cancel to stop. No checkbox is required.`,
      requestedSchema: { type: "object", properties: {} } },
    { signal, timeout: 180_000 });
    if (signal.aborted) return { outcome: "request_cancelled" };
    switch (result.action) {
      case "accept": return { outcome: "accepted" };
      case "decline": return { outcome: "declined" };
      case "cancel": return { outcome: "cancelled" };
      default: return { outcome: "request_failed" };
    }
  } catch (error) {
    if (signal.aborted) return { outcome: "request_cancelled" };
    // Raw transport errors may contain private form content, paths or credentials.
    const errorCode = error instanceof McpError ? error.code : undefined;
    return { outcome: errorCode === ErrorCode.RequestTimeout ? "timed_out" : "request_failed",
      ...(errorCode === undefined ? {} : { errorCode }) };
  }
}
