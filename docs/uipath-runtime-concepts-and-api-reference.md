# UiPath Runtime Concepts and API Reference

This document explains the UiPath runtime concepts behind Runtime Capacity Intelligence and documents the UiPath Cloud / Orchestrator API surface the app currently uses or should validate next.

Audience: customer COE leads, Orchestrator administrators, platform owners, release managers, and security reviewers.

Last updated: 2026-07-07

## 1. Why This Document Exists

Runtime capacity analysis sits in a gray area between licensing, infrastructure, Orchestrator scheduling, robot sessions, and job history. The same business symptom, such as a job waiting too long, can come from different causes:

- The process was scheduled into a busy runtime window.
- Assigned unattended runtimes are insufficient for the overlapping schedule demand.
- A host machine is disconnected or has no available session.
- A robot account cannot log into one of the hosts assigned to the template.
- A process is using serverless or cloud robot capacity instead of customer-managed hosts.
- Historical job data is outside Orchestrator retention and needs persisted metric snapshots.

This app is intentionally read-only. It helps customers see and explain these relationships; it does not start, stop, retry, kill, update, or reschedule jobs.

## 2. Runtime Concept Map

```text
Organization
  Tenant
    Folder
      Process / Release
      Trigger / Schedule
      Job
      Robot account or user assignment
      Machine template assignment
    Machine template
      Configured runtimes / slots
      One or more connected host machines or cloud robot capacity
    Session
      Robot + machine/host availability signal
```

The most important customer-facing distinction:

- A **machine object** is an Orchestrator configuration object.
- A **host machine** is the physical or virtual Windows/Linux machine where a UiPath Robot is installed, unless the process uses a UiPath-managed cloud robot option.
- A **machine template** lets multiple host machines connect to Orchestrator using the same template configuration.
- A **runtime** is execution capacity. One available runtime generally allows one unattended automation job to execute at a time.
- A **job** is one execution of a process. Concurrent unattended jobs consume concurrent runtime capacity.

## 3. Core Concepts

### Runtime

A runtime is the unit of unattended execution capacity assigned at the machine-template level. For the capacity planning use case, the working rule is:

- 1 available unattended runtime = 1 unattended automation can run at a time.
- 2 available unattended runtimes = 2 concurrent unattended jobs can run, either on the same host where supported or across hosts associated with the machine template.

UiPath documentation states that runtimes are service licenses dedicated to unattended automations and are taken from the tenant pool, then assigned at the machine-template level. It also describes the one-runtime/one-automation relationship. See official reference: https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/how-is-unattended-automation-performed

How the app uses this:

- `tenantLicenseAllocation` is the static runtime allocation assigned to the tenant by an admin. The live connector reads the active runtime family from `odata/Settings/UiPath.Server.Configuration.OData.GetLicense` when permitted, including Unattended, Testing/Test Automation, and NonProduction values.
- `templateRuntimeSlots` comes from machine runtime slot fields such as `UnattendedSlots`, `AutomationCloudSlots`, `HeadlessSlots`, `NonProductionSlots`, and `TestingSlots`.
- `connectedMachines` comes from session/host signals where available. If sessions are not exposed, the app clearly falls back to counting each returned template once.
- `configuredMaxCapacity = templateRuntimeSlots * connectedMachines`.
- `actualDemand` comes from observed/projected concurrent jobs.
- `utilization = actualDemand / planningCapacity`, where `planningCapacity` is the smaller of license allocation and configured max capacity when both are known.

Gray area:

- Slot field names and availability vary by tenant version, license model, and endpoint response shape.
- Serverless robots and Automation Cloud Robots may not behave like customer-managed host machines.
- Production-grade analysis should validate the exact source of runtime/license utilization for the customer tenant.

### Host Machine

A host machine is the physical or virtual computer where UiPath Robot is installed and executes processes. In unattended Windows scenarios, a service-mode robot is recommended because it can manage Windows sessions automatically.

UiPath documentation distinguishes a machine object in Orchestrator from a host machine, which is the workstation or virtual machine on which the Robot is installed. See official reference: https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/about-machines

How the app uses this:

