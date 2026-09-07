import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import express from "express";
import { sourceSchema } from "../src/shared/contracts.js";
import { pages, testConnection, request } from "../src/server/connectors.js";
import { Store } from "../src/server/store.js";
import { Imports } from "../src/server/imports.js";
const source = () =>
  sourceSchema.parse({
    id: "test",
    name: "Test",
    kind: "jira",
    baseUrl: "http://localhost",
    transport: "stdio",
    command: process.execPath,
    args: [resolve("tests/fixtures/mcp.mjs")],
    projects: ["TEST"],
    mappings: {
      issues: { tool: "read_issues", arguments: {}, verifiedReadOnly: true },
    },
  });
test("MCP stdio discovers capabilities and only calls mapped read tool", async () => {
  const s = source(),
    signal = AbortSignal.timeout(5000);
  const result = await testConnection(s, signal);
  assert.equal(result.status, "ready");
  assert.ok(result.tools.some((t) => t.name === "delete_issue"));
  const results = [];
  for await (const p of pages(s, 0, signal)) results.push(p);
  assert.equal(results.length, 1);
  assert.equal(results[0].complete, true);
});
test("mapping requires explicit read-only confirmation", () => {
  const s = source();
  assert.throws(() =>
    sourceSchema.parse({
      ...s,
      mappings: { issues: { tool: "delete_issue", verifiedReadOnly: false } },
    }),
  );
});
test("REST errors are redacted and off-origin requests never execute", async () => {
  const app = express();
  app.get("/rest/api/2/serverInfo", (_req, res) =>
    res.status(403).send("secret"),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port,
    s = sourceSchema.parse({
      ...source(),
      transport: "rest",
      baseUrl: `http://127.0.0.1:${port}`,
    });
  try {
    await assert.rejects(
      () => testConnection(s, AbortSignal.timeout(5000)),
      /denied access/,
    );
    await assert.rejects(
      () => request(s, "https://other.example/path", AbortSignal.timeout(1000)),
      /Off-origin/,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("background import persists and completes against normalized MCP fixture", async () => {
  const store = new Store(":memory:");
  store.saveConfig({ ...store.config(), sources: [source()] });
  const worker = new Imports(store),
    job = worker.start(["test"], "backfill");
  for (let i = 0; i < 100; i++) {
    if (!["queued", "running"].includes(store.job(job.id)!.status)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(store.job(job.id)?.status, "complete");
  assert.equal(store.job(job.id)?.pages, 1);
  store.close();
});

test("missing corporate CA fails explicitly without exposing local paths", async () => {
  const s = sourceSchema.parse({
    ...source(),
    caBundleRef: "AP_TEST_MISSING_CA",
  });
  delete process.env.AP_TEST_MISSING_CA;
  await assert.rejects(
    () => testConnection(s, AbortSignal.timeout(1000)),
    /Corporate CA environment variable is not set/,
  );
});
