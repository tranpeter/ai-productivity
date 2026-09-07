## Why

Leadership needs reproducible evidence of how software delivery changed during approximately 18 months of AI-assisted development: Windsurf during most of 2025 and a migration to GitHub Copilot in early February 2026. Jira and Bitbucket history can support timeline comparisons, but raw activity counts and mixed adoption periods cannot establish productivity or causation on their own.

## What Changes

- Create a standalone, single-user local application with a Node.js/TypeScript backend, SQLite storage, and a lightweight browser UI sharing typed API contracts. Develop application files in the existing ai-productivity project.
- Connect to on-premise Jira and Bitbucket through backend MCP clients, with an explicitly configured read-only REST fallback for missing historical capabilities.
- Backfill history, resume interrupted imports, refresh incrementally, and expose completeness and source provenance.
- Configure workflow mappings, timezone, fiscal calendar, adoption periods, transition windows, and optional historical team membership/capacity.
- Compare custom ranges, calendar/fiscal quarters, month-over-month, month-to-date, quarter-to-date, year-over-year, and equal-duration adoption periods. Distinguish mixed Q1 2026 from established Copilot usage.
- Calculate cycle time, stage duration, throughput, PR turnaround, first human review latency, reopen rate, and linked escaped-defect rate; show sample sizes, missingness, and underlying evidence.
- Provide trend charts, work-mix breakdowns, unfinished-work aging, CSV exports, and printable, reproducible executive reports without requiring an LLM subscription.

- Add in-app MCP setup, per-analysis repository/Jira scope, and bottom panes for Top 10 Epics and PRs ranked by verified AI review runs.

## Capabilities

### New Capabilities

- `ai-productivity-source-import`: On-premise capability checks, historical ingestion, source normalization, reconciliation, and data coverage.
- `ai-productivity-period-analysis`: Calendar and adoption periods, deterministic metrics, quality windows, and defensible comparisons.
- `ai-productivity-local-reporting`: Local application operation, configuration, dashboards, evidence, and report exports.

### Modified Capabilities

None. These are the initial capabilities of the ai-productivity application.

## Impact

The project root is `/Users/peter/work/ai-productivity`. Planning artifacts live in this project's `openspec/changes/ai-productivity-analytics-app-create` directory. Application routes, persistence, browser assets, tests, and build tooling belong to this standalone project.

Use the team's Node.js application-development conventions. Dependencies include TypeScript, a lightweight Node.js web framework, the TypeScript MCP SDK, a SQLite driver, runtime validation, and build/test tooling, with compatible versions selected and locked during implementation. Python is not a runtime dependency. Source systems are read-only. CROSS-TEAM: Jira/Bitbucket administrators may need to supply version information, service access, historical permissions, and corporate CA configuration; no source-system changes are requested.

This is a directly implemented standalone app in an existing Git repository. No Jira tickets, commits, or deployments are created by this proposal.

## Non-goals

- Proving AI caused changes without a credible counterfactual, or declaring one vendor intrinsically more productive.
- Inferring AI use from code style, ranking individuals, or treating commit/line counts as productivity.
- Monetizing calendar-time reductions as labor savings, collecting prompts/source bodies unnecessarily, or requiring vendor telemetry.
- Production DORA metrics without deployment/incident data; measured review effort without effort records.
- Multi-user hosting, SSO, cloud storage, autonomous scheduled jobs, automatic AI narratives, and repository publication in this first version.
- Universal support for every on-premise release or arbitrary MCP response shape; adapters are verified against the actual installation.

## Delivery Order

Establish the standalone runtime and normalized fixture contracts; implement source adapters and metric calculations against those contracts; connect the UI; verify end-to-end on a bounded real import before an 18-month backfill. Source adapters and metric calculations can proceed independently after their shared contracts are fixed. No parallel agent execution is required.
