#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNativeMcpServer } from "./server.ts";

if (process.argv.length > 2) {
  console.error("Usage: deskhand-mcp (stdio native-only MCP server; configure via DESKHAND_CONFIG_FILE)");
  process.exitCode = process.argv.includes("--help") ? 0 : 1;
} else {
  const { server, session } = createNativeMcpServer();
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    session.close();
    void server.close().catch(() => { process.exitCode = 1; });
  };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  // SDK stdio transport does not translate input EOF into onclose.
  // Closing the server also rejects pending elicitation requests.
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.stdin.once("error", shutdown);
  try { await server.connect(new StdioServerTransport()); }
  catch { session.close(); console.error("Unable to start native MCP stdio transport."); process.exitCode = 1; }
}
