// Adapted from Sac-Y/Jev-cu scripts/loop.mjs. See NOTICE.md.
import type { AXElement, Candidate } from "./types.ts";

const ROLES = [
  "standard window", "split group", "scroll area", "HTML content", "content list",
  "menu bar main-menu-bar", "menu bar", "toolbar", "radio button", "close button",
  "minimize button", "full screen button", "search text field", "search field", "text field", "text area",
  "pop up button", "toggle button", "stepper", "combo box", "menu item", "button",
  "checkbox", "heading", "image", "link", "text", "grid", "list", "date time area", "row", "tab", "container", "Event",
].sort((a, b) => b.length - a.length);
const ALIASES: Record<string, string> = {
  "search text field": "search field",
  标准窗口: "standard window", 分离组: "split group", 滚动区: "scroll area", 文本: "text", 按钮: "button",
  文本栏: "text field", 文本区域: "text area", 搜索栏: "search field", 复选框: "checkbox", 单选按钮: "radio button",
};
const CLICKABLE = new Set([
  "button", "radio button", "close button", "minimize button", "full screen button", "link", "menu item",
  "text field", "text area", "search field", "checkbox", "pop up button", "toggle button", "stepper", "combo box", "tab", "list", "date time area", "scroll area",
]);

export function parseAX(ax: string): AXElement[] {
  const elements: AXElement[] = [];
  const seen = new Set<number>();
  for (const raw of ax.split(/\r?\n/)) {
    const match = raw.match(/^(\s*)(\d+)\s+(.*)$/);
    if (!match) continue;
    const index = Number(match[2]);
    if (!Number.isSafeInteger(index) || seen.has(index)) throw new Error("AX contains invalid or duplicate element indexes; request a full tree.");
    seen.add(index);
    const rest = match[3]!.trim();
    const sourceRole = ROLES.find((role) => rest === role || rest.startsWith(role + " ")) ?? rest.split(" ")[0]!;
    elements.push({ index, role: ALIASES[sourceRole] ?? sourceRole,
      label: rest.slice(sourceRole.length).trim().replace(/,?\s*Secondary Actions:.*$/i, "").trim(),
      depth: match[1]!.replace(/\t/g, "    ").length, raw });
  }
  return elements;
}

export function selectCandidates(elements: readonly AXElement[], goal = "", max = 40): { candidates: Candidate[]; total: number; clipped: boolean } {
  if (!Number.isInteger(max) || max < 1 || max > 200) throw new Error("candidateMax must be an integer in [1, 200].");
  const tokens = goal.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((token) => token.length >= 2);
  const scored: Candidate[] = [];
  for (const element of elements) {
    const states = new Set((element.label.match(/^\(([^)]*)\)/)?.[1] ?? "").split(",").map((state) => state.trim().toLowerCase()));
    const selectableRow = element.role === "row" && (states.has("selectable") || states.has("selected"));
    if ((!CLICKABLE.has(element.role) && !selectableRow) || states.has("disabled") || /\(disabled\)/i.test(element.raw)) continue;
    let score = selectableRow ? 2 : 0;
    if (["button", "toggle button", "radio button", "menu item", "pop up button", "combo box"].includes(element.role)) score += 3;
    if (["text field", "text area", "search field"].includes(element.role)) score += 2;
    if (element.role === "link") score += 1;
    const label = element.label.toLowerCase();
    for (const token of tokens) if (label.includes(token)) score += 4;
    if (!label || /^javascript:;?$/.test(label)) score -= 4;
    if (/previous month|next month|today|搜索|search/i.test(label) && /month|搜索|search/i.test(goal)) score += 6;
    if (element.role === "toggle button" && /toolbar|tool\b/i.test(goal)) score += 5;
    scored.push({ ...element, score });
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return { candidates: scored.slice(0, max), total: scored.length, clipped: scored.length > max };
}

export function buildContext(ax: string): string {
  const lines = ax.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return [...lines.slice(0, 2), ...parseAX(ax).filter((e) => e.role === "text").slice(0, 6).map((e) => e.raw.trim()),
    lines.find((line) => /focused UI element/i.test(line))].filter(Boolean).join("\n").slice(0, 1500);
}

export function focusedIndex(ax: string): number | null {
  const match = ax.match(/focused UI element is\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}
