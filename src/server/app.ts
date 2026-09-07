import express from "express";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { z, ZodError } from "zod";
import {
  analysisSchema,
  configSchema,
  type Report,
} from "../shared/contracts.js";
import { Store } from "./store.js";
import { Imports } from "./imports.js";
import { testConnection, SourceError } from "./connectors.js";
import { analyze } from "./analysis.js";
import { resolvePeriods } from "./periods.js";
import { demo } from "./demo.js";
const escape = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function csvCell(v: unknown) {
  let s = String(v ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export const template = {
  sources: [
    {
      id: "jira",
      name: "Company Jira",
      kind: "jira",
      baseUrl: "https://jira.example.com",
      projects: ["PROJECT"],
      repositories: [],
      transport: "http",
      mcpUrl: "https://mcp.example.com/mcp",
      credentialRef: "JIRA_MCP_TOKEN",
      restFallback: false,
      args: [],
      mappings: {
        issues: {
          tool: "REPLACE_WITH_READ_TOOL",
          arguments: {},
          verifiedReadOnly: true,
        },
      },
      version: "",
      epicField: "customfield_10014",
      aiReviewers: [],
    },
    {
      id: "bitbucket",
      name: "Company Bitbucket",
      kind: "bitbucket",
      baseUrl: "https://bitbucket.example.com",
      projects: ["PROJECT"],
      repositories: ["PROJECT/repository-slug"],
      transport: "http",
      mcpUrl: "https://mcp.example.com/mcp",
      credentialRef: "BITBUCKET_MCP_TOKEN",
      restFallback: false,
      args: [],
      mappings: {
        pullRequests: {
          tool: "REPLACE_WITH_READ_TOOL",
          arguments: {},
          verifiedReadOnly: true,
        },
      },
      aiReviewers: [],
    },
  ],
  instructions:
    "Template only. Supply actual credentials through environment variables. Do not add secret values. Save edited configuration as mcp.local.json (ignored) or through the app into .data. MCP tools must return normalized pages; see README.",
};
export function createApp(store: Store) {
  const app = express(),
    imports = new Imports(store),
    launch = randomBytes(32).toString("hex"),
    session = randomBytes(32).toString("hex"),
    csrf = randomBytes(24).toString("hex");
  let launched = false;
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const hostname = req.hostname;
    if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname)) {
      res
        .status(403)
        .json({ error: { code: "HOST", message: "Untrusted host" } });
      return;
    }
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/launch", (req, res) => {
    if (launched || req.query.token !== launch) {
      res.sendStatus(403);
      return;
    }
    launched = true;
    res.cookie("ap_session", session, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    res.redirect("/");
  });
  app.use((req, res, next) => {
    const cookies = (req.headers.cookie ?? "").split(";").map((s) => s.trim());
    if (!cookies.includes(`ap_session=${session}`)) {
      res
        .status(401)
        .send("Open the launch URL printed in your local terminal.");
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) {
        res.sendStatus(403);
        return;
      }
      if (req.headers["x-csrf-token"] !== csrf) {
        res
          .status(403)
          .json({ error: { code: "CSRF", message: "Invalid session token" } });
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/v1/session", (_req, res) => res.json({ csrf }));
  app.get("/api/v1/config", (_req, res) => res.json(store.config()));
  app.put("/api/v1/config", (req, res) => res.json(store.saveConfig(req.body)));
  app.get("/api/v1/mcp-template", (_req, res) =>
    res.attachment("mcp.template.json").json(template),
  );
  app.post("/api/v1/connections/:id/test", async (req, res) => {
    const s = store.config().sources.find((s) => s.id === req.params.id);
    if (!s) {
      res.sendStatus(404);
      return;
    }
    res.json(await testConnection(s, AbortSignal.timeout(30000)));
  });
  app.get("/api/v1/data", (_req, res) => {
    const records = store.records();
    res.json({
      count: records.length,
      synthetic: records.some((r) => r.synthetic),
      sources: store.config().sources.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        projects: s.projects,
        repositories: s.repositories,
      })),
      jobs: store.jobs().map(({ config, ...j }) => j),
    });
  });
  app.post("/api/v1/demo", (_req, res) => {
    if (store.records().length) {
      res.status(409).json({
        error: {
          code: "DATA_EXISTS",
          message: "Demo can only be loaded into an empty data store.",
        },
      });
      return;
    }
    const d = demo(),
      existing = store.config();
    if (existing.sources.length) {
      res.status(409).json({
        error: {
          code: "CONFIG_EXISTS",
          message: "Use a separate empty data directory for demo data.",
        },
      });
      return;
    }
    d.config.revision = existing.revision;
    store.saveConfig(d.config);
    store.upsert(d.records);
    res.json({ count: d.records.length });
  });
  app.post("/api/v1/imports", (req, res) => {
    const i = z
      .object({
        sourceIds: z.array(z.string()).min(1),
        mode: z.enum(["backfill", "incremental", "reconcile"]),
      })
      .parse(req.body);
    const { config, ...job } = imports.start(i.sourceIds, i.mode);
    res.status(202).json(job);
  });
  app.get("/api/v1/imports/:id", (req, res) => {
    const job = store.job(String(req.params.id));
    if (!job) {
      res.sendStatus(404);
      return;
    }
    const { config, ...safe } = job;
    res.json(safe);
  });
  app.post("/api/v1/imports/:id/cancel", (req, res) =>
    res.json(imports.cancel(String(req.params.id))),
  );
  app.post("/api/v1/imports/:id/resume", (req, res) => {
    const { config, ...j } = imports.resume(String(req.params.id));
    res.status(202).json(j);
  });
  app.post("/api/v1/periods", (req, res) =>
    res.json(resolvePeriods(analysisSchema.parse(req.body), store.config())),
  );
  app.post("/api/v1/comparisons", (req, res) => {
    const input = analysisSchema.parse(req.body),
      config = store.config();
    if (input.configRevision !== config.revision)
      throw new Error("CONFIG_CONFLICT");
    if (input.sourceIds.some((id) => !config.sources.some((s) => s.id === id)))
      throw new Error("Unknown source");
    const report = analyze(store.records(), config, input);
    store.saveReport(report);
    res.status(201).json(report);
  });
  app.get("/api/v1/comparisons", (_req, res) =>
    res.json({ items: store.reports() }),
  );
  app.get("/api/v1/comparisons/:id/evidence", (req, res) => {
    const report = store.report(String(req.params.id));
    if (!report) {
      res.sendStatus(404);
      return;
    }
    const query = z
      .object({
        metric: z.string(),
        period: z.enum(["current", "baseline"]).default("current"),
        cursor: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        included: z.enum(["true", "false"]).optional(),
      })
      .parse(req.query);
    const evidence = (report[query.period]?.evidence ?? []).filter(
      (e) =>
        e.metric === query.metric &&
        (query.included === undefined ||
          e.included === (query.included === "true")),
    );
    res.json({
      items: evidence.slice(query.cursor, query.cursor + query.limit),
      nextCursor:
        query.cursor + query.limit < evidence.length
          ? query.cursor + query.limit
          : null,
    });
  });
  app.get("/api/v1/comparisons/:id/export", (req, res) => {
    const report = store.report(String(req.params.id));
    if (!report) {
      res.sendStatus(404);
      return;
    }
    if (req.query.format === "csv") {
      const rows = [
        ["Period", "Metric", "Value", "Unit", "Sample count", "Excluded"],
        ...report.current.metrics.map((m) => [
          report.current.period.label,
          m.label,
          m.value,
          m.unit,
          m.n,
          m.excluded,
        ]),
        ...(report.baseline?.metrics.map((m) => [
          report.baseline!.period.label,
          m.label,
          m.value,
          m.unit,
          m.n,
          m.excluded,
        ]) ?? []),
        ["Created", report.created],
        ["Metric version", report.version],
        ["Synthetic", report.synthetic],
        ["Scope", JSON.stringify(report.input)],
        ["Warnings", report.warnings.join(" ")],
        [
          "Evidence period",
          "Metric",
          "Entity",
          "Title",
          "Value",
          "Included",
          "Reason",
          "Source URL",
        ],
        ...[
          ["current", report.current],
          ["baseline", report.baseline],
        ].flatMap(([name, period]) =>
          typeof period === "object" && period
            ? period.evidence.map((e) => [
                name,
                e.metric,
                e.id,
                e.title,
                e.value,
                e.included,
                e.reason,
                e.url,
              ])
            : [],
        ),
      ];
      res
        .attachment("analysis.csv")
        .type("text/csv")
        .send(rows.map((r) => r.map(csvCell).join(",")).join("\r\n"));
      return;
    }
    res
      .attachment("analysis.html")
      .type("html")
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><title>Delivery analysis</title><style>body{font:16px system-ui;max-width:1000px;margin:32px auto}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #aaa;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>Delivery analysis</h1><p>${escape(report.current.period.label)}${report.synthetic ? " · SYNTHETIC DATA" : ""}</p><p>${escape(report.warnings.join(" "))}</p><table><tr><th>Metric</th><th>Current</th><th>Baseline</th><th>Eligible</th></tr>${report.current.metrics.map((m, i) => `<tr><td>${escape(m.label)}</td><td>${escape(m.value ?? "Unavailable")} ${escape(m.unit)}</td><td>${escape(report.baseline?.metrics[i].value ?? "—")}</td><td>${m.n}</td></tr>`).join("")}</table><h2>Report provenance and evidence</h2><pre>${escape(JSON.stringify(report, null, 2))}</pre></body></html>`,
      );
  });
  app.get("/api/v1/comparisons/:id", (req, res) => {
    const r = store.report(String(req.params.id));
    if (r) res.json(r);
    else res.sendStatus(404);
  });
  app.use(express.static(resolve("public")));
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof ZodError) {
        res.status(422).json({
          error: {
            code: "VALIDATION",
            message: err.issues
              .map((i) => i.path.join(".") + ": " + i.message)
              .join("; "),
          },
        });
        return;
      }
      if (err instanceof SourceError) {
        res
          .status(502)
          .json({ error: { code: err.code, message: err.message } });
        return;
      }
      const code = err instanceof Error ? err.message : "UNKNOWN";
      res
        .status(
          code.endsWith("CONFLICT") ? 409 : code === "NOT_FOUND" ? 404 : 422,
        )
        .json({
          error: {
            code: "REQUEST",
            message: ["CONFIG_CONFLICT", "JOB_CONFLICT", "NOT_FOUND"].includes(
              code,
            )
              ? code
              : "Request failed. Check configuration and input values.",
          },
        });
    },
  );
  return { app, launch, imports };
}