- Host-level availability is inferred from `Sessions` fields such as `State`, `MachineName`, `HostMachineName`, `RobotName`, `RuntimeType`, and folder fields.
- A disconnected or unavailable host can prevent a job from executing even when license allocation and configured max capacity look sufficient.

Gray area:

- Host names in job, session, and machine responses are not always consistent.
- Some tenants expose `HostMachineName`; others expose `MachineName`, nested `Machine`, or robot-related fields.
- The app defensively maps multiple possible field names and surfaces partial data warnings.

### Machine Object

A machine object is an Orchestrator resource that authorizes Robot-to-Orchestrator connectivity, controls execution capacity, and specializes host machines for process execution. Machine objects are global resources available across folders.

How the app uses this:

- The app reads `odata/Machines` and maps machine objects into dashboard machine-template inventory rows.
- It uses machine slot fields as the per-template runtime-slot setting.
- It uses related sessions to count connected machines for configured max capacity.

Important customer question:

- Are the machine objects returned by the API the same machine templates the COE uses for unattended runtime planning?

### Machine Template

A machine template is the recommended Orchestrator machine type for unattended automation. It defines shared configuration once and allows multiple host machines with similar setup to connect to Orchestrator.

UiPath documentation recommends grouping host machines under a machine template when they share configuration, installed applications, paths, versions, and access rights. See official reference: https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/useful-concepts-in-unattended-automation

How the app uses this:

- Machine templates are the main inventory dimension for configured max capacity.
- Filters let users analyze all templates or a selected template.
- The recommendation engine should explain whether risk comes from license allocation, configured max capacity, schedule overlap, or host/session health that may block execution.

Gray area:

- If a template includes hosts that are not truly equivalent, runtime availability can be misleading. A job may be theoretically schedulable but fail because the selected host lacks an application, version, credential, or user mapping.
- For customer pilots, confirm that each machine template represents a coherent execution pool.

### Robot, Robot Account, and Session

A UiPath Robot is the execution entity. A robot account is a non-user identity used to run unattended back-office automations. A session is a runtime availability signal that combines robot, machine, state, and timing.

How the app uses this:

- The app does not read or store robot credentials.
- The app reads session status to infer whether runtime capacity is actually available.
- Useful session states include `Available`, `Busy`, `Connected`, and unavailable/error states returned by the tenant.

Relevant API reference: https://docs.uipath.com/orchestrator/automation-cloud/latest/api-Guide/robots-requests

### Process / Release

In Orchestrator API terms, processes are commonly represented through the `Releases` entity set. A release connects a package/process version to an Orchestrator execution context.

How the app uses this:

- The current live connector derives process summaries mainly from trigger/schedule records.
- A future connector pass should optionally read `odata/Releases` directly for richer process metadata, including process key, version, package name, and deleted/latest-version indicators.

Relevant API reference: https://docs.uipath.com/orchestrator/automation-cloud/latest/api-Guide/processes-requests

### Trigger / Schedule

A trigger defines when and how a process should start. Time triggers use cron-style schedule fields and timezone fields. Queue triggers and API triggers may use different fields.

How the app uses this:

- The current connector reads `odata/ProcessSchedules` in each selected folder during heatmap generation.
- It maps schedule fields into projected demand and schedule risk rows.
- The current MVP treats each enabled trigger as one unit of runtime demand unless more precise demand data is available.

Key gray area:

- `StartStrategy` can represent dynamic allocation and may create multiple jobs depending on strategy and folder context. For precise capacity projection, the app must validate `StartStrategy`, `MachineRobots`, and queue trigger behavior with the customer tenant.

Relevant API reference: https://docs.uipath.com/orchestrator/automation-cloud/latest/api-Guide/schedules-requests

### Job

A job is a specific process execution. Job history is the strongest signal for observed runtime demand and historical duration.

How the app uses this:

- The current connector reads recent jobs by folder and maps `StartTime`, `EndTime`, `CreationTime`, `State`, `Source`, process name, host machine, runtime type, and package type.
- Historical buckets use job timestamps in UTC, converted into the configured tenant/business timezone.
- Duration is estimated from `StartTime` to `EndTime`; if `EndTime` is missing, the app conservatively treats the observed demand as one hourly bucket.

Relevant API reference: https://docs.uipath.com/orchestrator/automation-cloud/latest/api-Guide/jobs-requests

