import { readFileSync, writeFileSync } from "node:fs";
import { createBatch, recordResult, report } from "./benchmark-core.ts";

const read = (path: string) => {
  const data = readFileSync(path);
  if (data.length > 8 * 1024 * 1024) throw new Error("Input exceeds 8 MiB.");
  return JSON.parse(data.toString("utf8")) as unknown;
};
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "init" && args.length === 2) {
    write(args[1]!, createBatch(read(args[0]!)));
  } else if (command === "record" && args.length === 4) {
    write(args[3]!, recordResult(read(args[0]!), args[1]!, read(args[2]!)));
  } else if (command === "report" && args.length === 1) {
    console.log(JSON.stringify(report(read(args[0]!)), null, 2));
  } else {
    throw new Error("Usage: benchmark init <config.json> <new-batch.json> | record <batch.json> <slot-id> <result.json> <new-batch.json> | report <batch.json>");
  }
} catch (error) {
  console.error(error instanceof SyntaxError ? "Invalid JSON input." : error instanceof Error ? error.message : "Benchmark failed.");
  process.exitCode = 1;
}
