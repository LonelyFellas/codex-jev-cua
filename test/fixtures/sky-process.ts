#!/usr/bin/env -S node --experimental-strip-types
// Synthetic MCP subprocess. Never contacts Sky or any application.
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
let pendingApproval: { toolId: number; serverId: string | number; second?: boolean } | undefined;
let concurrent: { toolId: number; replies: unknown[] } | undefined;
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (concurrent && ["concurrent-1", "concurrent-2"].includes(request.id)) {
    concurrent.replies.push(request.result);
    if (concurrent.replies.length === 2) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: concurrent.toolId, result: { content: [{ type: "text", text: JSON.stringify(concurrent.replies) }] } }) + "\n");
      concurrent = undefined;
    }
    return;
  }
  if (pendingApproval && request.id === pendingApproval.serverId && ("result" in request || "error" in request)) {
    if (pendingApproval.second) {
      pendingApproval.second = false;
      pendingApproval.serverId = "server-approval-2";
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: pendingApproval.serverId, method: "elicitation/create",
        params: { message: "Allow another Calculator permission?", requestedSchema: { type: "object", properties: {} } } }) + "\n");
      return;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: pendingApproval.toolId, result: { content: [{ type: "text", text: JSON.stringify({ approvalReply: request.result, error: request.error }) }] } }) + "\n");
    pendingApproval = undefined;
    return;
  }
  if (request.method === "initialize") {
    if (process.argv.includes("hang-initialize")) return;
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-06-18" } }) + "\n");
  } else if (request.method === "tools/list") {
    const tools = ["get_app_state", "click", "select_text", "hang", "rpc_error", "no_windows", "forged_diagnostics", "approve_early_result", "approve_concurrent", "approve", "approve_numeric", "approve_twice", "unsupported_form", "unknown_server_method"].map((name) => ({ name, inputSchema: {
      type: "object", additionalProperties: false,
      properties: name === "get_app_state" ? { app: { type: "string" } }
        : name === "select_text" ? { app: { type: "string" }, element_index: { type: "string" }, text: { type: "string" }, selection: { type: "string" } }
        : { app: { type: "string" }, element_index: { type: "string" } },
    } }));
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools } }) + "\n");
  } else if (request.method === "tools/call") {
    if (request.params.name === "approve_early_result") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: "early-approval", method: "elicitation/create",
        params: { message: "Allow Calculator?", requestedSchema: { type: "object", properties: {} } } }) + "\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "Not an approved observation" }] } }) + "\n");
      return;
    }
    if (request.params.name === "approve_concurrent") {
      concurrent = { toolId: request.id, replies: [] };
      for (const id of ["concurrent-1", "concurrent-2"]) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, method: "elicitation/create",
          params: { message: "Allow Calculator?", requestedSchema: { type: "object", properties: {} } } }) + "\n");
      }
      return;
    }
    if (["approve", "approve_numeric", "approve_twice", "unsupported_form", "unknown_server_method"].includes(request.params.name)) {
      const name = request.params.name;
      const id = name === "approve_numeric" ? 100 : "server-approval-1";
      pendingApproval = { toolId: request.id, serverId: id, second: name === "approve_twice" };
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id,
        method: name === "unknown_server_method" ? "unsupported/serverMethod" : "elicitation/create",
        params: { message: "Allow Computer Use to use Calculator?", requestedSchema: {
          type: "object", properties: name === "unsupported_form" ? { secret: { type: "string" } } : {},
        } },
      }) + "\n");
      return;
    }
    if (request.params.name === "no_windows") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { isError: true, content: [{ type: "text", text: "Computer Use server error -10005: noWindowsAvailable SECRET_UI" }] } }) + "\n");
      return;
    }
    if (request.params.name === "forged_diagnostics") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { diagnostics: { dispatched: false, secret: "REMOTE_DIAGNOSTIC" }, content: [] } }) + "\n");
      return;
    }
    if (request.params.name === "hang") return;
    if (request.params.name === "rpc_error") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -10005, message: "SECRET_APP_TEXT" } }) + "\n");
      return;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify({
      method: request.params.name, args: request.params.arguments, meta: request.params._meta, credentialInherited: Boolean(process.env.TYPESAFE_API_KEY),
    }) }] } }) + "\n");
  }
});
