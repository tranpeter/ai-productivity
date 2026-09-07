import { z } from "zod";
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v);
    return !isNaN(+d) && d.toISOString().slice(0, 10) === v;
  }, "Invalid calendar date");
export const instant = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s).toISOString());
const recordUrl = z
  .string()
  .url()
  .refine((s) => {
    const u = new URL(s);
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    );
  }, "Use HTTP(S) evidence URLs");
const id = z.string().min(1).max(200);
export const operations = ["issues", "pullRequests"] as const;
export const sourceSchema = z
  .object({
    id,
    name: id,
    kind: z.enum(["jira", "bitbucket"]),
    baseUrl: z.string().url(),
    version: z.string().default(""),
    projects: z.array(z.string()).default([]),
    repositories: z.array(z.string()).default([]),
    credentialRef: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/)
      .optional(),
    caBundleRef: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/)
      .optional(),
    transport: z.enum(["rest", "stdio", "http"]),
    restFallback: z.boolean().default(false),
    mcpUrl: z.string().url().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    mappings: z
      .record(
        z.enum(operations),
        z.object({
          tool: id,
          arguments: z.record(z.unknown()).default({}),
          verifiedReadOnly: z.literal(true),
        }),
      )
      .default({}),
    epicField: z.string().default("customfield_10014"),
    defectLinkTypes: z.array(z.string()).optional(),
    defectLinkDirection: z.enum(["inward", "outward"]).optional(),
    deliveryField: z.string().optional(),
    aiReviewers: z.array(z.string()).default([]),
  })
  .strict()
  .superRefine((s, c) => {
    if (s.transport === "stdio" && !s.command)
      c.addIssue({ code: "custom", message: "Command required" });
    if (s.transport === "http" && !s.mcpUrl)
      c.addIssue({ code: "custom", message: "MCP URL required" });
    for (const v of [s.baseUrl, s.mcpUrl].filter(Boolean)) {
      const u = new URL(v!);
      if (
        !["http:", "https:"].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.search ||
        u.hash
      )
        c.addIssue({
          code: "custom",
          message: "Use HTTP(S) URLs without credentials",
        });
    }
  });
export type Source = z.infer<typeof sourceSchema>;
export const configSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    sources: z.array(sourceSchema),
    reporting: z.object({
      timezone: z
        .string()
        .default("America/Chicago")
        .refine((s) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: s });
            return true;
          } catch {
            return false;
          }
        }, "Invalid timezone"),
      fiscalStartMonth: z.number().int().min(1).max(12).default(1),
      active: z.array(z.string()).default(["In Progress"]),
      done: z.array(z.string()).default(["Done", "Closed", "Resolved"]),
      canceled: z.array(z.string()).default(["Canceled", "Cancelled"]),
      stages: z.record(z.string()).default({
        "In Progress": "Development",
        "In Review": "Review",
        QA: "QA",
        Blocked: "Blocked",
      }),
      bots: z.array(z.string()).default([]),
      followupDays: z.number().int().min(1).max(365).default(30),
      productionLabels: z.array(z.string()).default([]),
      administrativeReopenIds: z.array(z.string()).default([]),
      adoptionEvents: z
        .array(
          z.object({ name: id, date, assumed: z.boolean().default(false) }),
        )
        .default([]),
      exclusions: z.array(z.object({ start: date, end: date })).default([]),
      capacity: z
        .array(
          z.object({
            start: date,
            end: date,
            developerWeeks: z.number().positive(),
          }),
        )
        .default([]),
    }),
  })
  .strict()
  .refine(
    (c) => new Set(c.sources.map((s) => s.id)).size === c.sources.length,
    "Duplicate source IDs",
  );
