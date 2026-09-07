import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { Store } from "../src/server/store.js";
import { createApp } from "../src/server/app.js";
test("browser setup, demo analysis, evidence, saved reports and responsive panes", async () => {
  const store = new Store(":memory:"),
    { app, launch } = createApp(store),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/launch?token=${launch}`);
    await page.getByRole("button", { name: "Load synthetic example" }).click();
    await page
      .getByText("Synthetic example loaded.", { exact: false })
      .waitFor();
    await page.locator("#anchor").fill("2026-09-07");
    await page.getByRole("button", { name: "Run & save analysis" }).click();
    await page.getByRole("heading", { name: "Top 10 Epics" }).waitFor();
    assert.equal(await page.locator(".ap-rankings").count(), 1);
    assert.equal(await page.locator(".ap-rankings tbody tr").count(), 20);
    await page.locator('[data-metric="cycle"]').click();
    await page.locator("#evidence:not([hidden])").waitFor();
    await page
      .getByRole("button", { name: "Saved reports", exact: true })
      .click();
    await page.locator("[data-report]").first().click();
    await page
      .getByRole("button", { name: "Connections & data", exact: true })
      .click();
    await page
      .getByRole("button", { name: "New connection", exact: true })
      .click();
    await page.locator("#source-id").fill("test-jira");
    await page.locator("#source-name").fill("Test Jira");
    await page.locator("#source-url").fill("https://jira.example.com");
    await page.locator("#mcp-url").fill("https://mcp.example.com/mcp");
    await page
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Test Jira", exact: true })
      .waitFor();
    const response = await page.request.get(
      `http://127.0.0.1:${port}/api/v1/mcp-template`,
    );
    const generated = await response.json();
    assert.deepEqual(
      generated.sources.map((s: { kind: string }) => s.kind),
      ["jira", "bitbucket"],
    );
    const profile = {
      ...generated.sources[0],
      id: "fixture",
      name: "Fixture MCP",
      transport: "stdio",
      command: process.execPath,
      args: [resolve("tests/fixtures/mcp.mjs")],
      credentialRef: undefined,
      mappings: {
        issues: { tool: "read_issues", arguments: {}, verifiedReadOnly: true },
      },
    };
    await page.locator("#mcp-file").setInputFiles({
      name: "mcp.local.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ sources: [profile] })),
    });
    await page
      .getByRole("button", { name: "Fixture MCP", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save & test connection", exact: true })
      .click();
    await page
      .locator("#connection-result")
      .filter({ hasText: '"ready"' })
      .waitFor();
    assert.match(
      await page.locator("#connection-result").innerText(),
      /read_issues/,
    );
    await page.locator("#command").fill("/nonexistent/mcp-command");
    await page
      .getByRole("button", { name: "Save & test connection", exact: true })
      .click();
    await page
      .locator("#connection-result")
      .filter({ hasText: "MCP connection failed" })
      .waitFor();
    assert.deepEqual(
      await (
        await page.request.get(`http://127.0.0.1:${port}/api/v1/mcp-template`)
      ).json(),
      generated,
    );
    for (const width of [360, 736, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("button", { name: "Analysis", exact: true }).click();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        `overflow at ${width}`,
      );
    }
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: "/private/tmp/ai-productivity-browser.png",
      fullPage: true,
    });
  } finally {
    await browser?.close();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});
