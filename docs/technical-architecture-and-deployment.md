# Runtime Capacity Intelligence: Technical Architecture and Deployment

## 1. Purpose

Runtime Capacity Intelligence is a read-only UiPath Coded Web App that helps business owners, COE teams, release managers, and Orchestrator administrators understand unattended robot runtime capacity, schedule contention, machine template configuration, and SLA risk.

The app is designed to answer three operational questions:

- What happened to unattended runtime capacity across the selected tenant, folder, and machine template?
- Where are the highest-risk schedule windows, and which automations drive them?
- Where can a new or changed automation be scheduled without increasing runtime contention?

## 2. Current Implementation Status

The current project is a React, Vite, and TypeScript web application with live Orchestrator analytics and an empty sign-in state when not connected. It includes:

- Sign-in and sign-out UI shell.
- Folder, machine template, and date-range filters. The tenant comes from the selected sign-in connection profile.
- Data health and API status alert band.
- Runtime heatmap with day, week, and month views. Year view is intentionally hidden until long-range aggregates are available.
- Tenant-current date/hour default on load, using the configured tenant timezone.
- What-if scenario planner for proposed automation demand.
- Basic automation details input for SLA, volume, and business context.
- Rules-backed recommendation action that recommends a slot/action from the currently loaded capacity data.
- Submitted scenario impact summary below the heatmap with baseline vs projected demand.
- Dynamic observations and recommendations.
- Schedule vs runtime risk analysis.
- Machine template and runtime inventory.

Live UiPath API connectivity is wired for controlled customer validation. The app currently includes browser OAuth, saved public connection profiles, live Orchestrator probe modules, tenant license info, folder discovery, exact Orchestrator Administrator role detection, session reads, paged machine reads, scoped reads for jobs/machines/triggers where permitted, live transforms, and connector diagnostics. Mock business data is not used when the tenant is not connected.

Live customer findings should be treated as validation output until endpoint coverage, OAuth scopes, folder assignments, and retention windows are confirmed in the target tenant.

## 3. Recommended Target Architecture

The recommended production architecture is a hybrid live-and-persisted model.

```text
User browser
  |
  | Non-confidential External App sign-in
  v
Runtime Capacity Intelligence Web App
  |
  | User-delegated read-only API calls
  v
UiPath Orchestrator / Automation Cloud APIs
  |
  | Scheduled aggregation
  v
Data Fabric / Data Service metric entities
  |
  | Fast dashboard reads
  v
Heatmap, inventory, SLA risk, and recommendation views
```

### Architecture Layers

| Layer | Responsibility |
| --- | --- |
| Browser UI | Presents filters, capacity views, what-if simulation, recommendations, and API status. |
| UiPath Auth | Uses a non-confidential External Application and user scopes. |
| Live Connector | Reads current folders, processes, jobs, triggers, queues, machines, and machine templates. |
| Aggregation Job | Periodically calculates normalized capacity and risk metrics. |
| Data Fabric Store | Persists curated metrics for performance and history. |
| Analytics Engine | Calculates utilization, risk bands, duration percentiles, collision windows, and recommendations. |
| Recommendation Helper | Uses scenario details and loaded capacity facts to recommend a safer slot or action; production AI/chat is deferred. |

## 4. Authentication and Secret Handling

The user-facing app should use a non-confidential UiPath External Application with user scopes.

Security rules:

- Do not store UiPath usernames or passwords.
- Do not store a client secret in the browser.
- Store only public configuration such as client ID, base URL, organization, tenant, and read-only scopes.
- Keep access tokens out of logs, screenshots, Data Fabric, and exported diagnostics.
- Respect the signed-in user's UiPath permissions.
- Keep MVP behavior read-only.

The non-confidential External Application should be created with the read-only user scopes below for the current live connector.

Required scopes:

```text
OR.Execution.Read
OR.Folders.Read
OR.Jobs.Read
OR.License.Read
OR.Machines.Read
OR.Robots.Read
OR.Settings.Read
OR.Users.Read
```

Additional read scopes may be needed later for queues, calendars, Data Fabric entities, or Insights-backed metrics.

## 5. Data Handling Strategy

### Use Live API for Current State

Live API calls should be used for:

- Signed-in user and tenant validation.
- Tenant unattended license allocation.
- Permission-scoped tenant and folder lists, with tenant-wide folder discovery only when the exact UiPath default `Orchestrator Administrator` role is detected.
- Current machine template and runtime configuration, paged beyond the first OData page and limited to discovered folders for regular users.
- Current connected machine/session signals.
- Current running and pending jobs.
- Refresh-now actions.
- API health and error visibility.