### Period Runtime License Usage

The app's primary usage metric is designed to answer: "During this selected hour, day, week, or month, how much of the binding planning capacity was actually consumed at peak?"

This is intentionally different from a minute-perfect capacity saturation metric. A one-hour period does not need to show 60 minutes of runtime use to be considered fully used. If a machine template has two configured unattended runtimes and job execution shows two runtime lanes active at the same time during the hour, the period's runtime license usage is 100% for that template and runtime type.

Primary formula:

```text
periodUsagePct(B, T, R) =
  peakConsumedRuntimes(B, T, R)
  / planningCapacity(T, R)
  * 100
```

Where:

```text
B = selected time bucket, such as 15 minutes, 1 hour, 1 day, 1 week, or 1 month
T = machine template or "All templates"
R = runtime type, such as Unattended
tenantLicenseAllocation(R) = admin-assigned tenant allocation for runtime type R
configuredMaxCapacity(T, R) = templateRuntimeSlots(T, R) * connectedMachines(T)
planningCapacity(T, R) = min(tenantLicenseAllocation(R), configuredMaxCapacity(T, R)) when both are known
```

For each job:

```text
executionStart = StartTime
executionEnd = EndTime, or "now" for currently running jobs
activeInBucket(job, B) = executionStart < bucketEnd AND executionEnd > bucketStart
machineTemplate(job) = template mapped from job machine id, host machine name, related session, or machine inventory
runtimeType(job) = job runtime type when exposed, otherwise inferred from process/run context
```

For each point in the bucket:

```text
activeRuntimeLanes(t, T, R) =
  distinct runtime lanes with active jobs at time t
  where machineTemplate(job) = T
  and runtimeType(job) = R

peakConsumedRuntimes(B, T, R) =
  max(activeRuntimeLanes(t, T, R)) for all event timestamps t in B
```

Preferred runtime lane identity:

```text
runtimeLaneKey = hostMachineName + userName, or hostMachineName + robot/session/executor signal when userName is not exposed
```

Fallbacks, in order:

1. If the tenant exposes session or executor identifiers, count distinct active runtime lanes.
2. If only host machine is reliable and each host represents one unattended lane for the template, count distinct active host machines.
3. If no host/session lane is reliable, count active concurrent jobs and cap the result at `planningCapacity(T, R)`.

Example:

```text
Bucket: 10:00-11:00
Machine template A configured unattended runtimes: 2

Scenario 1:
Jobs overlap so that host-01 and host-02 are both active at 10:25.
peakConsumedRuntimes = 2
periodUsagePct = 2 / 2 * 100 = 100%

Scenario 2:
All completed jobs run on host-01, with no second active runtime lane.
peakConsumedRuntimes = 1
periodUsagePct = 1 / 2 * 100 = 50%
```

Optional secondary saturation metric:

```text
slotMinuteSaturationPct(B, T, R) =
  sum(active runtime lane minutes within B)
  / (planningCapacity(T, R) * bucketDurationMinutes)
  * 100
```

This secondary metric is useful for deep operations analysis, but the app should not use it as the default executive/business heatmap value because the product goal is to show license capacity consumption patterns, not to encourage every runtime to be busy every minute.

### Concurrent Unattended Jobs

Concurrent unattended jobs are multiple unattended process executions running at the same time. Concurrency is constrained by a mix of:

- Available runtimes/licensed slots.
- Machine-template capacity.
- Online host/session availability.
- Robot account and folder assignments.
- Process compatibility with the selected host or serverless runtime.
- Trigger `StartStrategy` and queue backlog.

How the app uses this:

- Each overlapping job contributes to the period's observed runtime-lane concurrency for the heatmap bucket.
- Each projected trigger or what-if scenario contributes projected demand.
- Risk bands compare demand to available capacity:
  - Green: below 60%
  - Yellow: 60% to 85%
  - Orange: 85% to 100%
  - Red: above 100%

### Automation Cloud Robots - VM

Automation Cloud Robots - VM are UiPath-managed virtual machines for running automations. UiPath handles the infrastructure behind the scenes and provides a VM; the customer configures it and runs jobs.

Official reference: https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/about-automation-cloud-robots-vm

