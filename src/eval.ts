import { readFile } from "node:fs/promises";
import { buildContext, parseAX, selectCandidates } from "./ax.ts";
import { createJevDecider } from "./jev.ts";

if (!process.argv.includes("--live")) {
  console.error("Online evaluation sends synthetic fixtures to TypeSafe and may incur API charges. Run npm run eval -- --live with TYPESAFE_API_KEY to opt in.");
  process.exitCode = 1;
} else {
  const cases: unknown = JSON.parse(await readFile(new URL("../fixtures/cases.json", import.meta.url), "utf8"));
  if (!Array.isArray(cases)) throw new Error("Expected fixture array.");
  const decide = createJevDecider({ maxRetries: 0 });
  let correct = 0;
  for (const fixture of cases) {
    if (!fixture || typeof fixture !== "object" || typeof fixture.ax !== "string" || typeof fixture.goal !== "string" || typeof fixture.app !== "string") throw new Error("Invalid fixture.");
    const { candidates } = selectCandidates(parseAX(fixture.ax), fixture.goal);
    const decision = await decide({ goal: fixture.goal, app: fixture.app, candidates, context: buildContext(fixture.ax), recentActions: [], constraints: "" });
    const passed = decision.targetIndex === fixture.expectedIndex && decision.action === fixture.expectedAction;
    if (passed) correct++;
    console.log(JSON.stringify({ name: fixture.name, passed, decision }));
  }
  console.log(JSON.stringify({ correct, total: cases.length, note: "Candidate selection evaluation only; not end-to-end task success." }));
  if (correct !== cases.length) process.exitCode = 1;
}
