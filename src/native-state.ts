import { randomUUID } from "node:crypto";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import type { SkyContent, SkyResult } from "./sky/client.ts";

export interface NativeSnapshot {
  id: string;
  app: string;
  turnId: string;
  createdAt: number;
  indexes: Set<number>;
  hasScreenshot: boolean;
}
export function formatNativeResult(result: SkyResult): { content: SkyContent[]; text: string; truncated: boolean; hasScreenshot: boolean } {
  const texts = (result.content ?? []).filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.type === "text" ? item.text : "");
  const limited = truncateHead(texts.join("\n"), { maxBytes: 50_000, maxLines: 2000 });
  if (result.isError) throw new Error(`Sky rejected the call: ${limited.content.slice(0, 2000) || "No diagnostic text"}. Do not bypass the refusal or replay automatically.`);
  const content: SkyContent[] = [{ type: "text", text: limited.content + (limited.truncated ? "\n[Native text truncated; do not invent unseen elements.]" : "") }];
  const image = (result.content ?? []).find((item) => item.type === "image" && typeof item.data === "string"
    && item.data.length <= 20 * 1024 * 1024 && ["image/png", "image/jpeg", "image/webp"].includes(item.mimeType));
  if (image) content.push(image);
  return { content, text: limited.content, truncated: limited.truncated, hasScreenshot: Boolean(image) };
}
export function newSnapshot(app: string, turnId: string, result: ReturnType<typeof formatNativeResult>): NativeSnapshot {
  if (!result.text.trim() && !result.hasScreenshot) throw new Error("Native observation returned no usable state.");
  return { id: randomUUID(), app, turnId, createdAt: performance.now(), hasScreenshot: result.hasScreenshot,
    indexes: new Set([...result.text.matchAll(/^\s*(\d+)\s/gm)].map((match) => Number(match[1]))) };
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