Capacity implication:

- VM-based cloud robots still have machine/runtime capacity behavior, but the host lifecycle and ownership differ from customer-managed infrastructure.
- The app should distinguish customer-managed machine templates from Automation Cloud Robot pools when endpoint fields allow it.

### Automation Cloud Robots - Serverless

Serverless robots run background automation without the customer provisioning or managing containers, VMs, or physical servers. UiPath handles the underlying infrastructure.

Official reference: https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/automation-cloud-robots-serverless

Capacity implication:

- Serverless capacity should not be explained to customers as "host machines are offline" or "machine template hosts are disconnected."
- Serverless analysis should focus on job demand, process compatibility, machine size/cost, platform unit or robot unit consumption, and endpoint visibility.
- The current app can show job and trigger demand, but serverless-specific capacity/cost logic is a follow-up validation item.

## 4. API Base, Authentication, and Folder Scope

The app uses a non-confidential External Application and browser OAuth. It requests user-delegated, read-only scopes and respects the signed-in user's Orchestrator permissions. Tenant-wide discovery is enabled only when role discovery returns the exact UiPath default `Orchestrator Administrator` role.

Tenant names are case sensitive in the Orchestrator URL path. Use the exact tenant casing shown in Automation Cloud when configuring the app or connection profile.

Base URL pattern:

```text
https://cloud.uipath.com/{organizationName}/{tenantName}/orchestrator_/
```

For staging or alpha environments, use the matching Automation Cloud domain:

```text
https://staging.uipath.com/{organizationName}/{tenantName}/orchestrator_/
https://alpha.uipath.com/{organizationName}/{tenantName}/orchestrator_/
```

The connector calls the configured Automation Cloud URL directly. If the tenant, External App, signed-in user, endpoint, or browser blocks the request, the app surfaces the returned status or browser fetch error in API diagnostics.

UiPath's API guide documents the Orchestrator URL pattern and states that folder-scoped resources require a folder header such as `X-UIPATH-OrganizationUnitId`, `X-UIPATH-FolderPath`, or `X-UIPATH-FolderKey`. See official reference: https://docs.uipath.com/orchestrator/automation-cloud/latest/api-guide/building-api-requests

Current app behavior:

- Tenant-level discovery calls do not include a folder header.
- Role discovery probes the current-user endpoint and only treats the exact normalized role name `orchestrator administrator` as admin mode.
- Regular-user machine inventory is assembled from machine reads scoped to the discovered folder list.
- Orchestrator Administrator mode adds tenant-wide folder and paged machine reads and displays an admin-mode status in the UI.
- Folder-scoped reads include `X-UIPATH-OrganizationUnitId` with the numeric folder `Id`.
- The app also stores folder `Key` because UiPath notes that `FolderKey` remains stable when some account/licensing changes alter numeric `FolderId`.

## 5. OAuth Scopes

Required non-confidential External App user scopes:

```text
OR.Execution.Read OR.Folders.Read OR.Jobs.Read OR.License.Read OR.Machines.Read OR.Robots.Read OR.Settings.Read OR.Users.Read
```

Likely additional read scopes to validate with the customer later:

- Queue read scope if queue backlog should influence recommendations.
- Calendar read scope if non-working days and blackout windows should be honored.
- Data Fabric/Data Service read scope if persisted capacity metrics are introduced.
- Insights / Real-Time Monitoring scopes if the customer prefers validated metrics from Insights RTM.

Principle:

- Start with the smallest read-only set that supports pilot goals.
- Expand only when a specific endpoint returns 401/403 or a customer-approved metric requires more access.

## 6. Current API Endpoints Touched by the App

All calls are `GET` requests. The app records diagnostics for each request: endpoint, URL, HTTP status, folder id/name when present, result count, and a preview of the first returned item or error text.

