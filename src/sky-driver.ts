import { parseAX } from "./ax.ts";
import type { Driver } from "./types.ts";
import type { SkyResult, TurnIdentity, SkyApprovalHandler } from "./sky/client.ts";

export interface SkyCaller {
  callSky(method: string, args: Record<string, unknown>, turn: TurnIdentity, signal?: AbortSignal, approve?: SkyApprovalHandler): Promise<SkyResult>;
}
export function skyText(result: SkyResult): string {
  if (result.isError) throw new Error("Sky reported an error; check app approval, permissions, screen lock and runtime compatibility.");
  if (!Array.isArray(result.content)) throw new Error("Sky did not return content.");
  const text = result.content.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.type === "text" ? item.text : "").join("\n");
  if (!text.trim()) throw new Error("Sky did not return AX text.");
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("AX text exceeds 1 MiB; use a smaller window.");
  // With native runtimes that omit disableDiff, never assume a partial update is a full tree.
  if (!parseAX(text).some((element) => element.role === "standard window")) {
    throw new Error("Sky did not return a recognizable full AX window tree; no decision or action is safe. Partial updates are not supported.");
  }
  return text;
}
export function createSkyDriver(client: SkyCaller, turn: TurnIdentity, signal?: AbortSignal, approve?: SkyApprovalHandler): Driver {
  let app: string | undefined;
  const call = async (method: string, args: Record<string, unknown>) => {
    signal?.throwIfAborted();
    if (!app) throw new Error("Bind an app before using Sky.");
    const result = await client.callSky(method, { app, ...args }, turn, signal, approve);
    if (result.isError) throw new Error("Sky action failed; do not replay it without fresh observation.");
    return result;
  };
  return {
    async bind(name) { signal?.throwIfAborted(); app = name; },
    async observe() { return skyText(await call("get_app_state", { disableDiff: true })); },
    async click(index) { return call("click", { element_index: index }); },
    async setValue(index, value) { return call("set_value", { element_index: index, value }); },
    async typeText(text) { return call("type_text", { text }); },
    async pressKey(key) {
      const canonical: Record<string, string> = { tab: "Tab", "shift+tab": "Shift_L+Tab", escape: "Escape", left: "Left", right: "Right", up: "Up", down: "Down", home: "Home", end: "End", pageup: "Page_Up", pagedown: "Page_Down" };
      return call("press_key", { key: canonical[key.toLowerCase()] ?? key });
    },
    async scroll(index, direction, pages) { return call("scroll", { element_index: index, direction, pages }); },
  };
}
