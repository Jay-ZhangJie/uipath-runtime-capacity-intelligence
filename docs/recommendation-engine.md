# Recommendation Engine

Dynamic recommendations should be calculated from current filters and user-visible data. They should not be hardcoded dashboard text.

## Input Signals

- Signed-in user's accessible tenants and folders
- Enabled time triggers and projected run windows
- Historical job duration percentiles by process, folder, and time period
- Runtime capacity by folder, runtime type, and machine template
- Unattended session status and disconnected hosts
- Queue volume and SLA risk where available
- Business blackout windows, month-end windows, and critical process priorities

## Recommendation Types

| Type | Meaning |
| --- | --- |
| Move schedule | A lower-risk slot exists inside the allowed SLA window. |
| Add runtime | No safe slot exists and projected demand exceeds capacity. |
| Restore capacity | Disconnected machines or unavailable sessions reduce effective capacity. |
| Split workload | One long automation should be split or queue-triggered to reduce peak contention. |
| Change priority/window | Lower-priority schedules conflict with critical automations. |

## Output Contract

Every recommendation should include:

- reason
- expected impact
- confidence level
- required action owner
- data basis, such as `90 days of job history` or `next 14 days of trigger projection`

## First Algorithm

1. Build capacity buckets by runtime type, folder, and machine template.
2. Expand enabled time triggers into future run windows.
3. Estimate each run using p90 duration by default, with p95 for critical processes.
4. Overlay demand on capacity buckets.
5. Mark buckets over configured thresholds.
6. Generate candidate schedule moves within SLA and blackout constraints.
7. Rank recommendations by risk reduction and operational effort.