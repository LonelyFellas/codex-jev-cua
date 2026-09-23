import { randomUUID } from "node:crypto";
import { truncateHead } from "./bounded-text.ts";
import type { SkyContent, SkyResult } from "./sky/client.ts";
import { SkyCallError, responseCode } from "./sky/diagnostics.ts";

export interface NativeRecovery {
  app: string;
  failedMethod: string;
  previousActionOutcome: "unknown" | "not_applicable";
}
export interface NativeSnapshot {
  id: string;
  app: string;
  turnId: string;
  createdAt: number;
  indexes: Set<number>;
  hasScreenshot: boolean;
  nativeIdentity?: string;
}
export function formatNativeResult(result: SkyResult): { content: SkyContent[]; text: string; truncated: boolean; hasScreenshot: boolean } {
  const texts = (result.content ?? []).filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.type === "text" ? item.text : "");
  const limited = truncateHead(texts.join("\n"), { maxBytes: 50_000, maxLines: 2000 });
  const code = result.diagnostics?.code ?? responseCode(limited.content, Boolean(result.isError));
  if (result.isError || code || ["declined", "cancelled"].includes(result.diagnostics?.approval ?? "")) {
    const diagnostic = result.diagnostics ?? { method: "unknown", phase: "response", dispatched: true, rpcOutcome: result.isError ? "tool_error" : "returned",
      approval: "not_requested", code, timings: { bridgeTotalMs: 0, initializeMs: 0, discoveryMs: 0, rpcMs: 0, approvalMs: 0 } };
    throw new SkyCallError(`Sky rejected the call (${code ?? diagnostic.approval}); approval may have been declined. Action success is unknown; do not bypass or replay automatically.`, diagnostic);
  }
  const content: SkyContent[] = [{ type: "text", text: limited.content + (limited.truncated ? "\n[Native text truncated; do not invent unseen elements.]" : "") }];
  const image = (result.content ?? []).find((item) => item.type === "image" && typeof item.data === "string"
    && item.data.length <= 20 * 1024 * 1024 && ["image/png", "image/jpeg", "image/webp"].includes(item.mimeType));
  if (image) content.push(image);
  return { content, text: limited.content, truncated: limited.truncated, hasScreenshot: Boolean(image) };
}
export function newSnapshot(app: string, turnId: string, result: ReturnType<typeof formatNativeResult>): NativeSnapshot {
  if (!result.text.trim() && !result.hasScreenshot) throw new Error("Native observation returned no usable state.");
  return { id: randomUUID(), app, turnId, createdAt: performance.now(), hasScreenshot: result.hasScreenshot,
    indexes: new Set([...result.text.matchAll(/^\s*(\d+)\s/gm)].map((match) => Number(match[1]))), nativeIdentity: nativeIdentity(result.text) };
}
function nativeIdentity(text: string): string | undefined {
  const header = text.match(/^App=(.+)$/m)?.[1];
  if (!header) return undefined;
  const wrapped = header.match(/^.+ \(bundleID ([\w.-]+), pid (\d+)\)$/);
  const direct = header.match(/^([\w.-]+) \(pid (\d+)\)$/);
  const match = wrapped ?? direct;
  return match ? `${match[1]}:${match[2]}` : undefined;
}
/** Fail closed for deltas, missing identity, screenshots, or incomplete native window envelopes. */
export function canReuseActionState(previous: NativeSnapshot | undefined, result: ReturnType<typeof formatNativeResult>): boolean {
  if (!previous?.nativeIdentity || result.truncated || !result.hasScreenshot || nativeIdentity(result.text) !== previous.nativeIdentity) return false;
  if (!/^App=[^\n]+\r?\nWindow: [^\n]+\r?\n0 standard window\b/.test(result.text.trim())
    || /\b(diff|delta|partial|unchanged)\b/i.test(result.text)) return false;
  const indexes = [...result.text.matchAll(/^\s*(\d+)\s/gm)].map((m) => Number(m[1]));
  return indexes.length > 1 && indexes.every(Number.isSafeInteger) && new Set(indexes).size === indexes.length;
}
export function validateNativeAction(snapshot: NativeSnapshot | undefined, method: string, args: Record<string, unknown>, turnId: string): void {
  if (!snapshot || args.stateId !== snapshot.id || args.app !== snapshot.app || snapshot.turnId !== turnId
      || performance.now() - snapshot.createdAt > 60_000) throw new Error("Native state is stale, consumed or belongs to another app/turn. Call cua_get_app_state again.");
  const index = args.element_index;
  if (index !== undefined && (typeof index !== "number" || !Number.isSafeInteger(index) || !snapshot.indexes.has(index))) throw new Error("Element index is not present in the returned observation. Observe again.");
  if (method === "click") {
    const hasIndex = index !== undefined;
    const hasCoordinates = args.x !== undefined || args.y !== undefined;
    if (hasIndex === hasCoordinates) throw new Error("Choose exactly one click target: element_index OR x/y.");
    if (hasCoordinates && (!Number.isFinite(args.x) || !Number.isFinite(args.y))) throw new Error("Both x and y are required.");
  }
  if ((method === "drag" || (method === "click" && index === undefined)) && !snapshot.hasScreenshot) throw new Error("No native screenshot is available for coordinate actions; use an observed element or inspect again.");
}