### Use Data Fabric for Curated Metrics

Data Fabric should store calculated metrics rather than raw logs. This avoids repeatedly pulling large job history windows and gives the app a durable planning model beyond Orchestrator retention windows.

Recommended persisted entities:

| Entity | Purpose |
| --- | --- |
| `RuntimeCapacitySnapshot` | Hourly or 5-minute peak consumed runtimes, planning capacity, utilization percentage, and risk score. |
| `MachineTemplateInventorySnapshot` | Template runtime slots, connected machines, configured max capacity, folders, runtime type, host/session monitoring context, and whether the source was folder-scoped or Orchestrator Administrator tenant-wide discovery by template. |
| `TenantLicenseSnapshot` | Tenant-level unattended license allocation and used values returned by the approved license API. |
| `ProcessDurationMetric` | p50, p75, p90, and p95 duration by process, folder, and time bucket. |
| `ScheduleRiskSnapshot` | Projected schedule collision and SLA risk by folder/process/window. |
| `WhatIfScenario` | Optional saved proposed automation scenarios. |
| `DataIngestionRun` | Refresh status, source counts, warnings, errors, and last successful load. |
| `ApiErrorLog` | Sanitized API failures without tokens or sensitive payloads. |

### Avoid Storing Raw Operational Detail by Default

Do not store full robot logs or full queue item payloads unless the customer explicitly approves the data classification and retention model. The app needs planning metrics, not a duplicate log warehouse.

## 6. Refresh and Aggregation Cadence

Recommended refresh cadence:

| Data Type | Cadence | Notes |
| --- | --- | --- |
| Runtime/session utilization | 5 minutes | Use recent active `Sessions` signals filtered by state and `ReportingTime` so disconnected history does not inflate connected-machine capacity. |
| Jobs and schedule projection | 5 to 15 minutes | Incremental by updated timestamp where possible. |
| Triggers and process metadata | 15 to 60 minutes | Metadata changes less frequently. |
| Machine template inventory | 15 to 60 minutes | Refresh faster during incident review if needed. |
| Duration percentiles | Daily plus incremental | Recalculate p90/p95 over rolling history. |

The UI must show:

- Last attempted refresh.
- Last successful refresh.
- Data source mode: not connected, live API, persisted metrics, or mixed.
- Partial access warnings.
- Endpoint failures, rate limits, and stale data indicators.

## 7. Analytics and Recommendation Logic

### Capacity Bucket Calculation

Each runtime bucket should include:

- Bucket start and end time.
- Tenant, folder, process, runtime type, and machine template dimensions.
- License allocation for the tenant.
- Configured max capacity for the selected machine-template scope.
- Observed peak consumed runtimes.
- Projected demand.
- Planning capacity.
- Utilization percentage.
- Risk band.
- Top drivers.

The primary business-facing utilization formula is:

```text
utilizationPct =
  peakConsumedRuntimes
  / planningCapacity
  * 100
```

`peakConsumedRuntimes` is calculated from job execution intervals inside the selected period. For each machine template and runtime type, the aggregation logic maps each job to its host machine or runtime lane, then uses a sweep-line calculation over job start/end events to find the highest number of concurrent consumed runtime lanes in the bucket.

Planning capacity is the binding constraint for the selected scope. When both signals are available, use the smaller of tenant license allocation and configured max capacity.

```text
configuredMaxCapacity =
  machineTemplateRuntimeSlots
  * connectedMachines

planningCapacity =
  min(tenantLicenseAllocation, configuredMaxCapacity)
```

Use this as the default heatmap and executive metric because it explains whether actual job demand fits within both the admin-assigned license allocation and the configured machine-template ceiling. Do not require the runtime to be busy for every minute of the period to call the capacity used. For example, if template A has two configured unattended runtimes and five connected machines, its configured max capacity is 10. If the tenant has 8 unattended licenses allocated, the planning capacity is 8.

Preferred lane identity is hostMachineName + userName, with robotName or session/executor identity as a secondary signal when user account is not exposed. Host machine name alone is not a safe runtime lane for HD robots; it is primarily used to map the job back to the machine template. If account/session identity is incomplete, fall back to active concurrent jobs capped by planning capacity and surface a data-health warning.

Secondary drill-down metric:

```text
slotMinuteSaturationPct =
  activeRuntimeLaneMinutes
  / (planningCapacity * bucketDurationMinutes)
  * 100
```

This is useful for operational tuning, but it is not the default business KPI for this app.

### What-If Scenario Impact

The what-if overlay must be explicit enough for business users to understand the change. After submission, the app should:

