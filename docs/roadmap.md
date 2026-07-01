# Roadmap

## Phase 1: Design And Demo

- Finalize PDD and SDD.
- Keep static HTML mockup current with product decisions.
- Define demo dataset and user story.
- Confirm required UiPath read-only scopes.

## Phase 2: App Scaffold

- Create React + Vite + TypeScript app.
- Add UiPath Coded Web App configuration.
- Add design system primitives.
- Add demo dataset and in-memory analytics model.
- Implement static dashboard routes.

## Phase 3: UiPath Sign-In And Live Reads

- Add non-confidential External App sign-in.
- Add saved connection flow.
- Load tenants and folders based on user permission.
- Read jobs, triggers, machines, sessions, and runtime-related data.
- Handle partial access gracefully.

## Phase 4: Capacity Intelligence

- Implement runtime heatmap buckets.
- Add machine template inventory.
- Add schedule vs runtime risk analysis.
- Add SLA exception detection.
- Add what-if simulation.

## Phase 5: Recommendations And Deployment

- Implement recommendation engine.
- Add confidence and data-basis explanations.
- Build and package as UiPath Coded Web App.
- Publish and deploy to a target folder.
- Validate redirect URI and sign-in flow on deployed URL.