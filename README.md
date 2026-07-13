# UiPath Runtime Capacity Intelligence

Read-only UiPath Automation Cloud web app for unattended runtime capacity, machine template inventory, schedule risk analysis, SLA visibility, and dynamic schedule recommendations.

## Product Vision

Runtime Capacity Intelligence helps business owners, COE teams, release managers, and Orchestrator admins understand whether unattended automations can run on time with available runtimes. It connects schedule visibility with runtime/license capacity planning so teams can answer: "Where can I safely schedule the next automation?" and "Do we need more unattended runtimes, or just a better schedule?"

The dashboard separates three concepts customers often mix together:

- **License allocation** is the static unattended runtime allocation assigned to the tenant by an admin. The live connector reads it from Orchestrator license info when the signed-in user and External App are permitted.
- **Configured max capacity** is calculated from machine-template runtime slots multiplied by connected machines for the selected folder/template scope.
- **Actual demand and utilization** come from observed/projected job concurrency. Utilization compares peak demand to the binding planning capacity, using the smaller of license allocation and configured max capacity when both are known.

## Current Status

React + Vite + TypeScript Coded Web App with browser OAuth, saved single-tenant connection profiles, and a modular live Orchestrator read connector. The current live path validates non-confidential External App sign-in, required read scopes, folder discovery, tenant license info, sessions, and scoped reads for jobs, machines, and triggers where the target tenant allows them.

Without live connectivity, the dashboard shows an empty sign-in state and real connector diagnostics instead of mock business data. The next validation step is to test the connector against a customer-approved UiPath Cloud tenant and compare the app's findings against known runtime/schedule behavior.

## Core Views

- Executive overview
- Runtime heatmap: day, week, month
- Schedule vs runtime risk analysis
- SLA exception view
- Machine template and runtime inventory
- What-if schedule simulator with submitted impact summary
- Rules-backed schedule recommendation for proposed automations; production AI/chat is deferred
- Dynamic recommendations

## Local Development

```powershell
npm install
npm run dev
```

## Test Against A Real Tenant

Create a non-confidential External Application in UiPath Admin, add the local redirect URI, and grant the required user scopes below. Then create `.env.local` from `.env.example`.

```powershell
Copy-Item .env.example .env.local
```

Set these values in `.env.local`:

```text
VITE_UIPATH_CLIENT_ID=<external-app-client-id>
VITE_UIPATH_ORG_NAME=<organization-slug>
VITE_UIPATH_TENANT_NAME=<tenant-name>
VITE_UIPATH_BASE_URL=https://cloud.uipath.com
VITE_UIPATH_REDIRECT_URI=http://localhost:5173
```

Tenant names are case sensitive. Set `VITE_UIPATH_TENANT_NAME` to the exact tenant casing shown in Automation Cloud, for example `AMER_Prod` rather than `amer_prod`.

For staging or alpha, use the matching Automation Cloud URL, for example `https://staging.uipath.com` or `https://alpha.uipath.com`, and make sure the External App redirect URI exactly matches the local URL you open in the browser. Direct Orchestrator OData reads use the documented `{AutomationCloudURL}/{organizationName}/{tenantName}/orchestrator_/...` pattern.

After `npm run dev`, open `http://localhost:5173/` and click **Sign in**. The Diagnose button and panel should show whether OAuth connected, which connector scope was used, and whether the read-only license, folder, recent active session, job, machine, and trigger API reads succeeded or returned partial-access warnings.

## Customer Validation Request

For a customer pilot, ask for a scoped, read-only validation setup:

- A UiPath Cloud tenant, preferably non-production first, with representative folders, schedules, jobs, machine templates, and runtime behavior.
- A non-confidential External Application owned by the customer or created with their admin approval.
- The local redirect URI for development validation or the deployed Coded Web App redirect URI for hosted validation.
- The exact case-sensitive tenant name from Automation Cloud.
- The required non-confidential External App user scopes listed below, plus any additional read scopes required for calendars, queues, Data Fabric, or Insights after endpoint validation.
- A signed-in pilot user whose existing Orchestrator permissions represent the folders and machine templates the customer wants analyzed.
- Agreement that MVP behavior is advisory and read-only: the app does not start, stop, retry, update, or reschedule jobs.

Useful validation outcomes:

- Confirm folder and machine-template discovery works with customer permissions.
- Compare detected high-risk runtime windows against COE/admin expectations.
- Validate whether contention is caused by tenant license allocation, configured max capacity, schedule overlap, or host/session health.
- Identify any endpoint, retention, or scale limits that require Data Fabric/Data Service persisted metrics.

## Build

```powershell
npm run build
```

## Required Non-Confidential App Scopes

```text
OR.Execution.Read OR.Folders.Read OR.Jobs.Read OR.License.Read OR.Machines.Read OR.Robots.Read OR.Settings.Read OR.Users.Read
```

The app is intentionally read-only. These scopes allow the browser app to read execution/job history, folders, tenant license/settings data, machine templates, robot/session signals, and user metadata needed for runtime-lane mapping. Add `Insights` and `Insights.RealTimeData` later if replacing job-derived demand with Insights Real-Time Monitoring metrics.

## Documentation

- [PDD](docs/pdd.md)
- [SDD](docs/sdd.md)
- [Technical Architecture and Deployment](docs/technical-architecture-and-deployment.md)
- [UiPath Runtime Concepts and API Reference](docs/uipath-runtime-concepts-and-api-reference.md)