export type Config = z.infer<typeof configSchema>;
export const defaultConfig: Config = configSchema.parse({
  revision: 0,
  sources: [],
  reporting: {},
});
export const eventSchema = z.object({
  id,
  at: instant,
  from: z.string(),
  to: z.string(),
});
export const issueSchema = z.object({
  kind: z.literal("issue"),
  sourceId: id,
  id,
  key: id,
  title: z.string(),
  project: id,
  type: z.string(),
  priority: z.string().default("Unknown"),
  status: z.string(),
  created: instant,
  history: z.array(eventSchema),
  historyComplete: z.boolean(),
  coverageThrough: instant,
  url: recordUrl,
  epic: z.string().optional(),
  labels: z.array(z.string()).default([]),
  defectOf: z.array(z.string()).default([]),
  delivered: instant.optional(),
  synthetic: z.boolean().default(false),
});
export const prSchema = z.object({
  kind: z.literal("pr"),
  sourceId: id,
  id,
  title: z.string(),
  repository: id,
  author: id,
  created: instant,
  ready: instant.optional(),
  merged: instant.optional(),
  state: z.enum(["OPEN", "MERGED", "DECLINED"]),
  url: recordUrl,
  issueKeys: z.array(z.string()).default([]),
  historyComplete: z.boolean(),
  coverageThrough: instant,
  reviews: z.array(
    z.object({
      id,
      at: instant,
      actor: id,
      type: z.enum(["comment", "approval", "changes"]),
      aiRunId: z.string().optional(),
      aiVerified: z.boolean().default(false),
    }),
  ),
  synthetic: z.boolean().default(false),
});
export const recordSchema = z.discriminatedUnion("kind", [
  issueSchema,
  prSchema,
]);
export type Issue = z.infer<typeof issueSchema>;
export type PR = z.infer<typeof prSchema>;
export type RecordData = z.infer<typeof recordSchema>;
export const analysisSchema = z
  .object({
    configRevision: z.number().int(),
    preset: z.enum(["custom", "mom", "mtd", "qoq", "qtd", "yoy", "adoption"]),
    anchor: date,
    start: date.optional(),
    end: date.optional(),
    comparison: z.enum(["previous", "none", "custom"]).default("previous"),
    baselineStart: date.optional(),
    baselineEnd: date.optional(),
    sourceIds: z.array(id).min(1),
    projects: z.array(z.string()).default([]),
    repositories: z.array(z.string()).default([]),
    linkedOnly: z.boolean().default(false),
    excludeMixed: z.boolean().default(false),
    adoptionName: z.string().optional(),
  })
  .strict();
export type AnalysisInput = z.infer<typeof analysisSchema>;
export type Period = {
  start: string;
  end: string;
  startDate: string;
  endDate: string;
  days: number;
  label: string;
};
export type Evidence = {
  metric: string;
  sourceId: string;
  id: string;
  title: string;
  url: string;
  included: boolean;
  reason?: string;
  value: number | null;
  exposure: string;
};
export type Metric = {
  id: string;
  label: string;
  unit: string;
  value: number | null;
  p75?: number | null;
  n: number;
  excluded: number;
  immature?: number;
  numerator?: number;
  reason?: string;
};
export type PeriodResult = {
  period: Period;
  metrics: Metric[];
  evidence: Evidence[];
  stages: { name: string; days: number }[];
  workMix: { type: string; count: number }[];
  aging: { id: string; title: string; days: number }[];
  epics: {
    key: string;
    title: string;
    done: number;
    status: string;
    children: string[];
  }[];
  prs: {
    id: string;
    title: string;
    url: string;
    runs: number;
    runIds: string[];
  }[];
  unknownAI: number;
  coverage: {
    issues: number;
    completeIssues: number;
    prs: number;
    completePRs: number;
    linked: number;
  };
  warnings: string[];
};
export type Report = {
  id: string;
  created: string;
  version: string;
  config: Config;
  input: AnalysisInput;
  current: PeriodResult;
  baseline: PeriodResult | null;
  synthetic: boolean;
  warnings: string[];
};
