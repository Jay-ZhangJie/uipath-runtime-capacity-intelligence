# Runtime Capacity and Schedule Intelligence - SDD

## 1. Solution Summary

Runtime Capacity and Schedule Intelligence is a reusable web application for UiPath unattended automation planning. It combines runtime utilization, machine template capacity, schedules, job history, and queue demand to help customers avoid license contention and find safe schedule windows for production automations.

The reference implementation targets UiPath Automation Cloud and is designed to remain portable for other UiPath deployment models through configurable data connectors.

## 2. Architecture Overview

The solution is organized into five layers:

| Layer | Responsibility |
| --- | --- |
| Data Connectors | Read UiPath data through user-delegated APIs and optional existing SQL collectors. |
| Normalized Store | Hold jobs, triggers, machines, folders, utilization snapshots, and computed capacity facts in memory or persistence. |
| Analytics Engine | Calculate concurrency, schedule collisions, duration percentiles, heatmap buckets, and recommendations. |
| API Layer | Serve dashboards, filters, planner requests, and what-if simulations. |
| Web UI | Provide role-specific views for business owners, COE teams, and administrators. |

## 3. Reference Deployment

### Automation Cloud Reference

- Authentication uses a non-confidential UiPath external application with user scopes and redirect URI.
- Users sign into the target tenant interactively; data access follows the signed-in user's UiPath permissions.
- Data is collected directly from UiPath APIs, with Insights used as validation/reference data where available.
- Existing SQL collectors can be reused when present.
- Application can be hosted internally, on Azure App Service, or another customer-approved platform.

### Portable Deployment Considerations

- Deployment-specific settings are isolated in connector configuration.
- API contracts and database schema avoid Automation Cloud-only naming where possible.
- Time zone, tenant, folder, and environment identifiers are stored explicitly.

## 4. Data Acquisition

### Preferred MVP Pattern

Use direct UiPath APIs with user-delegated access. The app should not use a client secret in the frontend or act as a broad service account. A non-confidential external app supports a browser-based sign-in flow and user scopes only; the app should request read-only scopes required for folders, jobs, triggers, machines, sessions, queues, and license/capacity views.

The `uip` CLI remains useful during development and diagnostics because it handles folder headers, tenant context, pagination, filters, and authentication shapes correctly. The production app can use equivalent API calls once the required endpoints and scopes are confirmed.

### Connector Options

| Option | Best For | Notes |
| --- | --- | --- |
| Direct UiPath APIs | MVP and reusable customer-facing app | Primary path. Uses signed-in user context and read-only scopes. |
| Insights Real Time Data Export | Enterprise operational stream | Optional enhancement where available and approved. |
| Existing SQL Collector | Customers with established telemetry | Reuse current data and add missing dimensions when needed. |
| `uip` CLI-assisted extraction | Development, discovery, and endpoint validation | Useful for jobs, triggers, machines, sessions, folders. |
| CSV Demo Import | Presentations and offline demos | Enables generic customer showcase. |

### Refresh Strategy

- Snapshot refresh target: every 5 minutes for utilization and sessions.
- Metadata refresh target: every 15 to 60 minutes for folders, processes, triggers, machines.
- Historical analysis refresh target: daily backfill plus incremental job updates.
- UI must display last refreshed timestamp and source health.

## 5. Data Model

Core tables or collections. These can start as client/server memory objects for the MVP and move to a database only when persistence is needed.

| Entity | Key Fields |
| --- | --- |
| Environment | environmentId, name, platformType, timeZone |
| Tenant | tenantId, environmentId, name |
| Folder | folderId, tenantId, parentFolderId, name |
| Process | processId, folderId, name, packageName, version |
| Trigger | triggerId, processId, folderId, type, cron, timeZone, enabled, priority |
| Job | jobId, processId, folderId, startTime, endTime, state, runtimeType, machineId |
| MachineTemplate | machineTemplateId, tenantId, name, runtimeCapacity |
| Machine | machineId, machineTemplateId, name, status |
| Session | sessionId, machineId, runtimeType, status, inUse, lastHeartbeat |
| RuntimeSnapshot | snapshotTime, folderId, machineTemplateId, runtimeType, total, used, available |
| QueueMetric | bucketStart, queueId, folderId, newItems, inProgress, failed, slaRisk |
| CapacityBucket | bucketStart, bucketEnd, dimensions, expectedDemand, observedDemand, capacity, riskScore |
| Recommendation | recommendationId, scenarioId, type, impact, confidence, explanation |

### Persistence Decision

A database is not required for the first read-only API MVP if the app calculates the dashboard from live API calls plus short-lived cache. Add persistence when the solution needs:

- Faster repeated queries across large date ranges.
- Historical data beyond efficient API query windows.
- Saved what-if scenarios and recommendation history.
- Multi-user shared planning sessions.
- Offline demo/report export from customer data.
- Scheduled background refresh independent of a signed-in user.

