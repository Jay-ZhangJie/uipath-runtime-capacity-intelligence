# Reference Project Notes

This project starts fresh, but uses `ravin-seju/orchestrator-process-schedule-manager` as a technical reference.

## Useful Patterns To Reuse

- Non-confidential External App sign-in
- Saved connection model
- Required scope validation
- Sign-in recovery screen when scopes are missing
- Direct Orchestrator reads
- Tenant/folder permission boundaries
- Schedule calendar views
- Trigger inventory
- Stale and collision signals
- 30-day job history for runtime statistics
- Machine/robot inference from job history
- Testing route and fixture data

## New Capabilities In This Project

- Machine template and runtime configuration inventory
- Effective runtime capacity calculation
- Runtime/license heatmaps across day/week/month/year
- SLA breach analysis
- Business blackout and priority windows
- What-if schedule simulation
- Dynamic recommendations with confidence and impact

## Positioning

```text
Process Schedule Manager = schedule visibility foundation.
Runtime Capacity Intelligence = schedule visibility + runtime/license capacity planning + SLA risk + recommendations.
```