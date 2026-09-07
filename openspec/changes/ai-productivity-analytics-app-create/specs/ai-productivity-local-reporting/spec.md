## Purpose

Let a single local user inspect delivery evidence, configure comparisons, and share auditable reports without cloud hosting or an LLM subscription.

## ADDED Requirements

### Requirement: Operate as an independent local application
The application MUST run as a standalone application using local persistent storage and a localhost browser interface. It MUST bind only to loopback and reject untrusted hosts and cross-origin state-changing requests. No Git repository or cloud deployment MUST be created automatically.

#### Scenario: Start the standalone application
- **GIVEN** documented application dependencies and an empty local data directory
- **WHEN** the user launches the app
- **THEN** the local setup page opens without an external application build, database service, or LLM credential

### Requirement: Configure sources and reporting conventions
The UI MUST configure source scope, workflow mappings, timezone, fiscal start month, adoption dates, exclusions, bot identities, production-defect classification, and optional historical team/capacity mappings. Changes MUST be versioned and validated; secrets MUST only be referenced through backend configuration.

#### Scenario: Approximate migration date
- **GIVEN** only early February 2026 is known
- **WHEN** initial setup runs
- **THEN** no exact date is asserted as fact and tool-period comparisons remain unavailable until a date or explicitly labeled assumption is saved

### Requirement: Explore evidence and coverage
The dashboard MUST provide executive metrics, trends, stage durations, quality, work mix, unfinished-work age, and source coverage. Metric drilldowns MUST expose included and excluded evidence and source links without an individual productivity ranking.

#### Scenario: Partial import dashboard
- **GIVEN** Jira history is complete and Bitbucket history is partial
- **WHEN** the user opens a comparison
- **THEN** affected cards show partial or unavailable status and drilldowns explain the missing evidence

### Requirement: Export auditable reports
The application MUST export CSV and printable HTML using the saved report snapshot. Exports MUST include periods, filters, adoption assumptions, metric definitions, samples, coverage, data watermark, and attribution limitations. CSV cells MUST be protected against formula injection, and source text MUST be escaped in HTML.

#### Scenario: Export after refresh
- **GIVEN** a saved comparison and a subsequent data refresh
- **WHEN** the comparison is exported
- **THEN** exported values match that saved comparison rather than the newest database state

#### Scenario: Unsafe source title
- **GIVEN** an issue title begins with a spreadsheet formula prefix or contains HTML
- **WHEN** evidence is exported
- **THEN** the CSV does not execute the formula and the HTML displays the title as text


### Requirement: Configure MCP in the application
The application MUST let the user configure stdio or Streamable HTTP MCP connections, credential references, read-operation mappings, and REST fallback, and test connectivity without exposing credentials.

#### Scenario: Configure a local MCP server
- **GIVEN** a user-supplied server command and read mappings
- **WHEN** the user saves and tests the connection
- **THEN** the application persists the profile and shows capability results or redacted errors

### Requirement: Show ranked period highlights
The application MUST show Top 10 Epics on the left and Top 10 PRs on the right, stacking on narrow screens. Epics MUST rank by distinct child completions; PRs MUST rank by distinct verified AI review runs occurring in the period. Unknown AI assistance MUST NOT become verified activity.

#### Scenario: Repeated comments from one review
- **GIVEN** one verified AI run produces several comments
- **WHEN** PR rankings are computed
- **THEN** the run counts once and the evidence identifies its run ID

### Requirement: Local MCP templates and connection verification
The application MUST generate placeholder-only Jira and Bitbucket MCP profiles, import populated profiles into local storage, and expose a connection-test action. Credentials MUST be supplied by environment-variable reference. Populated configuration and databases MUST be ignored by Git, and a build-time check MUST reject tracked or staged local configuration paths. The application MUST NOT stage or commit configuration.

#### Scenario: Generate a template after editing a connection
- **WHEN** the user downloads a template after saving a connection
- **THEN** the file contains static placeholders rather than the saved connection values

#### Scenario: Test a mapped MCP server
- **WHEN** the user selects Save & test connection
- **THEN** the application discovers server capabilities and shows connectivity, version and missing operation mappings, without claiming historical completeness

#### Scenario: Protect local configuration
- **WHEN** a populated MCP profile is force-staged despite Git ignore rules
- **THEN** the configuration guard fails without printing its contents
