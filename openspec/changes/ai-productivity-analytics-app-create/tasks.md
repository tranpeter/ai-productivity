## 1. Establish the standalone runtime

Type: Full-Stack. Depends on: None. Deliverable: an independently runnable application shell. Reference: design Runtime and placement; local-reporting spec.

- [x] 1.1 Verify `/Users/peter/work/ai-productivity` is the writable application and planning root; preserve the existing repository and confirm all new application paths resolve within it.
- [x] 1.2 Scaffold the Node.js/TypeScript package, pinned supported runtime, package lockfile, server/client build configurations, and pnpm scripts; verify `pnpm install --frozen-lockfile`, `pnpm run build`, and local launch without Python or LLM credentials.
- [x] 1.3 Implement loopback binding, launch session, Host/Origin validation, and mutation CSRF checks; verify allowed local requests and rejection of unauthenticated/cross-origin requests.
- [ ] 1.4 Define shared TypeScript contracts and runtime schemas for source, reporting, metric, and evidence DTOs; verify `pnpm run typecheck`, server/client boundary isolation, malformed-date/enum rejection, string source IDs, non-finite metric rejection, and documented revision errors.

## 2. Persist analytical history and configuration

Type: Backend. Depends on: Group 1. Deliverable: storage and configuration services. Reference: design Import and persistence; source-import and local-reporting specs.

- [ ] 2.1 Select and lock a Node.js-compatible SQLite driver and create numbered migrations and backup/version checks; verify clean target-OS installation, empty initialization, upgrade, rejected future schema, failed-migration rollback, and backup restoration.
- [ ] 2.2 Implement versioned entity/event repositories and checkpoint transactions; verify replay deduplication, canonical-event collision handling, and atomic rollback using real temporary SQLite databases.
- [x] 2.3 Implement versioned configuration GET/PUT and credential references; verify optimistic revision conflicts and absence of secrets in responses and logs.
- [ ] 2.4 Implement many-to-many issue/PR links with provenance and unresolved candidates; verify one issue with three PRs is retained as one issue and three distinct PRs.

## 3. Verify on-premise connection capabilities

Type: Backend. Depends on: Groups 1 and 2. Deliverable: source probes and read-only adapter contracts. Reference: design Connection contracts; source-import spec.

- [ ] 3.1 Implement source profile validation and fixed normalized read-operation contracts; verify write tools cannot be invoked even when a server advertises them.
- [ ] 3.2 Implement MCP stdio capability discovery and mapped read calls using the official TypeScript SDK; verify paging/schema handling against a controlled test server and unsupported schemas fail explicitly.
- [ ] 3.3 Implement MCP Streamable HTTP transport and credential/CA references; verify trusted connections, invalid certificates, timeouts, and redacted authentication errors.
- [ ] 3.4 Implement configured REST capability fallback selection and version checks; verify missing MCP operations select only verified read adapters while permission denial does not trigger a bypass.
- [ ] 3.5 Expose connection-test results and record installation compatibility; verify capability gaps map to affected metrics and source versions are not inferred from Cloud defaults.

## 4. Import and reconcile source history

Type: Backend. Depends on: Groups 2 and 3. Deliverable: bounded imports with visible coverage. Reference: design Import and persistence; source-import spec.

- [ ] 4.1 Implement Jira issue discovery and normalized metadata import for the verified installation; verify an issue created before the selected window but completed inside it is included.
- [ ] 4.2 Implement Jira paginated changelog and defect-link ingestion; verify missing/truncated history is reported and start events are not synthesized.
- [ ] 4.3 Implement Bitbucket PR discovery in all states and full activity pagination; verify merged timestamps, bots, open PRs, and creation-before-window cases.
- [ ] 4.4 Implement bounded commit/branch metadata linkage and source evidence URLs; verify multiple links, ambiguous keys, and off-origin credential-safe URL handling.
- [ ] 4.5 Implement queued job start/status/cancel/resume endpoints with checkpoint recovery; verify an interrupted import matches the unique records of an uninterrupted import.
- [ ] 4.6 Implement timeouts, retry limits, Retry-After, and rate-limit handling; verify cancellation remains possible and an exhausted retry budget produces partial status.
- [ ] 4.7 Implement incremental overlap and full reconciliation; verify late events update history without duplicates and access failures are not treated as deletions.
- [ ] 4.8 Calculate source/entity coverage and freshness summaries; verify partial scopes never produce a complete indicator and missing fields disable dependent metrics explicitly.
- [ ] 4.9 Measure event-loop/API responsiveness during a representative backfill and comparison; verify progress/cancel requests respond within one second in the documented local benchmark, and move blocking work to a worker thread if necessary while preserving serialized SQLite writes and snapshot consistency.

## 5. Calculate periods and adoption cohorts

Type: Backend. Depends on: Group 2; uses fixtures independently of Groups 3 and 4. Deliverable: deterministic period/cohort engine. Reference: design Metric definitions; period-analysis spec.

- [x] 5.1 Implement custom, calendar/fiscal quarter, QoQ, and year-over-year resolution; verify half-open boundaries, fiscal rollover, invalid ranges, and leap years.
- [x] 5.2 Implement timezone and QTD equal-day resolution; verify DST boundaries and the September 7, 2026 example yields 68 complete days in each range.
- [ ] 5.3 Implement adoption events, explicit assumed dates, transition exclusions, and equal-duration comparisons; verify mixed Q1 2026, unknown starts, and cross-migration work are labeled correctly.
- [ ] 5.4 Implement completion, unfinished-work, and quality-anchor cohort selection; verify reopen/reclose sequences, cancellations, and multiple PR relationships cannot duplicate issue throughput.

## 6. Calculate metrics and evidence