| Area | Endpoint | Scope | Query | Folder header | Purpose |
| --- | --- | --- | --- | --- | --- |
| Role discovery | `odata/Users/UiPath.Server.Configuration.OData.GetCurrentUser` with method-parentheses fallback | Tenant/user | `$expand=Roles` first, then broad current-user fallback | No | Detects whether the signed-in user has the exact default `Orchestrator Administrator` role. Generic administrator names and boolean admin flags do not enable admin mode. |
| Folder discovery | `api/Folders/GetAllForCurrentUser` | Tenant/user | `take=200&skip=<offset>` paged at 200 records | No | Primary regular-user discovery path. Returns folders the signed-in user can access. |
| Admin folder discovery | `odata/Folders` | Tenant | `$select=<folder fields>&$top=100&$skip=<offset>&$orderby=FullyQualifiedName asc` with broad fallback | No | Used only when `Orchestrator Administrator` role detection succeeds. Falls back to current-user folders if the tenant-wide read fails. |
| Tenant license info | `odata/Settings/UiPath.Server.Configuration.OData.GetLicense` | Tenant | none | No | Reads the active runtime license family from `Allowed`/`Used`: Unattended first when allocated, Testing/Test Automation for non-production test tenants, then NonProduction. |
| Session signals | `odata/Sessions/UiPath.Server.Configuration.OData.GetGlobalSessions` with `odata/Sessions` fallback | Tenant | `$select=<state, machine, host, runtime, robot, reporting time, folder fields>&$filter=(State eq 'Available' or State eq 'Busy' or State eq 'Connected') and ReportingTime gt <lookbackStart>&$expand=Robot&$top=100&$orderby=MachineName asc` | No | Reads recent active connected host/session signals used to calculate connected machines per template; falls back to selected fields or broad session reads if a tenant rejects `$expand` or the filter. |
| Machine inventory | `odata/Machines` | Folder or Orchestrator Administrator | `$select=<runtime capacity fields>&$top=100&$skip=<offset>&$orderby=Name asc` with broad fallback | Yes for regular-user folder reads; no for Orchestrator Administrator tenant-wide reads | Reads machine/template identity, folder, and runtime slot fields across all pages. Regular users get machines from the discovered folder list; Orchestrator Administrator users also get tenant-wide machine discovery. |
| Job history | `odata/Jobs` | Folder | `$select=<job timing, state, machine, user/session, runtime fields>&$filter=CreationTime ge <lookbackStart> [and selected machine predicate]&$orderby=CreationTime desc&$top=100` | Yes | Reads recent jobs for observed runtime demand and historical duration, using date filtering, field projection, selected folder scope, and selected machine/template predicates when a specific template is chosen. |
| Trigger/schedule | `odata/ProcessSchedules` | Folder | `$select=<schedule, process, runtime, next-run fields>&[$filter=<selected machine predicate>&]$orderby=Name asc&$top=100` | Yes | Reads enabled/disabled schedules and next-run information for projected demand. When machine fields are exposed, the selected machine/template predicate is applied; otherwise diagnostics show the rejected scoped read. |

### Discovery Mode vs Heatmap Mode

Discovery mode:

- Reads folders and paged machines.
- Uses folder-scoped machine reads for regular users.
- Uses tenant-wide folder and machine reads only after exact `Orchestrator Administrator` role detection succeeds.
- Does not load job or trigger history.
- Used immediately after sign-in so the app can show whether OAuth and read-only discovery are working.

Heatmap mode:

- Reads jobs and process schedules for the selected folder scope.
- If a specific machine template is selected, uses that template's known folder associations to narrow folder-scoped reads where possible, and applies `MachineName` / `HostMachineName` predicates to scoped job and schedule queries.
- Uses the default API lookback window, currently 30 days.
- Used when the user chooses filters and generates the live heatmap.

## 7. Current Field Mapping

The connector is defensive because UiPath API response shapes can differ across endpoint versions and tenant configurations. Each app field may map from several possible raw fields.

### Folder Fields

| App field | Raw fields checked | Meaning |
| --- | --- | --- |
| `id` | `Id`, `id` | Numeric folder id used today for `X-UIPATH-OrganizationUnitId`. |
| `key` | `Key`, `key` | Stable folder key; useful for future `X-UIPATH-FolderKey` support. |
| `name` | `DisplayName`, `displayName`, `Name`, `name` | Friendly folder name. |
| `path` | `FullyQualifiedName`, `fullyQualifiedName`, `Path`, `path` | Fully qualified folder path when available. |
| `parentId` | `ParentId`, `parentId` | Numeric parent folder id used to build the folder tree when returned. |
| `parentKey` | `ParentKey`, `parentKey` | Stable parent folder key used to build the folder tree when returned. |

