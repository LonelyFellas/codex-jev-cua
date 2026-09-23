#!/usr/bin/env node
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

try {
  if (process.argv.length !== 3 || process.argv[2] !== "--install") throw new Error("Usage: deskhand-install-claude-skill --install (writes only the deskhand-access user Skill; no permissions or MCP config changes)");
  const root = resolve(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"));
  const directory = join(root, "skills", "deskhand-access");
  const content = readFileSync(new URL("../../claude-skills/deskhand-access/SKILL.md", import.meta.url), "utf8");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) throw new Error("Unsafe existing Skill directory; no overwrite.");
  const path = join(directory, "SKILL.md");
  let installed = false;
  try {
    const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, content); installed = true; } finally { closeSync(fd); }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 32_768 || (process.getuid && stat.uid !== process.getuid()) || readFileSync(fd, "utf8") !== content) throw new Error("Existing Skill differs; refusing to overwrite. Review it manually before upgrading.");
    } finally { closeSync(fd); }
  }
  console.log(JSON.stringify({ installed, path, instruction: "In Claude Code invoke /deskhand-access. Restart Claude if the new skills directory is not detected. No app permissions were changed." }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Skill installation failed."); process.exitCode = 1;
}
