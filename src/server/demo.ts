import {
  type RecordData,
  type Config,
  defaultConfig,
} from "../shared/contracts.js";
export function demo() {
  const config: Config = structuredClone(defaultConfig);
  config.sources = [
    {
      id: "demo-jira",
      name: "Sample Jira",
      kind: "jira",
      baseUrl: "https://jira.example.invalid",
      version: "Demo",
      projects: ["PAY"],
      repositories: [],
      transport: "rest",
      restFallback: false,
      args: [],
      mappings: {},
      epicField: "customfield_10014",
      aiReviewers: [],
    },
    {
      id: "demo-bb",
      name: "Sample Bitbucket",
      kind: "bitbucket",
      baseUrl: "https://bitbucket.example.invalid",
      version: "Demo",
      projects: ["PLATFORM"],
      repositories: ["PLATFORM/payments-api"],
      transport: "rest",
      restFallback: false,
      args: [],
      mappings: {},
      epicField: "",
      aiReviewers: ["demo-ai-reviewer"],
    },
  ];
  config.reporting.bots = ["demo-ai-reviewer"];
  config.reporting.adoptionEvents = [
    { name: "Copilot (sample date)", date: "2026-02-05", assumed: true },
  ];
  const records: RecordData[] = [];
  for (let e = 0; e < 10; e++)
    records.push({
      kind: "issue",
      sourceId: "demo-jira",
      id: `epic-${e}`,
      key: `PAY-E${e}`,
      title: [
        "Reliable payments",
        "Billing modernization",
        "Payment observability",
        "Checkout performance",
        "Subscription lifecycle",
        "Refund workflows",
        "Reconciliation",
        "Access controls",
        "Currency support",
        "Partner onboarding",
      ][e],
      project: "PAY",
      type: "Epic",
      priority: "Normal",
      status: "In Progress",
      created: "2025-01-01T12:00:00Z",
      history: [
        {
          id: "start",
          at: "2025-01-02T12:00:00Z",
          from: "Open",
          to: "In Progress",
        },
      ],
      historyComplete: true,
      coverageThrough: "2026-09-07T00:00:00Z",
      url: `https://jira.example.invalid/browse/PAY-E${e}`,
      labels: [],
      defectOf: [],
      synthetic: true,
    });
  for (let month = 1; month <= 8; month++)
    for (let n = 1; n <= 18; n++) {
      const end = new Date(Date.UTC(2026, month - 1, n + 7, 12)),
        start = new Date(+end - (month < 4 ? 8 : 6) * 86400000),
        review = new Date(+end - 2 * 86400000),
        key = `PAY-${month * 100 + n}`,
        url = `https://jira.example.invalid/browse/${key}`;
      records.push({
        kind: "issue",
        sourceId: "demo-jira",
        id: key,
        key,
        title: `${["Payment retry", "Invoice export", "Validation update"][n % 3]} ${n}`,
        project: "PAY",
        type: n % 3 ? "Story" : "Bug",
        priority: "Normal",
        status: "Done",
        created: new Date(+start - 86400000).toISOString(),
        history: [
          {
            id: `${key}-a`,
            at: start.toISOString(),
            from: "Open",
            to: "In Progress",
          },
          {
            id: `${key}-r`,
            at: review.toISOString(),
            from: "In Progress",
            to: "In Review",
          },
          {
            id: `${key}-d`,
            at: end.toISOString(),
            from: "In Review",
            to: "Done",
          },
        ],
        historyComplete: n !== 18,
        coverageThrough: "2026-09-07T00:00:00Z",
        url,
        epic: `PAY-E${n % 10}`,
        labels: [],
        defectOf: [],
        synthetic: true,
      });
      records.push({
        kind: "pr",
        sourceId: "demo-bb",
        id: `${month * 100 + n}`,
        title: `Implement ${key}`,
        repository: "PLATFORM/payments-api",
        author: "sample-author",
        created: review.toISOString(),
        merged: end.toISOString(),
        state: "MERGED",
        url: `https://bitbucket.example.invalid/projects/PLATFORM/repos/payments-api/pull-requests/${month * 100 + n}`,
        issueKeys: [key],
        historyComplete: true,
        coverageThrough: "2026-09-07T00:00:00Z",
        reviews: Array.from({ length: (n % 5) + 1 }, (_, i) => ({
          id: `${key}-r${i}`,
          at: new Date(+review + i * 3600000).toISOString(),
          actor: "demo-ai-reviewer",
          type: "comment" as const,
          aiRunId: `${key}-run${i}`,
          aiVerified: true,
        })).concat([
          {
            id: `${key}-human`,
            at: new Date(+review + 8 * 3600000).toISOString(),
            actor: "sample-reviewer",
            type: "comment",
            aiRunId: "",
            aiVerified: false,
          },
        ]),
        synthetic: true,
      });
    }
  return { config, records };
}
