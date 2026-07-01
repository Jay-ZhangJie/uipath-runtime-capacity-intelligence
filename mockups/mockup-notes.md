# Mockup Notes

## Presentation Positioning

Use generic naming in screenshots:

- Environment: `Production Cloud`
- Tenant: `Enterprise Tenant`
- Folders: `Finance`, `Supply Chain`, `Customer Operations`, `Shared Services`
- Machine templates: `MT-Prod-Windows`, `MT-BackOffice-HighDensity`, `MT-MonthEnd-Burst`
- Processes: `Invoice Posting`, `Order Reconciliation`, `Claim Intake`, `Month End Close`, `Customer Update`

Avoid making the demo feel like a one-customer build. TQL can be discussed as the first use case or reference scenario.

Use the architecture language consistently:

- The app is read-only.
- The user signs into a target UiPath tenant.
- Visibility follows the signed-in user's UiPath permissions.
- Direct UiPath APIs are the primary data path.
- Insights and real-time dashboards remain complementary validation/reference sources.
- Database persistence is optional and can be introduced later for shared scenarios, history, and performance.

## Mock Screens

### 1. Executive Overview

Goal: show leaders the capacity story in 30 seconds.

Visible elements:

- Signed-in tenant and permission-aware status.
- Peak runtime demand.
- Available unattended runtimes.
- Risk windows this week.
- Top constrained folders.
- Recommended actions.

### 2. Runtime Heatmap

Goal: show where capacity risk occurs.

Visible elements:

- Day-of-week by hour grid.
- Date range filter.
- Folder/process/machine template filters.
- Toggle for observed vs projected.
- Tooltip content for risky time blocks.

### 3. Schedule Planner

Goal: help release teams place new automations.

Visible elements:

- Proposed automation inputs.
- Existing schedule timeline.
- Recommended slots.
- Collision explanation.
- Required additional runtime estimate.
- Business blackout and priority windows.

### 4. Machine Template Capacity

Goal: help admins connect license risk to machine templates and sessions.

Visible elements:

- Machine template table.
- Total, used, idle, disconnected.
- Runtime type.
- Folder assignments.
- Maintenance mode indicators.

### 5. Drilldown

Goal: prove the recommendation is explainable.

Visible elements:

- Jobs contributing to selected risk block.
- Duration percentiles.
- Queue trend.
- Trigger history.

## Demo Storyline

1. Start on Executive Overview: "We have enough licenses most of the week, but Tuesday 08:00-10:00 and Friday 18:00-21:00 are constrained."
2. Open Runtime Heatmap: "The problem is not total license ownership, it is schedule overlap."
3. Filter to `Finance`: "Month-end and invoice jobs are competing with daily reconciliation."
4. Open Schedule Planner: "A new process can run safely at 02:30, 13:15, or Saturday 06:00."
5. Show What-If: "If the business insists on 08:00, two additional unattended runtimes are recommended."
6. Open Machine Template Capacity: "This is tied to `MT-Prod-Windows`, where one host is disconnected and reducing effective capacity."
