// Adapted from Sac-Y/Jev-cu scripts/policy.mjs. See NOTICE.md.
import { focusedIndex } from "./ax.ts";
import { ACTIONS } from "./types.ts";
import type { AXElement, Decision, Gate, PreparedAction, Resources, Point } from "./types.ts";

export const DEFAULT_ALLOWED_APPS = ["Calendar", "Calculator", "TextEdit", "NetEaseMusic", "Figma", "Google Chrome", "Codex In-app Browser"] as const;
const SENSITIVE: [string, RegExp][] = [
  ["delete", /删除|移除|清空|\b(delete|remove|erase|clear all)\b/i],
  ["send", /发送|提交|发布|回复|\b(send|submit|post|publish|reply)\b/i],
  ["payment", /支付|付款|购买|下单|充值|订阅|开通|\b(pay|purchase|buy|subscribe|checkout)\b/i],
  ["auth", /授权|权限|登录|密码|验证码|\b(authorize|permission|sign in|log ?in|password|captcha|credential)\b/i],
  ["share", /上传|分享|导出|\b(upload|share|export)\b/i],
  ["install", /安装|\binstall\b/i],
  ["settings", /系统设置|偏好设置|安全设置|system settings|security settings/i],
];
export function matchSensitive(label: string): string | null {
  return SENSITIVE.find(([, pattern]) => pattern.test(label))?.[0] ?? null;
}
export function validDecision(d: Decision): boolean {
  return ACTIONS.includes(d.action!) && [d.confidence, d.risk, d.done].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)
    && (d.targetIndex === null || (Number.isSafeInteger(d.targetIndex) && d.targetIndex >= 0));
}
function point(value: Point | undefined): Point {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => Number.isFinite(n) && n >= 0)) throw new Error("Explicit nonnegative planner coordinates required.");
  return [value[0]!, value[1]!];
}
export function prepareAction(decision: Decision, resources: Resources): PreparedAction {
  const kind = decision.action;
  if (kind === "wait" || kind === "ask_user") return { kind };
  if (kind === "click_at") return { kind, at: point(resources.at) };
  if (kind === "drag") return { kind, from: point(resources.from), to: point(resources.to) };
  if (resources.at !== undefined || resources.from !== undefined || resources.to !== undefined) throw new Error("Coordinates cannot override an element action.");
  const index = decision.targetIndex;
  if (index === null || !Number.isSafeInteger(index) || index < 0) throw new Error("Action requires a current candidate index.");
  switch (kind) {
    case "click_element": return { kind, index };
    case "set_value": case "type_text":
      if (typeof resources.text !== "string" || resources.text.length > 10_000 || (kind === "type_text" && !resources.text.length)) throw new Error("Action requires explicit text (at most 10000 characters).");
      return { kind, index, text: resources.text };
    case "press_key":
      if (typeof resources.key !== "string" || !resources.key.trim() || resources.key.length > 100) throw new Error("Action requires an explicit key; no default Return.");
      return { kind, index, key: resources.key };
    case "scroll":
      if (!["up", "down", "left", "right"].includes(resources.direction ?? "")) throw new Error("Action requires an explicit scroll direction.");
      return { kind, index, direction: resources.direction! };
    default: throw new Error("Unknown action.");
  }
}
export function evaluatePolicy(input: {
  decision: Decision; app: string; allowedApps: readonly string[]; target?: AXElement;
  action?: PreparedAction; observation: string;
}): Gate {
  const { decision, app, allowedApps, target, action, observation } = input;
  if (!allowedApps.includes(app)) return { verdict: "stop", reason: "app_not_allowed" };
  if (!validDecision(decision)) return { verdict: "escalate", reason: "invalid_decision" };
  if (decision.targetIndex !== null && target?.index !== decision.targetIndex) return { verdict: "escalate", reason: "unknown_target" };
  if (decision.done! >= 0.9) return { verdict: "model_done", reason: "model_claimed_completion" };
  if (decision.action === "ask_user") return { verdict: "confirm", reason: "model_requested_user" };
  const sensitive = matchSensitive(target?.label ?? "");
  if (sensitive) return { verdict: "confirm", reason: `sensitive_${sensitive}` };
  if (decision.risk! >= 0.2) return { verdict: "confirm", reason: "model_risk" };
  if (decision.confidence! < 0.3) return { verdict: "stop", reason: "low_confidence" };
  // Jev-cu uses 0.40 for Calculator. Restore that behavior for button clicks only,
  // after all risk/sensitive-target gates; do not relax other apps or input actions.
  const minConfidence = app === "Calculator" && action?.kind === "click_element" && target?.role === "button" ? 0.4 : 0.5;
  if (decision.confidence! < minConfidence) return { verdict: "escalate", reason: "uncertain_target" };
  if (!action) return { verdict: "escalate", reason: "missing_action" };
  if (action.kind === "click_at" || action.kind === "drag") return { verdict: "confirm", reason: "coordinates_require_handoff" };
  if ("index" in action && target?.index !== action.index) return { verdict: "escalate", reason: "action_target_mismatch" };
  if (action.kind === "set_value" || action.kind === "type_text") {
    if (!target || !["text field", "search field", "text area", "combo box"].includes(target.role)) return { verdict: "escalate", reason: "target_not_editable" };
    if (/[\u0000-\u001f\u007f]/.test(action.text)) return { verdict: "confirm", reason: "control_characters_require_handoff" };
  }
  if ((action.kind === "type_text" || action.kind === "press_key") && focusedIndex(observation) !== action.index) return { verdict: "escalate", reason: "focus_not_target" };
  if (action.kind === "press_key" && !/^(Tab|Shift\+Tab|Escape|Left|Right|Up|Down|Home|End|PageUp|PageDown)$/i.test(action.key)) return { verdict: "confirm", reason: "key_requires_handoff" };
  return { verdict: "proceed", reason: "policy_passed" };
}