Recommended progression:

1. Demo data and in-memory calculations.
2. Live API with session cache.
3. Lightweight local persistence for scenario saving.
4. SQL Server or Azure SQL for enterprise deployment.

## 6. Analytics Design

### Runtime Heatmap

The heatmap groups observed and projected runtime demand into configurable time buckets, typically 15 minutes or 1 hour.

Supported view grains:

- Day: detailed hour or 15-minute buckets for operational review.
- Week: day/hour grid for schedule planning.
- Month: daily peak, average, and risk windows.
- Year: monthly or weekly aggregation for trend and capacity planning.

For large tenants, the year view should not fetch raw job and session detail on every page load. Use aggregated buckets, short-lived cache, or persisted facts when querying long historical windows.

Risk bands:

- Green: demand below 60 percent of capacity.
- Yellow: demand between 60 and 85 percent of capacity.
- Orange: demand between 85 and 100 percent of capacity.
- Red: demand exceeds capacity or historical pending jobs indicate runtime contention.

### Duration Profile

For each process and folder combination:

- Calculate p50, p75, p90, and p95 job duration.
- Track day-of-week and hour-of-day variation.
- Exclude cancelled and faulted jobs from baseline duration unless configured otherwise.
- Preserve faulted counts as separate operational risk indicators.

### Schedule Projection

For each enabled time trigger:

1. Expand cron expression into future run windows.
2. Apply trigger time zone and calendar exclusions.
3. Estimate runtime demand using selected duration percentile.
4. Overlay all projected runs onto capacity buckets.
5. Score collisions by priority, SLA, runtime type, and available capacity.

### Best-Slot Recommendation

For a proposed automation:

1. Accept folder, process category, expected duration, recurrence, runtime type, priority, and SLA window.
2. Generate candidate slots inside allowed windows.
3. Reject slots that exceed runtime capacity under p90 or p95 assumptions.
4. Rank remaining slots by available buffer, historical queue demand, and business calendar fit.
5. Return recommended slots and explain tradeoffs.

### Dynamic Recommendation Engine

Recommendations are calculated from current filters and user-visible data. They should not be hardcoded messages.

Input signals:

- Signed-in user's accessible tenants and folders.
- Enabled time triggers and projected run windows.
- Historical job duration percentiles by process, folder, and time period.
- Runtime capacity by folder, runtime type, and machine template.
- Unattended session status and disconnected hosts.
- Queue volume and SLA risk where available.
- Business blackout windows, month-end windows, and critical process priorities.

Recommendation types:

- Move schedule: a lower-risk slot exists in the allowed SLA window.
- Add runtime: no safe slot exists and projected demand exceeds capacity.
- Restore capacity: disconnected machines or unavailable sessions reduce effective capacity.
- Split workload: one long automation should be split or queue-triggered to reduce peak contention.
- Change priority/window: lower-priority schedules conflict with critical automations.

Every recommendation should include:

- Reason.
- Expected impact.
- Confidence level.
- Required action owner.
- Data basis, such as "90 days of job history" or "next 14 days of trigger projection".

### License Need Estimation

If no safe slot exists, estimate additional runtime need:

`requiredAdditionalRuntimes = max(0, projectedPeakDemand - availableCapacity + bufferRuntimes)`

The buffer can be configured globally or by criticality.

## 7. API Design

