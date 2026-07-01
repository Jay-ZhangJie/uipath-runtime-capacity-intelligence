# Runtime Capacity and Schedule Intelligence - PDD

## 1. Purpose

Organizations running time-critical unattended automations often lack a single planning view that connects robot runtime licenses, machine templates, process schedules, job history, queue demand, and business SLAs. This solution provides a reusable web application for visibility, schedule planning, and capacity decision support across UiPath environments.

The reference deployment target is UiPath Automation Cloud, while the design should remain portable enough to support Automation Suite or on-premises Orchestrator with adjusted connectivity and authentication.

## 2. Business Challenge

UiPath administrators, COE teams, and business owners need to know whether unattended automations can run on time with the available runtime capacity. Current visibility is often fragmented across Orchestrator Monitoring, Insights, Power BI, manual spreadsheets, and custom collectors.

Common pain points:

- Time-critical jobs compete for the same unattended runtimes.
- New production deployments are difficult to schedule without causing collisions.
- License shortages are discovered after jobs are already pending, skipped, or delayed.
- Machine template usage is hard to translate into business-facing availability.
- Queue spikes and month-end volume can change the runtime demand profile.
- Historical reporting shows what happened, but not always what will happen next.

## 3. Solution Vision

Create a customer-facing web application that turns UiPath operational data into a runtime capacity planning experience.

The application should answer:

- Which time windows are safe for new unattended automation schedules?
- Which folders, processes, or machine templates drive peak runtime demand?
- Where do schedules overlap with historical job duration patterns?
- How many additional unattended runtimes are needed for a given SLA?
- Which automations are at risk during peak volume periods?
- What changes would reduce runtime contention without purchasing more licenses?

## 4. Personas

| Persona | Needs |
| --- | --- |
| Business Owner | Understand whether critical automations are likely to complete within SLA. |
| COE Lead | Plan production deployments, review capacity trends, and justify license requests. |
| Orchestrator Admin | Inspect machine template capacity, sessions, triggers, queues, and conflicts. |
| Release Manager | Find safe deployment time slots for new or changed automations. |
| Executive Sponsor | See high-level utilization, risk, and investment recommendations. |

## 5. Scope

### In Scope

- Runtime/license utilization dashboard.
- Schedule heatmap by day, hour, folder, process, and machine template.
- Time-trigger inventory and conflict detection.
- Historical job duration analysis.
- Machine template capacity view.
- What-if schedule simulation.
- Best time-slot recommendation for new automations.
- License need estimation based on expected concurrency.
- Demo dataset for customer presentations.

### Out of Scope for MVP

- Automatic trigger updates in Orchestrator.
- Real-time job control, stop, kill, or retry actions.
- Full replacement for UiPath Insights.
- Financial chargeback calculations.
- Tenant-wide security administration.
- Queue item business-data inspection beyond summarized volume and SLA patterns.

## 6. Confirmed Direction

The reference customer environment is UiPath Automation Cloud with Insights and real-time dashboards enabled. The reusable product direction should still remain generic, so the app should be presented as a tenant-connected advisory tool rather than a customer-specific dashboard.

Confirmed MVP direction:

- Automation Cloud first.
- Direct UiPath API access first, not SQL-first.
- User-delegated authentication through a non-confidential external application.
- User signs into the target tenant and sees only what their UiPath permissions allow.
- Read-only advisory mode.
- Personas: business owner, COE, and administrator.
- Business calendars, blackout windows, and critical periods should be part of the planning model.

## 7. Current-State Process

Many customers already use Orchestrator Monitoring, Insights, real-time dashboards, or custom reporting to understand historical utilization. Some also collect runtime or license utilization snapshots on a periodic schedule, often every 5 minutes, store the data in SQL, and report through Power BI. This provides useful historical visibility but often lacks interactive schedule simulation and deployment planning.

Current-state limitations:

- Data is available but not decision-oriented.
- Heatmaps may show usage but not recommended actions.
- Schedule metadata and runtime history may not be modeled together.
- Business users may depend on admins to interpret operational dashboards.
- New automations are scheduled through tribal knowledge and manual review.

