## Purpose

Produce reproducible timeline comparisons that distinguish observed delivery changes from unverified AI attribution and incomplete source data.

## ADDED Requirements

### Requirement: Resolve configurable reporting periods
The application MUST support custom ranges, calendar and fiscal quarters, quarter-over-quarter, year-over-year, equal-duration adoption comparisons, and quarter-to-date comparison against equal elapsed local calendar days. It MUST use a configured timezone and half-open date boundaries and display resolved ranges.

#### Scenario: Current quarter comparison
- **GIVEN** today is September 7, 2026 and calendar quarters are configured
- **WHEN** the user selects current quarter-to-date
- **THEN** the default includes complete local days from July 1 through September 6 and compares April 1 through June 7, with both exclusive end dates visible (68 days in each period)

#### Scenario: Fiscal year crosses calendar year
- **GIVEN** the fiscal year starts in November
- **WHEN** the user selects the quarter starting November 2025
- **THEN** the range ends exclusively on February 1, 2026 and the fiscal naming convention is displayed

### Requirement: Separate adoption periods from individual exposure
The application MUST allow editable adoption events, transition exclusions, and mixed-period flags. It MUST label tool exposure as calendar-inferred unless explicit evidence exists; work spanning an adoption boundary MUST be marked mixed. Exact adoption dates MUST NOT be fabricated from approximate user statements.

#### Scenario: Mixed first quarter
- **GIVEN** a confirmed migration date in February 2026
- **WHEN** Q1 2026 is analyzed
- **THEN** the report labels the quarter mixed and allows a separate comparison excluding the configured transition window

#### Scenario: No pre-AI baseline
- **GIVEN** the retained history covers only AI-assisted periods
- **WHEN** a comparison is exported
- **THEN** it describes observed changes between periods and states that overall AI-versus-no-AI effectiveness cannot be established

### Requirement: Calculate delivery metrics from declared cohorts
The application MUST calculate completed-issue cycle time, mapped stage durations, throughput, merged-PR turnaround, and first human review latency from source events. It MUST display cohort definitions, median and 75th percentile for durations, counts, exclusions, and unavailable metrics. Missing start events MUST NOT become zero durations. It MUST separately show unfinished-work age and work-mix breakdowns.

#### Scenario: Known duration and missing history
- **GIVEN** eligible cycle durations of 1, 2, 3, and 4 days and another completed issue missing its start
- **WHEN** the scorecard is calculated
- **THEN** median is 2.5 days, linearly interpolated 75th percentile is 3.25 days, sample size is 4, and one issue is excluded for missing history

#### Scenario: Automated review
- **GIVEN** a bot comments before a human reviews a PR
- **WHEN** first human review latency is calculated
- **THEN** the bot event is excluded and the human event supplies the endpoint

### Requirement: Use equally mature quality cohorts
Reopen and escaped-defect rates MUST use a configurable follow-up window, default 30 calendar days, and include only cohorts with complete follow-up coverage. Escaped defects MUST require explicit production classification and verified issue linkage; missing release dates MUST result in a labeled completion-date proxy. Administrative reopenings MUST be excluded through explicit configuration.

#### Scenario: Recent completion is immature
- **GIVEN** an issue completed 10 days before the data watermark and the follow-up window is 30 days
- **WHEN** a reopen rate is calculated
- **THEN** the issue is excluded from its denominator and shown in the immature count

### Requirement: Report changes without false precision
Comparisons MUST include absolute and relative changes, rate percentage-point changes, sample counts, coverage, and work-mix differences. Relative change from zero or missing baseline MUST be unavailable. The application MUST NOT claim statistical significance, causal tool effects, or labor savings from elapsed time. Capacity normalization MUST be unavailable without configured historical capacity.

#### Scenario: Zero baseline and rate change
- **GIVEN** throughput changes from zero to five and a mature defect rate changes from 10 percent to 8 percent
- **WHEN** results are compared
- **THEN** throughput shows an absolute increase of five with unavailable relative change, and defects show minus two percentage points and minus 20 percent relative change

### Requirement: Reproduce historical comparisons
The application MUST retain a comparison's configuration revision, metric version, resolved boundaries, data snapshot, watermark, filters, denominators, and evidence so later refreshes do not silently change saved reports.

#### Scenario: Source history is corrected
- **GIVEN** a saved report and a later import correcting an event
- **WHEN** the old report is reopened
- **THEN** its original results and evidence remain unchanged and a new calculation creates a distinct report

### Requirement: Select analysis scope and monthly periods
The application MUST support per-analysis repository and Jira project selection, an explicit linked-only filter, single periods, month-over-month and month-to-date. It MUST keep identical scope across compared windows and deduplicate shared issues.

#### Scenario: Default monthly comparison
- **GIVEN** September 7, 2026
- **WHEN** month-over-month is selected
- **THEN** August 2026 is compared with July 2026 using explicit local boundaries
