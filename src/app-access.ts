import { configuredAccessPath, readAppAccessGrant, setAppAccessGrant, validateAppAccess } from "./app-access-grants.ts";

const args = process.argv.slice(2);
const usage = "Usage: node dist/app-access.js status | <all|allowlist> --expected-file <absolute path from cua_status>\nOnly manages the separate plugin access file. Never reads credentials or changes macOS/Sky permissions.";
try {
  if (args.length === 1 && args[0] === "--help") {
    console.log(usage);
  } else if (args.length === 1 && args[0] === "status") {
    const file = configuredAccessPath();
    console.log(JSON.stringify({ file, storedAppAccess: readAppAccessGrant(file) ?? null }));
  } else {
    if (args.length !== 3 || args[1] !== "--expected-file") throw new Error(usage);
    const appAccess = validateAppAccess(args[0]);
    const file = configuredAccessPath();
    if (args[2] !== file) throw new Error("App access target does not match the current plugin. Stop and check the loaded installation/configuration; do not redirect or change environment variables.");
    console.log(JSON.stringify(setAppAccessGrant(appAccess, file)));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "App access update failed; no credential file was accessed.");
  process.exitCode = 1;
}