## 8. Future-State Process

1. The user opens the app and selects or signs into a target UiPath tenant.
2. The app uses user-delegated API access to read Orchestrator and related operational data.
3. The app builds an in-memory or persisted normalized model of folders, processes, triggers, machine templates, sessions, jobs, queues, and runtime capacity.
3. Users review utilization, hot spots, and forecasted schedule collisions.
4. Release teams simulate proposed schedules for new or changed automations.
5. The app recommends safe time slots or required capacity changes.
6. COE/admin teams use the recommendation to adjust schedules, capacity, or deployment timing.

## 9. MVP Features

### Executive Overview

- Current unattended runtime allocation.
- Peak concurrent runtime usage.
- Average utilization by date range.
- At-risk schedules.
- Top conflicting folders/processes.
- Recommendation summary.

### Runtime Heatmap

- Day-of-week and hour-of-day heatmap.
- Filter by date range, folder, process, runtime type, and machine template.
- Color bands for idle, normal, constrained, and over-capacity windows.

### Schedule Planner

- List of existing time triggers.
- Projected runtime demand by trigger.
- Historical p50, p75, p90, and p95 job durations.
- Collision warnings.
- Safe-slot recommendations.

### Machine Template Capacity

- Machine template inventory.
- Assigned unattended runtime count.
- Connected machines and sessions.
- Busy, idle, disconnected, and maintenance indicators.
- Runtime availability by folder.

### What-If Simulator

- Add a proposed automation.
- Set expected duration, frequency, priority, folder, runtime type, and SLA window.
- Compare current vs proposed utilization.
- Estimate additional runtime need if no safe slot exists.

## 10. Data Sources

Preferred source order:

1. Direct UiPath APIs through user-delegated external app authentication.
2. UiPath Insights and real-time dashboards as validation/reference data.
3. Existing SQL-based collector, where a customer already has one and wants to reuse it.
4. Manual CSV imports for demo or early discovery.

Reference UiPath entities:

- Tenants.
- Folders.
- Processes/releases.
- Jobs.
- Time triggers.
- Queue triggers.
- Queues and queue items.
- Machines and machine templates.
- Unattended sessions.
- Runtime/license capacity.
- Calendars and excluded days.

## 11. Business Rules

- Runtime capacity should be calculated by runtime type and machine template where available.
- Schedule risk should use historical job duration percentiles, not only average duration.
- Proposed schedules should be evaluated against existing scheduled demand and observed peak demand.
- Critical automations should reserve buffer capacity before lower-priority automations.
- Calendar exclusions and time zones must be respected.
- Business blackout windows, month-end windows, and priority periods must be configurable.
- The application should not modify Orchestrator schedules in MVP.
- The application must not show data the signed-in user cannot already access in UiPath.

## 12. Non-Functional Requirements

- Web application must be presentation-ready with demo data.
- App should support multiple tenants or environments conceptually.
- Data refresh should support a 5-minute cadence, but the UI should clearly show freshness.
- Role-based views should separate business-friendly summary from admin detail.
- Data model should avoid customer-specific hardcoding.
- Configuration should support Automation Cloud first.
- MVP should run without a database if using live API queries and session-scoped cache.
- Optional persistence may be added for history, scenario saving, performance, or offline reporting.

## 13. Success Criteria

- Users can identify peak license usage windows in less than 2 minutes.
- Users can find recommended schedule slots for a new automation.
- COE can explain license constraints visually to business stakeholders.
- Admins can trace a capacity warning back to specific processes and triggers.
- The app can run with demo data without customer connectivity.
- The design can be reused across multiple UiPath customers.

## 14. Open Questions

- What minimum date range is needed for meaningful planning: 30, 90, 180, or 365 days?
- Should queue backlog be included in v1 recommendations or v2?
- Should business calendars and blackout periods be configured in the app or read from Orchestrator calendars?
- Which roles should have access to detailed machine/session data?
- Should scenario plans be saved centrally, exported as files, or kept session-only in MVP?
