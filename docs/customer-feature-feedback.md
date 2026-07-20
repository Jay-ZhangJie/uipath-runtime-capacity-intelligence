# Customer Feature Feedback

This document tracks customer-requested feature themes for Runtime Capacity Intelligence and turns them into product requirements that can be evaluated against the current roadmap.

## Summary

| Customer | Request | Product theme | Proposed roadmap fit |
| --- | --- | --- | --- |
| Customer B | AI assistant and chat experience where users ask natural-language capacity questions such as "What is the best schedule recommendation for a new use case?" | Conversational capacity advisor | vNext candidate after live data, recommendation logic, and AI guardrails are validated |
| Customer T | Slice-and-dice patterns, such as focusing on Mondays in the past 60 days and seeing a more detailed Month Heatmap without changing the whole dashboard context | Context-preserving analytical drilldown | Strong candidate for near-term UX enhancement once historical metrics support day-of-week and filtered period analysis |

## Customer B: AI Assistant And Chat Experience

### Request

Customer B wants an assistant-style experience where users can type operational questions in natural language and receive an answer with proof from the underlying runtime data.

Example question:

> What is the best schedule recommendation for a new use case?

### User Need

Business users and release managers may not know which heatmap filters, schedule-risk tables, or inventory views to inspect first. They want to ask the planning question directly, then see the evidence behind the answer.

### Product Requirement

The app should support a conversational capacity advisor that can:

- Interpret plain-language questions about runtime pressure, schedule safety, and new automation placement.
- Ask follow-up questions when required inputs are missing, such as SLA, duration, runtime demand, folder, machine template, preferred business window, or priority.
- Return a recommendation with a data basis, confidence, and validation steps.
- Show proof from visible, permission-scoped metrics rather than giving a free-form answer alone.
- Link the answer back to heatmap buckets, schedule-risk rows, machine-template capacity, and relevant duration percentiles.

### Required Data

- Runtime utilization by time bucket, folder, machine template, runtime type, and process.
- Effective runtime capacity from machine templates, connected hosts, and sessions.
- Trigger schedules and expected run windows.
- Historical duration percentiles such as p90 and p95.
- Queue backlog or volume signals where authorized.
- Business calendar, blackout windows, SLA, priority, and release-window constraints.
- Data-health indicators for stale, partial, demo, live, or persisted metric data.

### Guardrails

- Answers must be grounded in data visible to the signed-in user. Tenant-wide answers are allowed only when the app has detected the exact UiPath default `Orchestrator Administrator` role and shows that admin mode is enabled.
- The assistant must not infer or disclose folders, machines, jobs, queues, or schedules outside the user's UiPath permissions or outside explicit Orchestrator Administrator tenant-wide discovery.
- The recommendation calculation should remain deterministic and auditable; AI can help explain the result, but should not be the only source of the decision.
- The app should clearly state when an answer is partial because of missing scopes, stale metrics, retention limits, or unavailable history.
- Prompts, transcripts, generated answers, and feedback should only be stored after an approved retention and data-classification decision.
- MVP behavior remains read-only and advisory.

### Acceptance Criteria

- A user can ask for a recommended schedule for a new automation and receive a suggested slot or capacity action.
- The answer includes the calculation basis, such as projected utilization, available buffer, runtime demand, and duration assumption.
- The answer cites the relevant heatmap time window and any high-risk overlapping schedules.
- The assistant asks clarifying questions instead of guessing when required inputs are missing.
- Limited-permission users receive a partial-data explanation rather than unsupported conclusions; Orchestrator Administrator users receive a clear admin-mode indicator before tenant-wide data is interpreted.

## Customer T: Context-Preserving Slice And Dice

### Request

Customer T wants richer analytical filtering without forcing users to switch the entire dashboard context.

Example pattern:

> Focus on Mondays in the past 60 days and show more detail in the Month Heatmap.

### User Need

COE and admin users want to investigate recurring patterns, such as a Monday peak, month-end close window, or specific day-of-week contention, while preserving the broader planning context. Switching the entire dashboard view can make it harder to compare the pattern against the surrounding month or selected planning scenario.

### Product Requirement

The heatmap and supporting detail views should support context-preserving drilldown:

- Add a focused filter layer for day-of-week, rolling lookback period, folder, machine template, process, runtime type, and risk band.
- Allow users to select a pattern such as "Mondays in the last 60 days" while keeping Month Heatmap as the visual anchor.
- Highlight matching days or buckets in the Month Heatmap instead of replacing the whole dashboard context.
- Show a focused detail panel with peak demand, effective capacity, utilization, risk band, top drivers, and representative overlapping schedules for the selected pattern.
- Preserve the current what-if scenario and planner context while users explore historical patterns.

### Required Data

- Persisted historical capacity buckets for the requested lookback period.
- Day-of-week and calendar-period attributes for each bucket.
- Runtime demand and effective capacity by folder, machine template, process, and runtime type.
- Historical schedule-risk snapshots and duration percentiles.
- Data freshness and retention metadata.

### Acceptance Criteria

- A user can filter the Month Heatmap to Mondays in the past 60 days.
- Matching calendar cells are visually emphasized while non-matching cells remain available for context.
- The detail panel shows ranked drivers for the selected pattern.
- The user can clear the focused slice without losing the broader dashboard filters.
- If the selected lookback exceeds available history, the app explains the retention limit.

## Roadmap Implications

Near-term UX work should prioritize the slice-and-dice capability because it builds directly on the current heatmap, filters, and persisted metric strategy. The conversational advisor should remain a vNext candidate until the team validates live and persisted metrics, deterministic recommendation calculations, data quality states, and AI retention policies with customers.

Both requests reinforce the same product direction: the app should not only show runtime pressure, it should help users ask better planning questions and prove the answer from trusted capacity data.
