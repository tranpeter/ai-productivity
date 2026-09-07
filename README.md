# ai-productivity

A local Node.js/TypeScript application for comparing software delivery across AI-assisted development periods using on-premise Jira and Bitbucket history. SQLite stores source profiles, imported history, and saved reports. The browser provides custom, monthly, quarterly, and adoption-period comparisons, Top 10 Epics, and PR rankings by verified AI review runs.

Implementation is in progress. Automated fixtures exercise the application; compatibility and historical completeness have not yet been verified against your installations. Remaining acceptance work is tracked in `openspec/changes/ai-productivity-analytics-app-create/tasks.md`.

## Run locally

Use Node.js 24.18 or later in the 24.x release line (`.nvmrc` pins 24.18.0) and pnpm 9.12.0, pinned in `package.json`. With Corepack available, run `corepack enable` to activate the pinned package manager.

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm start
```

Open the one-use launch URL printed in the terminal. The server binds to loopback on port 4310, uses a local session cookie and CSRF protection, and requires no LLM credentials. Stop with Ctrl+C. `PORT` overrides the port and `AP_DATA_DIR` overrides the default `.data` directory. Keep any alternate data directory outside your repository.

For a first look, use **Load synthetic example**. The example is explicitly synthetic and includes an assumed February 5, 2026 migration date; replace assumptions with your actual dates for real reports.

## Configure and test MCP

In **Connections & data**, choose **Download MCP template**. The generated JSON contains placeholder Jira and Bitbucket profiles, never the currently saved settings. Populate endpoints, project keys, repository slugs, transport, and read-only tool mappings. Save it as `mcp.local.json`, then use **Import populated MCP template**, or edit profiles directly in the app.

**Save & test connection** saves the profile locally, initializes the MCP connection and discovers available tools. Results show the MCP server version, advertised schemas and missing mappings. Success establishes connectivity and discovery; a bounded import is still needed to validate historical record schemas and completeness. The test does not call Jira/Bitbucket write operations. Local-command transports launch the executable you configure.

Supported transports:

- **Streamable HTTP:** set `mcpUrl`. `credentialRef` names an environment variable whose value is sent as a bearer token.
- **Local command / stdio:** set `command` and `args`. The subprocess receives PATH, HOME and the named credential/CA environment variables. Put credentials in the environment, never in arguments.
- **Read-only REST:** set the application base URL and a bearer-token environment reference. Testing reads Jira server information or Bitbucket application properties.

Set credential variables in the environment before starting the app using your local secret manager or shell. Configuration stores only variable names such as `JIRA_MCP_TOKEN`, not their values. For an internal certificate authority, `caBundleRef` names an environment variable containing the path to a PEM CA bundle. Missing variables or unreadable CA files produce a connection error; certificate verification is not disabled. Restart the app after changing its environment.

### Local configuration and secrets

The application never stages, commits or pushes files. It saves edited profiles in `.data/analytics.sqlite`, not a repository configuration file. `.data/`, `.env*`, `mcp*.json`, `*.local.json`, and SQLite files are Git-ignored. Importing a template reads it into local storage without copying the file into the project. Keep secret values out of free-text fields, command arguments and operation mappings.

`pnpm run check:config` rejects tracked/staged local configuration and databases. The build runs this check automatically. Run it before any commit as well. Report snapshots omit commands, arguments and mappings; the generated template is always static and placeholder-only.

### MCP normalized read contract

Map `issues` for Jira or `pullRequests` for Bitbucket to a verified read-only tool. Each mapping contains `tool`, `arguments`, and `verifiedReadOnly: true`. The caller supplies paging/scope arguments. The tool must return a normalized JSON page in structured content or JSON text:

```json
{"records": [], "nextCursor": null, "complete": true}
```

`nextCursor` is a nonnegative integer or null. Record schemas live in `src/shared/contracts.ts`; issue records include status history and completeness, and PR records include review events. An arbitrary MCP server will often need an adapter to this contract. Discovery alone does not establish compatibility. Never map a mutation tool even if it is advertised by the server.

REST fallback is optional and read-only. Missing mapped operations can select it; access denials do not trigger a bypass. Jira imports project issues and changelogs; Bitbucket imports PRs and activities. Jira custom Epic/defect/delivery fields and workflow names must match the installation. Bitbucket PR title/branch issue keys provide initial links; native comments do not establish verified AI review runs. Installation-specific history limitations remain visible and require live validation.

## Analysis and storage

Select source connections, project/repository scope, date preset and reporting timezone. Periods use local calendar boundaries converted to half-open UTC intervals. Month/quarter-to-date comparisons use equal complete calendar days; full-period presets use completed months/quarters. Configure workflow stages, adoption dates, bots, quality follow-up and optional historical capacity under reporting settings.

Reports include cycle time, throughput, PR timing and quality measures with evidence and exclusions. Top Epics rank completed children. AI PR rankings require explicit verified run IDs and configured integration identities; bot comments alone are insufficient. Missing history and immature quality follow-up limit interpretation. Tool adoption dates and observed changes do not prove that AI caused productivity changes.

Saved reports materialize their evidence and configuration so later corrections do not rewrite earlier results. CSV and printable HTML exports use these saved snapshots. Incremental Jira refreshes overlap the prior successful import by seven days; full reconciliation rescans retained scope. Bitbucket currently rescans PRs. Imported records are upserted rather than deleted after an access failure.

To back up or restore, stop the app and copy/replace the complete data directory. Preserve database sidecars if present. Startup checks schema versions and creates a database backup before migrations. Backups contain private source data and should remain outside version control.

## Verification

```sh
pnpm run typecheck
pnpm run build
pnpm exec playwright install chromium
pnpm test
pnpm run check:config
```

Tests cover period boundaries, metric fixtures, SQLite snapshots, local API security, a controlled MCP server and the browser setup/report flow. Actual on-premise import and backfill validation remain pending source setup.
