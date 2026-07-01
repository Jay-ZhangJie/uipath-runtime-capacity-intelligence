# UiPath Runtime Capacity Intelligence

Read-only UiPath Automation Cloud web app for unattended runtime capacity, machine template inventory, schedule risk analysis, SLA visibility, and dynamic schedule recommendations.

## Product Vision

Runtime Capacity Intelligence helps business owners, COE teams, release managers, and Orchestrator admins understand whether unattended automations can run on time with available runtimes. It connects schedule visibility with runtime/license capacity planning so teams can answer: "Where can I safely schedule the next automation?" and "Do we need more unattended runtimes, or just a better schedule?"

## Reference Pattern

This project starts fresh, but uses the team's existing `orchestrator-process-schedule-manager` project as a technical reference for:

- non-confidential UiPath External App sign-in
- user-delegated API access
- tenant and folder permission boundaries
- direct Orchestrator reads
- trigger calendar and inventory concepts
- collision/stale schedule signals
- fixture/testing mode patterns

The differentiator for this project is capacity intelligence: runtime heatmaps, machine template capacity, SLA risk, what-if planning, and dynamic recommendations.

## MVP Principles

- Automation Cloud first.
- Read-only advisory mode.
- User signs into the target tenant.
- Visibility follows the signed-in user's UiPath permissions.
- Direct UiPath APIs are the primary path.
- Insights and real-time dashboards are complementary validation/reference sources.
- No database required for the first MVP unless long-range history, saved scenarios, or performance require persistence.

## Core Views

- Executive overview
- Runtime heatmap: day, week, month, year
- Schedule vs runtime risk analysis
- SLA exception view
- Machine template and runtime inventory
- What-if schedule simulator
- Dynamic recommendations

## Documentation

- [PDD](docs/pdd.md)
- [SDD](docs/sdd.md)
- [External App Setup](docs/external-app-setup.md)
- [Recommendation Engine](docs/recommendation-engine.md)
- [Reference Project Notes](docs/reference-project.md)
- [Roadmap](docs/roadmap.md)

## Planned Stack

- React + Vite + TypeScript
- `@uipath/uipath-typescript`
- Radix UI or equivalent accessible primitives
- Lucide icons
- In-memory model and fixture data first
- Optional persistence later

## Status

Design and discovery phase. Initial docs and mockups are being shaped before scaffolding the coded web app.