Why it matters:

- Folder scope determines which jobs/triggers are visible.
- Partial folder access is expected and should be shown as a data-health state, not treated as a failure.

### Machine / Machine Template Fields

| App field | Raw fields checked | Meaning |
| --- | --- | --- |
| `key` | `Key`, `key`, `LicenseKey`, `licenseKey` | Machine/template identifier used in filters and joins. |
| `id` | `Id`, `id`, `Key`, `key` | Machine record id or key. |
| `name` | `Name`, `name`, `MachineName`, `machineName` | Machine/template name shown to users. |
| `scope` | `Scope`, `scope` | Scope reported by Orchestrator, when available. |
| `type` | `Type`, `type`, `MachineType`, `machineType` | Machine type or template type. |
| `unattendedSlots` | `UnattendedSlots`, `unattendedSlots`, `UnattendedRobotSlots`, `unattendedRobotSlots` | Unattended runtime slot count. |
| `nonProductionSlots` | `NonProductionSlots`, `nonProductionSlots`, `NonProductionRobotSlots`, `nonProductionRobotSlots` | Non-production runtime slot count. |
| `headlessSlots` | `HeadlessSlots`, `headlessSlots` | Headless/background slot count when exposed. |
| `testingSlots` | `TestingSlots`, `testingSlots`, `TestAutomationSlots`, `testAutomationSlots` | Testing/Test Automation runtime slot count when exposed; treated as valid runtime capacity for non-production tenants. |
| `automationCloudSlots` | `AutomationCloudSlots`, `automationCloudSlots`, `AutomationCloudRobotSlots`, `automationCloudRobotSlots` | Automation Cloud robot slot count when exposed. |
| `folderNames` | Machine folder fields | Folders associated with this machine/template signal. |
| `onlineHosts` | Optional session/monitoring enrichment | Number of related host/session names with available/busy/connected state when an approved source is added. |
| `totalHosts` | Optional session/monitoring enrichment | Total distinct related host/session names observed when an approved source is added. |

Derived calculations:

```text
templateRuntimeSlots = unattendedSlots + automationCloudSlots + headlessSlots + nonProductionSlots + testingSlots
connectedMachines = distinct available/busy/connected host sessions matched to the machine template
configuredMaxCapacity = templateRuntimeSlots * connectedMachines
```

The current app first calls `odata/Sessions/UiPath.Server.Configuration.OData.GetGlobalSessions` using active `State`, recent `ReportingTime`, and `$expand=Robot`, then falls back through `odata/Sessions` and selected-field variants. If session reads are blocked, the UI surfaces the partial data state and falls back to counting each returned template once.

### Session Fields

| App field | Raw fields checked | Meaning |
| --- | --- | --- |
| `id` | `Id`, `id`, `Key`, `key` | Session identifier. |
| `state` | `State`, `state` | Availability status such as Available, Busy, Connected, Disconnected, or tenant-specific states. |
| `machineName` | `MachineName`, `machineName`, `Machine`, `machine` | Machine name associated with the session. |
| `hostMachineName` | `HostMachineName`, `hostMachineName`, `HostMachine`, `hostMachine` | Host name when exposed separately. |
| `runtimeType` | `RuntimeType`, `runtimeType`, `RobotType`, `robotType` | Runtime/robot category. |
| `robotName` | `RobotName`, `robotName`, `Name`, `name`, expanded `Robot.Name` variants | Robot/session name. |
| `folderName` | `FolderName`, `OrganizationUnitName`, `OrganizationUnitFullyQualifiedName` variants | Folder visibility associated with the session. |
| `reportingTime` | `ReportingTime`, `reportingTime`, `LastSeen`, `lastSeen` | Timestamp used with state to avoid counting stale disconnected history as connected capacity. |

Why it matters:

- Sessions are the best current signal for connected machine counts and host availability when filtered to recent active states.
- Configured max capacity can still be operationally unavailable if no valid session/host is available.

### Job Fields

