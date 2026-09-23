import test from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { requestApproval } from "../src/mcp/approval.ts";

type Client = Parameters<typeof requestApproval>[0];
const signal = () => new AbortController().signal;
const capabilities = () => ({ elicitation: { form: {} } });

test("Accept alone approves the displayed request with an empty form", async () => {
  const client: Client = { getClientCapabilities: capabilities, elicitInput: async (params, options) => {
    assert.deepEqual(params, { mode: "form", message: "This specific task\n\nChoose Accept to approve this specific request, or Decline/Cancel to stop. No checkbox is required.", requestedSchema: { type: "object", properties: {} } });
    assert.equal(options?.timeout, 180_000); assert.ok(options?.signal);
    return { action: "accept" };
  } };
  assert.deepEqual(await requestApproval(client, "This specific task", signal()), { outcome: "accepted" });
});

test("unsupported clients fail closed without sending a request", async () => {
  for (const capability of [undefined, {}, { elicitation: { url: {} } }]) {
    const client: Client = { getClientCapabilities: () => capability, elicitInput: async () => { throw new Error("Must not be called"); } };
    assert.deepEqual(await requestApproval(client, "task", signal()), { outcome: "unsupported" });
  }
});

test("abort before request and abort racing Accept never grant approval", async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const client: Client = { getClientCapabilities: capabilities, elicitInput: async () => { calls++; return { action: "accept" }; } };
  assert.deepEqual(await requestApproval(client, "task", controller.signal), { outcome: "request_cancelled" });
  assert.equal(calls, 0);
  const race = new AbortController();
  client.elicitInput = async () => { race.abort(); return { action: "accept" }; };
  assert.deepEqual(await requestApproval(client, "task", race.signal), { outcome: "request_cancelled" });
});

test("timeouts and protocol errors remain distinct and private error text is not exposed", async () => {
  for (const [error, expected] of [
    [new McpError(ErrorCode.RequestTimeout, "secret"), { outcome: "timed_out", errorCode: ErrorCode.RequestTimeout }],
    [new McpError(ErrorCode.InvalidParams, "secret"), { outcome: "request_failed", errorCode: ErrorCode.InvalidParams }],
    [new Error("secret"), { outcome: "request_failed" }],
  ] as const) {
    const client: Client = { getClientCapabilities: capabilities, elicitInput: async () => { throw error; } };
    const result = await requestApproval(client, "private task", signal());
    assert.deepEqual(result, expected); assert.ok(!JSON.stringify(result).includes("secret"));
  }
});
