import { closeSync, constants, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export type TraceMode = "metadata" | "full";
// Metadata mode never accepts AX, input text, arbitrary errors or credentials.
export interface TraceEvent {
  event: "start" | "decision" | "action" | "finish";
  step?: number;
  action?: string | null;
  index?: number | null;
  confidence?: number | null;
  risk?: number | null;
  done?: number | null;
  latencyMs?: number;
  status?: string;
  reason?: string;
  changed?: boolean;
  elapsedMs?: number;
  candidateCount?: number;
}
export interface FullTraceEvent {
  event: "task" | "snapshot" | "decision_input" | "decision_output" | "jev" | "action_prepared" | "gate"
    | "dispatch_start" | "dispatch_return" | "verification" | "failure" | "outcome";
  step?: number;
  [key: string]: unknown;
}
export interface TraceOptions {
  mode?: TraceMode;
  secrets?: readonly string[];
  maxBytes?: number;
}

export function createTrace(directory?: string, options: TraceOptions = {}) {
  const mode = options.mode ?? "metadata";
  if (mode === "full" && !directory) throw new Error("Full tracing requires an explicit local directory.");
  const runId = randomUUID();
  let path: string | undefined;
  let fd: number | undefined;
  if (directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (mode === "full") {
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) {
        throw new Error("Full trace directory must be an owner-only directory (700), not a symlink.");
      }
    }
    path = join(directory, `${runId}.jsonl`);
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  }
  let sequence = 0;
  let bytes = 0;
  let failed = false;
  const started = performance.now();
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  // Redact the credential after JSON serialization too (including escaped forms).
  // Do not serialize process.env, provider headers or the JevOptions object.
  const secrets = [...new Set((options.secrets ?? []).filter(Boolean).map((secret) => JSON.stringify(secret).slice(1, -1)))].sort((a, b) => b.length - a.length);
  function append(event: TraceEvent | FullTraceEvent) {
    if (fd === undefined) return;
    if (failed) throw new Error("Trace is incomplete; no further desktop actions may be dispatched.");
    try {
      let line = JSON.stringify({ ...event, schemaVersion: 1, runId, mode, seq: ++sequence,
        ts: new Date().toISOString(), sinceStartMs: Math.round(performance.now() - started) });
      for (const secret of secrets) line = line.replaceAll(secret, "[REDACTED]");
      const buffer = Buffer.from(line + "\n");
      if (bytes + buffer.length > maxBytes) throw new Error("Trace exceeded its 64 MiB budget; task stopped instead of silently dropping events.");
      let written = 0;
      while (written < buffer.length) {
        const count = writeSync(fd, buffer, written, buffer.length - written);
        if (count === 0) throw new Error("Trace write made no progress.");
        written += count;
      }
      bytes += buffer.length;
    } catch (error) { failed = true; throw error; }
  }
  return {
    path,
    get incomplete() { return failed; },
    record(event: TraceEvent) { append(event); },
    full(event: FullTraceEvent) { if (mode === "full") append(event); },
    close() {
      if (fd !== undefined) {
        const previous = fd; fd = undefined;
        try { closeSync(previous); } catch { failed = true; }
      }
    },
  };
}
