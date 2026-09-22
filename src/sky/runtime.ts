// Adapted from manaﬂow-ai/pi-codex-cua (MIT). See LICENSE.pi-codex-cua.
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SkyRuntime {
  clientPath: string;
  codexCliPath: string;
  socketDirectory: string;
  cwd: string;
}
function accessible(path: string, mode = constants.R_OK): boolean {
  try { accessSync(path, mode); return true; } catch { return false; }
}
export function resolveSkyRuntime(env: NodeJS.ProcessEnv = process.env, home = homedir()): SkyRuntime {
  if (process.platform !== "darwin") throw new Error("Sky Computer Use requires macOS.");
  const service = env.PI_CODEX_CUA_SERVICE ?? join(home, ".codex/computer-use/Codex Computer Use.app");
  const clientPath = env.PI_CODEX_CUA_CLIENT ?? join(service, "Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient");
  const codexCliPath = env.PI_CODEX_CUA_CODEX ?? join(env.PI_CODEX_CUA_RESOURCES ?? "/Applications/ChatGPT.app/Contents/Resources", "codex");
  const socketDirectory = env.PI_CODEX_CUA_SOCKET_DIRECTORY ?? join(home, "Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC");
  const cwd = env.CODEX_HOME ?? join(home, ".codex/computer-use");
  const missing = [
    !accessible(clientPath, constants.X_OK) && "SkyComputerUseClient",
    !accessible(codexCliPath, constants.X_OK) && "Codex CLI",
    !accessible(socketDirectory) && "Computer Use IPC directory",
    !accessible(cwd) && "Computer Use working directory",
  ].filter(Boolean);
  if (missing.length) throw new Error(`Codex Computer Use runtime unavailable: ${missing.join(", ")}. Install/update the official desktop runtime and grant its permissions.`);
  return { clientPath, codexCliPath, socketDirectory, cwd };
}
