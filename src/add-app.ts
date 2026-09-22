import { addAppGrant } from "./app-grants.ts";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log('Usage: node --experimental-strip-types src/add-app.ts "Exact App Name"\nOnly adds one app to the separate local grant file. Does not read credentials or change official permissions.');
} else if (args.length !== 1) {
  console.error("Provide exactly one application name. No remove, replace, bulk or wildcard mode is supported.");
  process.exitCode = 1;
} else {
  try { console.log(JSON.stringify(addAppGrant(args[0]!))); }
  catch (error) {
    console.error(error instanceof Error ? error.message : "App grant failed; no credential file was accessed.");
    process.exitCode = 1;
  }
}