| App field | Raw fields checked | Meaning |
| --- | --- | --- |
| `key` | `Key`, `key` | Job GUID-style key. |
| `id` | `Id`, `id`, `Key`, `key` | Job id/key. |
| `state` | `State`, `state` | Job state such as Pending, Running, Successful, Faulted, Stopped. |
| `processName` | `ProcessName`, `processName`, `ReleaseName`, `releaseName` | Process/release name used as heatmap driver. |
| `folderName` | `FolderName`, `OrganizationUnitName`, `OrganizationUnitFullyQualifiedName` variants | Folder where job ran. |
| `startTime` | `StartTime`, `startTime` | Actual start timestamp. |
| `endTime` | `EndTime`, `endTime` | Actual end timestamp. |
| `createdTime` | `CreationTime`, `CreatedTime` variants | Job creation time; fallback when start time is unavailable. |
| `sourceType` | `SourceType`, `Source` variants | Whether job came from schedule, manual start, queue trigger, etc. |
| `hostMachineName` | `HostMachineName`, `hostMachineName` | Host used for execution, when available. |
| `runtimeType` | `RuntimeType`, `RobotType` variants | Runtime category associated with the job. |
| `packageType` | `PackageType`, `Type` variants | Package/process type signal when available. |

How it becomes a heatmap:

- Convert `StartTime` or `CreationTime` from UTC into the tenant/business timezone.
- Estimate duration from `StartTime` to `EndTime`.
- Map the job to a machine template using machine id, host machine name, related session data, or machine inventory.
- Build start/end events for each affected bucket and calculate peak concurrent consumed runtime lanes using machine plus execution account when available.
- Track top process drivers for each risk block.

Known limitation:

- The MVP uses hourly buckets. Production tenants with dense scheduling may need 15-minute buckets and should validate that job records expose user account, robot, or session identity for HD-safe runtime lane calculation.

### Trigger / Schedule Fields

| App field | Raw fields checked | Meaning |
| --- | --- | --- |
| `key` | `Key`, `key` | Trigger/schedule key. |
| `id` | `Id`, `id`, `Key`, `key` | Trigger/schedule id. |
| `name` | `Name`, `name` | Trigger display name. |
| `enabled` | `Enabled`, `IsEnabled` variants | Whether the trigger is active. |
| `processName` | `ReleaseName`, `ProcessName` variants | Process/release the trigger starts. |
| `folderName` | `FolderName`, `OrganizationUnitName`, `OrganizationUnitFullyQualifiedName` variants | Folder where trigger exists. |
| `triggerType` | `TriggerType`, `ProcessScheduleType`, `Type`, or queue-name inference | Time, Queue, Event, API, or tenant-specific type signal. |
| `cron` | `StartProcessCron`, `CronExpression` variants | Raw cron expression. |
| `cronSummary` | `StartProcessCronSummary`, `CronSummary` variants | Human-readable schedule summary, when available. |
| `timeZoneId` | `TimeZoneId`, `timeZoneId` | Schedule timezone id. |
| `runtimeType` | `RuntimeType`, `runtimeType` | Runtime category requested by trigger. |
| `jobPriority` | `JobPriority`, `jobPriority` | Trigger/job priority. |
| `nextRun` | `NextOccurrence`, `NextRunTime`, `StartProcessNextOccurrence` variants | Next projected occurrence, when available. |

How it becomes schedule risk:

- Disabled trigger = low risk with "Trigger disabled" cause.
- Enabled trigger = at least one unit of projected runtime demand.
- If projected runtime demand is greater than or equal to available capacity, the trigger is flagged as higher risk.

Known limitation:

- For exact concurrency, the app must parse or validate `StartStrategy`, `MachineRobots`, queue trigger thresholds, and trigger-specific allocation behavior.

## 8. API Endpoints Recommended for Next Validation

These are not all currently called by the app, but they are important for closing the remaining gray areas.

