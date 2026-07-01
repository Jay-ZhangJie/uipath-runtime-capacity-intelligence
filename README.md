# UiPath Runtime Capacity Intelligence

Read-only UiPath Automation Cloud web app for unattended runtime capacity, machine template inventory, schedule risk analysis, SLA visibility, and dynamic schedule recommendations.

## Product Vision

Runtime Capacity Intelligence helps business owners, COE teams, release managers, and Orchestrator admins understand whether unattended automations can run on time with available runtimes. It connects schedule visibility with runtime/license capacity planning so teams can answer: "Where can I safely schedule the next automation?" and "Do we need more unattended runtimes, or just a better schedule?"

## Current Status

Initial React + Vite + TypeScript Coded Web App scaffold with fixture-backed analytics. Live UiPath API connectivity will be added after External App details and final scopes are confirmed.

## Core Views

- Executive overview
- Runtime heatmap: day, week, month, year
- Schedule vs runtime risk analysis
- SLA exception view
- Machine template and runtime inventory
- What-if schedule simulator
- Dynamic recommendations

## Local Development

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
```

## OAuth Scope Baseline

```text
OR.Folders.Read OR.Execution.Read OR.Jobs.Read OR.Machines.Read OR.Robots.Read
```

The app is intentionally read-only. Additional read scopes may be added after endpoint validation for runtime capacity, queue, trigger, calendar, and license views.

## Documentation

- [PDD](docs/pdd.md)
- [SDD](docs/sdd.md)
- [External App Setup](docs/external-app-setup.md)
- [Recommendation Engine](docs/recommendation-engine.md)
- [Reference Project Notes](docs/reference-project.md)
- [Roadmap](docs/roadmap.md)