- Align planner date/hour and heatmap selected date/hour.
- Switch to day view for the submitted tenant-timezone slot.
- Apply runtime demand across the affected hourly or 15-minute buckets.
- Show the submitted scenario below the heatmap.
- Show baseline peak demand, projected peak demand, capacity, utilization change, and risk hours.
- Keep the global machine-template filter respected. When the filter is "All templates", the scenario should still be visible in the combined capacity view.

### Schedule Recommendation and Deferred AI

The current advisor is rules-backed and does not call an external model. Production AI/chat recommendations are deferred because the app's trust depends on accurate, explainable data:

- User provides basic automation details such as SLA, expected volume, queue spikes, or business context.
- User clicks the recommendation action.
- The app recommends a safer slot or action, with confidence, impact, rationale, and follow-up validation steps.
- User can apply the recommended slot before submitting the scenario to the heatmap.

Deferred production options:

- Deterministic rules-only advisor for regulated environments.
- UiPath LLM Gateway or approved OpenAI endpoint for natural-language explanation.
- Hybrid model where deterministic capacity calculations choose the slot and AI explains the tradeoffs.
- Persist recommendation audit records only after customer retention and data classification approval.

Risk bands:

| Band | Utilization | Meaning |
| --- | --- | --- |
| Green | Below 60% | Healthy capacity. |
| Yellow | 60% to 85% | Busy but acceptable. |
| Orange | 85% to 100% | Constrained window. |
| Red | Above 100% | Over capacity or likely runtime queueing. |

### Recommendation Types

| Recommendation | Trigger |
| --- | --- |
| Move schedule | A safer slot exists within the allowed business/SLA window. |
| Add runtime | No safe slot exists and projected peak exceeds tenant license allocation or configured max capacity. |
| Review host health | Disconnected machines or unavailable sessions may block execution even when license allocation and configured max capacity look sufficient. |
| Split workload | Long-running process creates avoidable peak demand. |
| Change window | Lower-priority schedules overlap with protected business periods. |

Every recommendation should include reason, expected impact, confidence, owner, and data basis.

## 8. Dependencies

### Runtime Dependencies

- React
- TypeScript
- Vite
- Lucide React

### UiPath Dependencies

- UiPath Automation Cloud tenant.
- UiPath Coded Web App packaging through `uip codedapp`.
- Non-confidential External Application for user-delegated sign-in.
- Orchestrator read APIs.
- Optional Data Fabric / Data Service entities for persisted metrics.
- Optional Data Export or customer-approved event stream for enterprise-scale history.
- Deferred UiPath LLM Gateway or approved OpenAI endpoint for AI-assisted explanations.

### Current App Dependencies

The current local implementation uses:

- `react`
- `react-dom`
- `typescript`
- `vite`
- `lucide-react`
- `@uipath/uipath-typescript`

### Developer Tooling

- Node.js and npm.
- UiPath CLI with coded app and Orchestrator tools.
- GitHub repository for source control.

## 9. Configuration

Recommended environment variables:

```text
VITE_UIPATH_CLIENT_ID=<external-app-client-id>
VITE_UIPATH_SCOPE=OR.Execution.Read OR.Folders.Read OR.Jobs.Read OR.License.Read OR.Machines.Read OR.Robots.Read OR.Settings.Read OR.Users.Read
VITE_UIPATH_ORG_NAME=<organization-name>
VITE_UIPATH_TENANT_NAME=<tenant-name>
VITE_UIPATH_BASE_URL=https://cloud.uipath.com
```

`VITE_UIPATH_TENANT_NAME` is case sensitive. Use the exact casing from Automation Cloud because Orchestrator API routes include the tenant name in the URL path.

Application configuration should also include:

- Default timezone.
- Refresh cadence.
- Data source mode.
- Critical process list.
- Business blackout windows.
- Runtime buffer target.
- Data retention policy for metric entities.
- Recommendation provider mode: disabled or rules-only; LLM provider modes remain deferred.

## 10. Deployment Path

### Local Development

```powershell
npm install
npm run dev
```

### Build

```powershell
npm run build
```

### Pack as UiPath Coded Web App

```powershell
uip codedapp pack dist --name "Runtime Capacity Intelligence" --version 0.1.0
```

### Publish and Deploy

After the External Application, app name, and target folder key are confirmed:

```powershell
uip codedapp publish
uip codedapp deploy --folder-key <folder-key>
```

Use a new version for each republish.

## 11. Operating Model

Recommended ownership:

| Area | Owner |
| --- | --- |
| External Application registration | UiPath admin / platform admin |
| App deployment | COE or platform engineering |
| Data model and aggregation cadence | COE / analytics owner |
| Business calendars and protected windows | Business owner plus COE |
| Runtime capacity decisions | COE plus executive sponsor |
| Incident triage and machine template health | Orchestrator admin |

## 12. Error Handling Requirements

The UI should surface errors before users trust the dashboard.

Required error states:

- Not signed in.
- Token expired.
- Missing scope.
- Tenant not reachable.
- Folder access denied.
- Endpoint timeout.
- Rate limit.
- Partial data loaded.
- Persisted metric data stale.
- Aggregation job failed.

Each error should include user-readable impact, technical detail for admins, and next action.

## 13. Recommended MVP Phases

### Phase 1: Demo and Story

- Keep live-only app behavior with an empty sign-in state when not connected.
- Finalize dashboard views.
- Build customer-facing deck and technical documentation.

### Phase 2: Live Read Connector

- Validate non-confidential External Application sign-in against a customer-approved tenant.
- Load license info, folders, jobs, triggers, paged machines, sessions, and machine-template signals by API where tenant permissions allow.
- Validate that regular users see only folder-scoped machine inventory, while users with the default `Orchestrator Administrator` role see the tenant-wide admin mode indicator and tenant-wide discovery results.
- Show data health states, endpoint failures, and partial-access diagnostics.
- Compare live output against customer-known runtime contention windows and machine-template capacity.
- Document final read-only scope and endpoint requirements.

### Phase 3: Persisted Metrics

- Add Data Fabric entities.
- Add scheduled aggregation job.
- Read heatmap and trends from curated metric entities.
- Keep AI/chat recommendation expansion deferred unless the roadmap is explicitly reopened after customer validation.

### Phase 4: Hardening

- Add tests for analytics and API failure paths.
- Add deployment automation.
- Add customer configuration guide.
- Add exportable planning report.

## 14. Open Decisions

- Final read-only scope list.
- Exact UiPath API endpoint and OAuth permission for tenant license allocation.
- Whether Data Fabric is enough for expected metric volume or whether enterprise customers should use Data Export plus external analytics storage.
- Whether what-if scenarios should be saved centrally or session-only.
- Whether the app should include a backend-for-frontend service or remain purely browser/SaaS SDK driven for MVP.
- Whether production heatmap buckets should be hourly, 15-minute, or configurable by tenant.
- Conditions for reopening AI/chat recommendations after customer validation proves the core utilization data is trusted.

## 15. Customer Pilot Checklist

Use this checklist when asking a customer to test the app against their UiPath Cloud environment.

### Customer Inputs

| Item | Needed For |
| --- | --- |
| UiPath environment | Confirm production, non-production, staging, or alpha base API URL. |
| Organization slug and exact case-sensitive tenant name | Build the OAuth and API configuration. |
| Non-confidential External App client ID | Enable browser sign-in without a client secret. |
| Redirect URI | Match the exact validation URL, for example `http://localhost:5173` or the deployed Coded Web App URL. |
| Read-only OAuth scopes | Permit folder, execution/job, machine, robot/session, trigger, calendar, queue, license, or Data Fabric reads as approved. |
| Pilot user assignment | Restrict visibility to customer-approved folders and machine templates, unless the approved pilot user has the default `Orchestrator Administrator` role for tenant-wide validation. |
| Known contention windows | Validate whether the app's heatmap and risk analysis match operational reality. |

### Guardrails

- MVP access is read-only and advisory.
- The app does not start, stop, retry, kill, update, or reschedule jobs.
- The browser app does not store client secrets.
- Tokens must not be logged, exported, screenshot, or persisted.
- Curated metrics may be stored in Data Fabric/Data Service only after customer data classification and retention approval.
- Raw queue item payloads, full robot logs, usernames/passwords, and secrets are out of scope by default.

### Success Criteria

- OAuth succeeds with the approved External App and redirect URI.
- Folder discovery returns expected pilot folders.
- Scoped Orchestrator reads return live records or clear partial-access messages.
- Runtime heatmap and schedule risk identify known contention windows.
- Machine template inventory aligns with customer-admin expectations.
- What-if scenario output is understandable enough for release/scheduling discussion.
- The team can decide whether the production path should stay browser-only or add persisted metrics/aggregation.

## 16. Related Technical References

- `docs/uipath-runtime-concepts-and-api-reference.md` explains customer-facing runtime concepts, machine templates, host machines, sessions, concurrent unattended jobs, Automation Cloud Robots - VM, Automation Cloud Robots - Serverless, current API endpoints touched by the app, field mappings, recommended next endpoints, and validation questions.