| Need | Candidate endpoint | Why it matters |
| --- | --- | --- |
| Rich process metadata | `odata/Releases` | Adds process key, package version, latest/deleted flags, package name, and process metadata. |
| Tenant license summary | `odata/Settings/UiPath.Server.Configuration.OData.GetLicense` | Returns allowed, defined, and concurrent robot/license counts in the API guide example. |
| Runtime license state | `odata/LicensesRuntime(...)` and related runtime license endpoints | Helps validate machine-runtime enablement and runtime allocation, but must remain read-only for this app. |
| Queue backlog | `odata/QueueItems` or queue summary endpoints | Helps explain demand spikes and queue-trigger risk. |
| Calendars / non-working days | Calendar endpoints | Needed for blackout windows and non-working-day-aware schedule recommendations. |
| Data Fabric/Data Service metrics | Data Fabric entity/record APIs | Needed for curated 5-minute/hourly capacity snapshots and long-range history beyond Orchestrator retention. |
| Insights RTM | Insights / real-time monitoring APIs | Possible validated source for utilization metrics if the customer already trusts Insights. |
| Serverless usage/cost | Cloud Robots serverless and license/consumption endpoints | Needed to distinguish host-machine capacity from serverless capacity and platform/robot unit consumption. |

## 9. Data Retention and History

API-only history is useful for early validation but may be insufficient for production planning.

Risks:

- Orchestrator job retention may not cover the customer's planning window.
- Large historical pulls can be slow or rate-limit prone.
- Duration percentiles such as p90/p95 should be calculated from curated historical facts, not only one recent page of jobs.

Recommended persisted entities:

- `RuntimeCapacitySnapshot`
- `MachineTemplateInventorySnapshot`
- `ProcessDurationMetric`
- `ScheduleRiskSnapshot`
- `WhatIfScenario`
- `DataIngestionRun`
- `ApiErrorLog`

Store curated metrics and sanitized diagnostics, not raw queue payloads, full robot logs, credentials, secrets, or OAuth tokens.

## 10. Customer Validation Questions

Use these questions during pilot setup:

1. Which tenant and folders represent the real scheduling/capacity problem?
2. Which machine templates should be included, and are their host machines truly equivalent?
3. Are any target processes running on Automation Cloud Robots - VM or Serverless rather than customer-managed hosts?
4. Which runtime/license model is active for this tenant?
5. Which read-only OAuth scopes are approved for folders, jobs, machines, sessions, triggers, queues, calendars, licenses, Data Fabric, and Insights?
6. What is the expected historical window: 30, 90, 180, or 365 days?
7. Which known contention windows should the app reproduce?
8. Are queue backlog, blackout calendars, or non-working days required for v1 recommendations?
9. Should what-if scenarios remain session-only, be exported, or be saved centrally?
10. Should AI recommendations be rules-only, LLM-assisted through UiPath LLM Gateway, or hybrid?

## 11. Customer-Safe Interpretation Rules

- Do not treat license allocation, configured max capacity, and actual job demand as the same number; show each separately.
- Do not treat missing API data as zero risk; show partial data.
- Do not treat serverless as disconnected host-machine capacity.
- Do not assume every trigger consumes one runtime if `StartStrategy` or queue behavior indicates multiple jobs.
- Do not inspect or store queue payloads unless the customer explicitly approves data classification and retention.
- Do not log tokens or client secrets. The browser app should not have a client secret.
- Do not present recommendations as automatic actions. The app advises; COE/admin users act through normal governance.

## 12. Source References

Official UiPath documentation used for this reference:

- Orchestrator API request pattern and folder headers: https://docs.uipath.com/orchestrator/automation-cloud/latest/api-guide/building-api-requests
- Machines and machine templates: https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/about-machines
- Useful concepts in unattended automation: https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/useful-concepts-in-unattended-automation
- How unattended automation is performed: https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/how-is-unattended-automation-performed
- Jobs API requests: https://docs.uipath.com/orchestrator/automation-cloud/latest/api-Guide/jobs-requests
- Processes API requests: https://docs.uipath.com/orchestrator/automation-cloud/latest/api-Guide/processes-requests
- Robots and sessions API requests: https://docs.uipath.com/orchestrator/automation-cloud/latest/api-Guide/robots-requests
- Schedules API requests: https://docs.uipath.com/orchestrator/automation-cloud/latest/api-Guide/schedules-requests
- License API requests: https://docs.uipath.com/orchestrator/automation-cloud/latest/api-Guide/license-requests
- Automation Cloud Robots - VM: https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/about-automation-cloud-robots-vm
- Automation Cloud Robots - Serverless: https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/automation-cloud-robots-serverless
