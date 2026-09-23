import { readFileSync } from "node:fs";

// Same relative path in src/mcp and dist/mcp; no separately maintained runtime version.
export const currentVersion: string = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
const registryUrl = "https://registry.npmjs.org/jev-codex-cua/latest";
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function versionStatus() {
  return {
    currentVersion,
    latestVersion: null as string | null,
    updateCheck: "not-checked",
    distribution: process.env.DESKHAND_DISTRIBUTION === "claude-plugin" ? "claude-plugin" : "standalone",
    upgradeMethod: "在 Claude Code /plugin 中更新 deskhand@deskhand（先刷新 deskhand marketplace），然后重启 Claude Code；MCP 与 Skill 一起更新。手动安装用户先迁移到 Plugin，勿同时启用两个 MCP 实例。",
  };
}

/** Explicit opt-in only. No config, permission, package or skill writes. */
export async function checkVersion(signal?: AbortSignal, request: typeof fetch = fetch) {
  const status = versionStatus();
  try {
    const timeout = AbortSignal.timeout(5_000);
    const response = await request(registryUrl, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Registry unavailable");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("name" in data) || data.name !== "jev-codex-cua"
      || !("version" in data) || typeof data.version !== "string" || !stableVersion.test(data.version)) throw new Error("Invalid registry version");
    const latest = data.version.split(".").map(BigInt);
    const current = currentVersion.split(".").map(BigInt);
    const difference = latest.findIndex((part, i) => part !== current[i]);
    return { ...status, latestVersion: data.version, updateCheck: "checked", source: registryUrl,
      updateAvailable: difference !== -1 && latest[difference]! > current[difference]! };
  } catch {
    // Never expose network/proxy errors (which can contain credentials), or guess latest.
    return { ...status, updateCheck: "unavailable", source: registryUrl,
      message: "无法检查最新版本（网络失败、取消或响应无效）；当前安装未改变，可稍后重试。" };
  }
}
