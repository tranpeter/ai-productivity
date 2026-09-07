## Purpose

Provide auditable, resumable delivery-history imports from on-premise Jira and Bitbucket without changing either source system.

## ADDED Requirements

### Requirement: Verify source capabilities before import
The application MUST test configured MCP capabilities and report source version, accessible scope, pagination, history availability, and metric dependencies. It MUST support a configured read-only REST fallback and MUST NOT silently replace missing history with current snapshots.

#### Scenario: Historical capability missing
- **GIVEN** an MCP server exposes issue search but not complete changelogs
- **WHEN** the user tests the connection
- **THEN** the application reports the gap and uses a validated REST fallback if configured, otherwise marks dependent metrics unavailable

#### Scenario: Unsupported server or denied access
- **GIVEN** an unsupported response schema or insufficient source permissions
- **WHEN** a source is tested
- **THEN** the application reports a redacted actionable error and does not claim compatible or complete coverage

### Requirement: Import history idempotently
The application MUST paginate selected issues, PRs of all states, and their event histories; persist checkpoints; resume interruptions; deduplicate by stable source identity; and label partial imports. Incremental refresh MUST update changed entities and reconcile late events without double counting.

#### Scenario: Resume a partial import
- **GIVEN** an import fails after two persisted pages
- **WHEN** the user resumes the import
- **THEN** persisted records remain usable as explicitly partial data and completing the import produces the same unique records as an uninterrupted import

#### Scenario: Earlier work completes in range
- **GIVEN** an issue started before the selected range and completed inside it
- **WHEN** history is imported
- **THEN** its earlier available transitions are retained so cycle time is not truncated to the reporting start

### Requirement: Preserve evidence and relationship cardinality
The application MUST preserve source IDs, event timestamps, retrieval time, source links, import provenance, and completeness. Issue-to-PR relationships MUST support many-to-many mappings without multiplying issue throughput. Unknown or conflicting links MUST remain visible.

#### Scenario: One issue has multiple pull requests
- **GIVEN** one completed issue links to three PRs
- **WHEN** throughput and PR turnaround are calculated
- **THEN** the issue contributes once to issue throughput and each eligible PR contributes once to PR metrics

### Requirement: Enforce read-only and local data boundaries
Source adapters MUST invoke only explicitly mapped read operations. Credentials MUST remain outside source-controlled files, browser responses, exports, and logs. TLS verification MUST remain enabled with configurable corporate CA trust. Records lacking permission MUST NOT be classified as deleted solely because retrieval failed.

#### Scenario: Server advertises mutation tools
- **GIVEN** an MCP server exposes read and write tools
- **WHEN** an import runs
- **THEN** only configured read tools are callable and no issue, comment, PR, approval, or repository is modified

#### Scenario: Permission changes during refresh
- **GIVEN** previously imported records become inaccessible
- **WHEN** refresh receives permission failures
- **THEN** the import reports incomplete visibility without silently converting those records to source deletions

