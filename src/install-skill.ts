import { mkdir, readFile, writeFile, rm, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const destination = join(homedir(), ".codex", "skills", "deskhand");
const marker = join(destination, ".deskhand-install.json");
let existing = false;
try {
  const stat = await lstat(destination);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Refusing to replace an existing non-directory or symlink.");
  existing = true;
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
if (process.argv.includes("--uninstall")) {
  if (existing) {
    const installed: unknown = JSON.parse(await readFile(marker, "utf8"));
    if (!installed || typeof installed !== "object" || !("repo" in installed) || installed.repo !== repo) throw new Error("Refusing to uninstall a skill not owned by this checkout.");
    await rm(destination, { recursive: true });
  }
  console.log(`已卸载（如存在）：${destination}`);
} else {
  if (existing) throw new Error("Skill already exists. Inspect it and uninstall explicitly before reinstalling; no files were overwritten.");
  const template = await readFile(join(repo, "skill", "deskhand", "SKILL.md"), "utf8");
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination);
  try {
    await writeFile(join(destination, "SKILL.md"), template.replaceAll("{{REPO_DIR}}", repo.replace(/\/$/, "")), { flag: "wx" });
    await writeFile(marker, JSON.stringify({ repo }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    await rm(destination, { recursive: true });
    throw error;
  }
  console.log(`已安装：${destination}；新 Codex 会话生效。`);
}
