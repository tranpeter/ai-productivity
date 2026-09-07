import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  defaultConfig,
  configSchema,
  sourceSchema,
  analysisSchema,
  recordSchema,
  type AnalysisInput,
} from "../src/shared/contracts.js";
import { resolvePeriods } from "../src/server/periods.js";
import { analyze, quantile, delta } from "../src/server/analysis.js";
import { Store } from "../src/server/store.js";
import { demo } from "../src/server/demo.js";
import { createApp, csvCell, template } from "../src/server/app.js";
const input: AnalysisInput = {
  configRevision: 0,
  preset: "qtd",
  anchor: "2026-09-07",
  comparison: "previous",
  sourceIds: ["demo-jira", "demo-bb"],
  projects: [],
  repositories: [],
  linkedOnly: false,
  excludeMixed: false,
};
test("QTD uses 68 local days across different quarter lengths", () => {
  const p = resolvePeriods(input, defaultConfig);
  assert.equal(p.current.days, 68);
  assert.equal(p.baseline?.days, 68);
  assert.equal(p.baseline?.endDate, "2026-06-07");
});
test("MoM and leap months use whole months", () => {
  const p = resolvePeriods(
    { ...input, preset: "mom", anchor: "2024-03-10" },
    defaultConfig,
  );
  assert.equal(p.current.days, 29);
  assert.equal(p.baseline?.days, 31);
});
test("DST uses calendar days rather than 24-hour division", () => {
  const p = resolvePeriods(
    { ...input, preset: "custom", start: "2026-03-07", end: "2026-03-09" },
    defaultConfig,
  );
  assert.equal(p.current.days, 3);
  assert.equal(
    (+new Date(p.current.end) - +new Date(p.current.start)) / 3600000,
    71,
  );
});
test("MTD caps both windows when previous month is shorter", () => {
  const p = resolvePeriods(
    { ...input, preset: "mtd", anchor: "2026-03-31" },
    defaultConfig,
  );
  assert.equal(p.current.days, 28);
  assert.equal(p.baseline?.days, 28);
});
test("Fiscal quarters cross year boundary", () => {
  const c = structuredClone(defaultConfig);
  c.reporting.fiscalStartMonth = 11;
  const p = resolvePeriods(
    { ...input, preset: "qoq", anchor: "2026-02-01" },
    c,
  );
  assert.equal(p.current.startDate, "2025-11-01");
  assert.equal(p.current.endDate, "2026-01-31");
});
test("schema rejects invalid dates, enums, URLs with credentials, duplicate source IDs", () => {
  assert.throws(() => analysisSchema.parse({ ...input, anchor: "2026-02-30" }));
  assert.throws(() =>
    sourceSchema.parse({
      id: "x",
      name: "x",
      kind: "jira",
      transport: "rest",
      baseUrl: "https://user:secret@example.com",
    }),
  );
  const d = demo();
  assert.throws(() =>
    configSchema.parse({
      ...d.config,
      sources: [d.config.sources[0], d.config.sources[0]],
    }),
  );
});
test("quantiles and zero-baseline changes", () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([1, 2, 3, 4], 0.75), 3.25);
  assert.deepEqual(delta(5, 0), { absolute: 5, relative: null });
  assert.equal(delta(8, 10).relative, -20);
});
test("SQLite replay is idempotent; reports survive correction", () => {
  const s = new Store(":memory:"),
    d = demo();
  s.upsert(d.records);
  s.upsert(d.records);
  assert.equal(s.records().length, d.records.length);
  const r = analyze(s.records(), d.config, { ...input, preset: "qoq" });
  s.saveReport(r);
  const changed = { ...d.records[0], title: "corrected" };
  s.upsert([changed]);
  assert.deepEqual(s.report(r.id), JSON.parse(JSON.stringify(r)));
  s.close();
});
test("page transaction rolls back all records after validation error", () => {
  const s = new Store(":memory:"),
    d = demo();
  assert.throws(() => s.upsert([d.records[0], { broken: true }]));
  assert.equal(s.records().length, 0);
  s.close();
});
test("configuration uses optimistic revisions", () => {
  const s = new Store(":memory:");
  s.saveConfig(defaultConfig);
  assert.throws(() => s.saveConfig(defaultConfig), /CONFIG_CONFLICT/);
  s.close();
});
test("file database persists and rejects future migrations", () => {
  const dir = mkdtempSync(join(tmpdir(), "ap-test-")),
    path = join(dir, "db.sqlite");
  let s = new Store(path);
  s.saveConfig(defaultConfig);
  s.close();
  s = new Store(path);
  assert.equal(s.config().revision, 1);
  s.close();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA user_version=999");
  db.close();
  assert.throws(() => new Store(path), /newer/);
  rmSync(dir, { recursive: true });
});
test("rankings deduplicate AI run IDs and require identity evidence", () => {
  const d = demo();
  const pr = d.records.find((r) => r.kind === "pr")!;
  if (pr.kind !== "pr") throw Error();
  const at = "2026-04-12T12:00:00Z";
  pr.reviews = [
    {
      id: "1",
      actor: "demo-ai-reviewer",
      type: "comment",
      at,
      aiRunId: "run-1",
      aiVerified: true,
    },
    {
      id: "2",
      actor: "demo-ai-reviewer",
      type: "comment",
      at,
      aiRunId: "run-1",
      aiVerified: true,
    },
    {
      id: "3",
      actor: "unknown-bot",
      type: "comment",
      at,
      aiRunId: "run-2",
      aiVerified: true,
    },
  ];
  const r = analyze([pr], d.config, {
    ...input,
    preset: "custom",
    start: "2026-04-01",
    end: "2026-04-30",
  });
  assert.equal(r.current.prs[0].runs, 1);
});
test("reopen cohort excludes incomplete followup", () => {
  const d = demo();
  for (const r of d.records) r.coverageThrough = "2026-04-30T00:00:00Z";
  const r = analyze(d.records, d.config, {
    ...input,
    preset: "custom",
    start: "2026-04-01",
    end: "2026-04-30",
  });
  const m = r.current.metrics.find((m) => m.id === "reopen")!;
  assert.equal(m.n, 0);
  assert.ok(m.immature! > 0);
});
test("missing start does not create zero cycle time or lose throughput", () => {
  const d = demo(),
    issue = d.records.find((r) => r.kind === "issue" && r.type !== "Epic")!;
  if (issue.kind !== "issue") throw Error();
  issue.history = issue.history.filter((h) => h.to === "Done");
  const r = analyze([issue], d.config, {
    ...input,
    preset: "custom",
    start: "2026-01-01",
    end: "2026-01-31",
  });
  assert.equal(r.current.metrics.find((m) => m.id === "throughput")?.value, 1);
  assert.equal(r.current.metrics.find((m) => m.id === "cycle")?.value, null);
});
test("CSV formula cells are escaped and templates have only references", () => {
  assert.equal(csvCell("=SUM(A1)"), `"'=SUM(A1)"`);
  assert.ok(JSON.stringify(template).includes("credentialRef"));
  assert.ok(!JSON.stringify(template).includes("Authorization"));
});
test("local API security, configuration template and report workflow", async () => {
  const s = new Store(":memory:"),
    { app, launch } = createApp(s),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + "/api/v1/config")).status, 401);
    const launched = await fetch(base + "/launch?token=" + launch, {
      redirect: "manual",
    });
    assert.equal(launched.status, 302);
    const cookie = launched.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await fetch(base + "/launch?token=" + launch)).status, 403);
    const session = (await (
      await fetch(base + "/api/v1/session", { headers: { cookie } })
    ).json()) as { csrf: string };
    const headers = {
      cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrf,
    };
    assert.equal(
      (
        await fetch(base + "/api/v1/demo", {
          method: "POST",
          headers: { cookie },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/v1/demo", {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.example" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/v1/demo", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      200,
    );
    const c = (await (
      await fetch(base + "/api/v1/config", { headers })
    ).json()) as { revision: number };
    const response = await fetch(base + "/api/v1/comparisons", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...input,
        configRevision: c.revision,
        preset: "qoq",
      }),
    });
    assert.equal(response.status, 201);
    const report = (await response.json()) as { id: string };
    assert.equal(
      (
        await fetch(
          base + "/api/v1/comparisons/" + report.id + "/export?format=csv",
          { headers },
        )
      ).status,
      200,
    );
    const t = await fetch(base + "/api/v1/mcp-template", { headers });
    assert.match(t.headers.get("content-disposition")!, /template/);
    assert.equal(t.status, 200);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    s.close();
  }
});

test("saved report configuration omits connection command arguments and mappings", () => {
  const d = demo();
  const marker = "fixture-sensitive-value";
  d.config.sources[0].args = [marker];
  d.config.sources[0].command = marker;
  d.config.sources[0].mappings = {
    issues: {
      tool: "read_issues",
      arguments: { accidentalValue: marker },
      verifiedReadOnly: true,
    },
  };
  const report = analyze(d.records, d.config, input);
  assert.ok(!JSON.stringify(report).includes(marker));
  assert.equal(d.config.sources[0].args[0], marker);
  assert.ok(!JSON.stringify(template).includes(marker));
});