Type: Backend. Depends on: Groups 2 and 5. Deliverable: metric calculations with evidence and exclusions. Reference: design Metric definitions; period-analysis spec.

- [x] 6.1 Implement cycle/stage durations and linear-interpolated quantiles; verify durations 1, 2, 3, 4 yield median 2.5 and p75 3.25, and missing/negative intervals are excluded with reasons.
- [ ] 6.2 Implement throughput, calendar-week rates, and optional capacity normalization; verify zero baselines and absent historical capacity yield the specified unavailable values.
- [ ] 6.3 Implement PR turnaround and first human review latency; verify author/bot exclusion, ready-time fallback labeling, and unreviewed-PR censoring.
- [ ] 6.4 Implement mature reopen-rate calculation and administrative exclusions; verify full follow-up coverage is needed and recent anchors are shown as immature.
- [ ] 6.5 Implement linked escaped-defect rates and severity breakdown; verify explicit classifier/link requirements, completion-date proxy labels, and missing classifier returns unavailable.
- [ ] 6.6 Implement absolute/relative/rate-point deltas and work-mix/aging summaries; verify the 10-percent-to-8-percent example and historical team unknowns without individual rankings.
- [x] 6.7 Persist report snapshots with materialized evidence, configuration and metric versions; verify later source corrections cannot change an earlier report or export.
- [ ] 6.8 Implement comparison, report listing, and evidence pagination endpoints; verify consistent filters, bounded results, documented errors, and included/excluded evidence totals.

## 7. Build the local analysis interface

Type: UI. Depends on: Groups 1, 3, 4, and 6. Deliverable: usable dashboard and setup flow. Reference: local-reporting spec and API contracts.

- [ ] 7.1 Build source setup and capability-result screens using redacted profiles; verify connection failures and missing history have visible actionable states.
- [ ] 7.2 Build reporting configuration for workflow, timezone, fiscal calendar, adoption assumptions, bots, and optional capacity; verify persisted revisions and field errors.
- [ ] 7.3 Build import progress/cancel/resume controls; verify polling shows partial/completed states and page refresh reconnects to an existing job.
- [ ] 7.4 Build comparison selectors with explicit resolved dates and transition toggles; verify calendar/fiscal/custom modes and mixed-period labels against backend fixtures.
- [ ] 7.5 Build scorecards and locally rendered trend/stage/work-mix charts; verify samples, unavailable values, coverage, and immature quality counts are visible and accessible.
- [ ] 7.6 Build saved-report and evidence drilldowns; verify filtering/pagination, source links, escaped source text, and matching aggregate counts.

## 8. Export and verify the complete workflow

Type: Full-Stack. Depends on: Groups 4, 6, and 7. Deliverable: shareable reports and a verified local release. Reference: all three capability specs.

- [x] 8.1 Implement CSV summary/evidence export from saved snapshots; verify formula-prefix escaping, CSV quoting, redaction, and exact agreement with saved values.
- [ ] 8.2 Implement printable HTML report with definitions, dates, assumptions, and coverage; verify safe source text rendering and readable print preview without clipped tables or charts.
- [ ] 8.3 Create a labeled synthetic end-to-end dataset covering Windsurf, mixed migration, and Copilot periods; verify import-to-dashboard-to-export behavior with real local application services and SQLite.
- [ ] 8.4 Run a bounded read-only import against the supplied on-premise connections; manually reconcile sampled issue histories and PR events with source UI/API evidence and record compatibility/coverage limitations.
- [ ] 8.5 After bounded verification, run the historical backfill and a repeat incremental refresh; verify counts remain stable absent actual source changes and surface any unavailable history.
- [ ] 8.6 Document independent install/start/stop, credentials, corporate CA, source mapping, backup/restore, and metric caveats; verify the documented commands from the standalone application root.
- [ ] 8.7 Run `pnpm run typecheck`, `pnpm run build`, and `pnpm test`, including the standalone application's full unit, storage, adapter-contract, and end-to-end suites from its root; record results and resolve failures before calling implementation complete.
- [ ] 8.8 Run strict change validation, review the final diff for changes outside the application scope, and verify all acceptance scenarios have evidence. Before any later archive, run project-wide strict spec validation and resolve/report failures; do not archive or publish the repository as part of implementation completion.

All checkboxes remain unchecked during proposal. Each subtask targets approximately two hours or less; split further if installation-specific adapters require more work. Groups are independently reviewable deliverables in the existing repository. No Jira ticket assignment or PR publication is assumed. Live-integration tasks require actual source access and must remain incomplete if only synthetic data was tested.

## 9. Implement approved analysis and MCP setup additions

Type: Full-Stack. Depends on: Groups 3, 5, 6, 7.

- [x] 9.1 Implement in-app MCP transport, credential-reference, operation-mapping and test controls; verify configuration round-trip and redaction without actual server credentials.
- [ ] 9.2 Implement per-analysis source/project/repository selections, linked-only scope, single-period reports, MoM and MTD; verify deduplication and period boundaries.
- [ ] 9.3 Implement Top 10 Epics with child-completion evidence and historical status; verify ordering, deduplication, and missing epic metadata.
- [x] 9.4 Implement Top 10 PRs by verified AI run IDs and time window; verify bot comments without verified run IDs are not counted and unknown coverage is visible.

- [x] 9.5 Generate and import placeholder-only MCP templates, keep populated configuration local/ignored, and test connectivity from the setup UI; verify no secret-bearing configuration is staged or exported.

Verification (September 7, 2026): typecheck, build and 24 automated tests passed, including browser template import, successful/failed MCP connection testing, immutable template generation, report configuration redaction and forced-stage configuration guard rejection. No files were staged or committed. Live installation compatibility and remaining unchecked acceptance tasks are not claimed complete.