Representative endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/environments` | List configured environments and tenants. |
| `GET /api/filters` | Return folder, process, machine template, runtime type, and date filter values. |
| `GET /api/overview` | Executive KPI summary. |
| `GET /api/heatmap` | Runtime utilization and risk buckets. |
| `GET /api/schedules` | Trigger inventory with projected risk. |
| `POST /api/planner/simulate` | Run what-if schedule simulation. |
| `POST /api/planner/recommend` | Return best schedule slots. |
| `GET /api/machine-templates` | Machine template capacity and session summary. |
| `GET /api/jobs` | Drilldown job history. |
| `GET /api/recommendations` | Current recommended actions. |

### UiPath API Access Pattern

The app's backend-for-frontend should receive the user's delegated token or a server-side session reference, then call UiPath APIs using that user's context. The app should keep all operations read-only for MVP.

Required API capability groups:

- Tenant and folder discovery.
- Process/release metadata.
- Job history.
- Time and queue triggers.
- Machine and machine template inventory.
- Unattended sessions and runtime availability.
- Queue summary metrics.
- Calendar and excluded-day metadata.
- License/runtime capacity views where accessible.

The UI must handle partial access gracefully. For example, a business owner may see high-level risk but not all machine/session details if their UiPath permissions are limited.

## 8. UI Design

### Page 1: Executive Overview

- Capacity health score.
- Peak runtime demand vs available capacity.
- Critical automations at risk.
- Recommended schedule changes.
- License need estimate.

### Page 2: Runtime Heatmap

- Date range and dimension filters.
- Day, week, month, and year view grains.
- Tooltip with observed demand, projected demand, capacity, top processes, and risk explanation.
- Toggle between observed, projected, and combined demand.

### Page 3: Schedule Planner

- Existing schedule timeline.
- Proposed automation panel.
- Recommended slots.
- Collision details.
- Folder-level, process-level, job-level, and SLA-exception views.
- Exportable recommendation summary.

### Page 4: Machine Template Capacity

- Machine template utilization.
- Connected, busy, idle, disconnected, and maintenance sessions.
- Folder runtime assignment summary.
- Capacity by runtime type.

### Page 5: Drilldown

- Jobs by process/folder.
- Duration distribution.
- Queue trend.
- Trigger history and failure reasons where available.

## 9. Security and Access

Recommended roles:

| Role | Access |
| --- | --- |
| Viewer | Executive overview and heatmap summary. |
| Planner | Schedule simulation and recommendation views. |
| Admin | Connector configuration, machine/session details, and data refresh status. |

Security requirements:

- Use non-confidential external app configuration for the user-facing app.
- Do not store a client secret in the browser.
- Request read-only user scopes only.
- Respect the signed-in user's UiPath permissions.
- Avoid storing robot credentials.
- Avoid queue item payloads unless explicitly approved.
- Log data refresh health without exposing access tokens.
- Support tenant/environment scoping.
- Keep MVP read-only: no trigger updates, no job starts/stops, no queue item edits.

## 10. Configuration

Configuration should include:

- Environment name.
- Platform type: Automation Cloud, Automation Suite, or on-prem.
- Tenant identifier.
- Default time zone.
- Data source mode.
- External app client ID.
- Redirect URI.
- Requested read-only user scopes.
- Refresh cadence.
- Runtime capacity buffer.
- Critical process list.
- Business blackout windows.
- Date retention policy.

## 11. MVP Implementation Plan

### Phase 1: Demo and Discovery Build

- Create static demo dataset.
- Build dashboard shell.
- Implement overview, heatmap, schedule planner, and machine template mock views.
- Validate storyline with internal stakeholders.

### Phase 2: Data Model and Local API

- Implement normalized in-memory schema.
- Load demo CSV/JSON data.
- Add API endpoints for heatmap, schedules, and recommendations.
- Add calculation tests for capacity buckets and recommendation logic.

### Phase 3: UiPath Connectivity

- Add user-delegated UiPath API connector through non-confidential external app authentication.
- Add trigger and job metadata ingestion.
- Add machine/session/runtimes ingestion.
- Validate against a customer-like tenant.

### Phase 4: Hardening

- Add authentication and role-based access.
- Add refresh observability.
- Add exportable recommendation report.
- Package deployment instructions.

## 12. Testing Strategy

Functional tests:

- Heatmap returns correct risk bands for known capacity and demand.
- Trigger projections respect time zones.
- Disabled triggers are excluded from projected demand.
- Proposed automation simulation identifies capacity collisions.
- Machine template page correctly summarizes total, used, and available runtimes.

Data tests:

- Missing end times are handled for running jobs.
- Faulted and cancelled jobs are excluded or included according to configuration.
- Duplicate job records do not inflate demand.
- Snapshot gaps are visible in source health indicators.
- Limited-permission users receive clear partial-data states instead of errors.

Scenario tests:

- Normal day with available capacity.
- Month-end peak with runtime overcommit.
- New high-priority automation requiring safe-slot recommendation.
- Disconnected machine reducing available capacity.
- License increase reducing risk score.

Presentation tests:

- App loads with demo data without external connectivity.
- All views work with generic environment names.
- Screens can be explained without customer-specific context.

## 13. Assumptions

- MVP is read-only and advisory.
- Automation Cloud is the first reference platform.
- Customer environments may already have Insights and real-time dashboards enabled.
- Direct UiPath API access is the primary product path.
- Non-confidential external app authentication is preferred for user-delegated access.
- Demo data must be available for generic presentations.
- Runtime planning should prioritize unattended robot runtimes.
- Customer-specific connector details will be configured later.

## 14. Open Decisions

- Frontend framework: React + TypeScript is recommended.
- Backend framework: Node/Express or .NET API are both viable.
- Database: defer until live API performance, history, or shared scenario requirements justify it.
- Authentication implementation details: exact UiPath user scopes and redirect URI configuration.
- Production connector fallback: whether to support Insights export or customer SQL collector as optional add-ons.

## 15. Planner Handoff

<!-- planner-handoff:v1 -->

- Execution autonomy: Interactive.
- SDD scope: Custom web application with UiPath data connectors.
- Project list section: MVP Implementation Plan.
- Tasks file: `tasks.md` to be generated after architecture approval.
- Generated by: Codex.
- Generation date: 2026-07-01.
