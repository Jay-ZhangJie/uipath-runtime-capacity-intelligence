# Runtime Capacity Intelligence Code Architecture

This app is organized so each file owns one responsibility. The UI should compose already-shaped data; UiPath authentication, Orchestrator retrieval, DTO normalization, and capacity planning logic should stay outside the React component whenever practical.

## Main Layers

| Area | File | Responsibility |
| --- | --- | --- |
| UI composition | `src/App.tsx` | Page state, filters, component rendering, and user interactions. |
| App constants | `src/config/appConfig.ts` | Tenant timezone, required scopes, date range presets, storage keys, and API page limits. |
| Connection profiles | `src/lib/connectionProfiles.ts` | Saved non-confidential External App connection profiles in browser local storage. |
| UiPath sign-in | `src/lib/uipathAuth.ts` | OAuth redirect flow, SDK lifecycle, token scope validation, sign-out, and public config masking. |
| Live connector orchestration | `src/lib/uipathLive.ts` | Thin facade that combines auth plus live data retrieval into one probe result for the UI. |
| Orchestrator retrieval | `src/lib/orchestratorRetriever.ts` | License info, exact Orchestrator Administrator role detection, folder, session, job, paged machine, and trigger reads from UiPath Orchestrator. |
| DTO mapping | `src/lib/liveMappers.ts` | Converts UiPath SDK/OData responses into stable app summary objects. |
| Live data transforms | `src/lib/liveTransforms.ts` | Converts live jobs, machines, sessions, and triggers into runtime buckets, configured max capacity, inventory, and risk rows. |
| Capacity analytics | `src/lib/analytics.ts` | Configured max capacity, connected-machine totals, utilization, peak demand, risk grouping, and filter helpers. |
| Recommendation logic | `src/lib/recommendations.ts` | Rule-based observations and recommendations for current dashboard state. |
| Date/time helpers | `src/lib/dateTime.ts` | Tenant-timezone formatting and current slot calculation. |
| Shared app types | `src/types.ts` | Dashboard, heatmap, inventory, recommendation, and what-if domain types. |
| Live connector types | `src/types/live.ts` | UiPath probe, folder, job, process, machine, optional session, and trigger contracts. |
| Connection types | `src/types/connections.ts` | Saved connection profile contracts. |

## Real Data Flow

1. User clicks **Sign in** and selects a saved connection profile.
2. `App.tsx` creates a `ProbeConnectionConfig` with platform URL, organization slug, tenant, client ID, redirect URI, and scopes.
3. `uipathLive.ts` calls `uipathAuth.ts` to complete OAuth and validate the token includes required read scopes.
4. `orchestratorRetriever.ts` reads tenant license info, current-user roles, folders, sessions, and machine inventory first. Regular users receive machines from the discovered folder list; users with the exact default `Orchestrator Administrator` role also get tenant-wide folder and machine discovery where permitted. It then performs folder-scoped reads for jobs and triggers where possible.
5. `liveMappers.ts` normalizes raw SDK/OData records into stable summaries.
6. `liveTransforms.ts` converts those summaries into heatmap buckets, schedule risks, and machine-template inventory rows. Configured max capacity is calculated as template runtime slots times connected machines.
7. `App.tsx` renders the transformed live data, or clearly surfaces connector diagnostics when reads fail or return no records.

## Security Notes

- The app uses a non-confidential External App pattern.
- No client secret is required or stored.
- Saved connection profiles store only platform URL, organization, one case-sensitive tenant name, and client ID in browser local storage.
- OAuth tokens are handled by the UiPath TypeScript SDK browser flow.
- The app is read-only; required scopes are centralized in `src/config/appConfig.ts`.
- Admin mode is enabled only when role discovery returns the exact UiPath default `Orchestrator Administrator` role. Generic `Administrator`, custom admin names, and boolean admin flags do not enable tenant-wide discovery.

## Debugging Live Data

If sign-in succeeds but no real folders or data appear, start in this order:

1. Check the top data health band and the **Live Orchestrator Data** preview diagnostics.
2. Review `src/lib/orchestratorRetriever.ts` for the failing probe message.
3. Confirm the signed-in user has folder assignments in the selected tenant, or has the default Orchestrator Administrator role when testing tenant-wide discovery.
4. Confirm the External App includes read scopes for folders, execution/jobs, machines, robots/sessions, licenses/settings, users, and triggers if trigger reads are enabled.
5. If only folder discovery fails, add or adjust the folder endpoint strategy in `orchestratorRetriever.ts` without changing the UI.
6. If machine inventory stops at a round number, inspect the paged machine diagnostics before assuming the tenant only has that many records.

## Customer Validation Notes

For client pilots, keep troubleshooting centered on the live connector boundary rather than the dashboard UI:

- `src/lib/uipathAuth.ts` owns OAuth, scope validation, redirect handling, and public config masking.
- `src/lib/orchestratorRetriever.ts` owns endpoint strategy, pagination, folder-scoped reads, and probe messages.
- `src/lib/liveMappers.ts` owns defensive normalization of SDK/OData response shapes.
- `src/lib/liveTransforms.ts` owns conversion from live records into heatmap, risk, and inventory facts.
- `src/App.tsx` should only decide whether to render live data, empty sign-in state, or diagnostics based on the probe result.

When a customer tenant returns partial data, preserve the connector message in the Diagnose button/panel and add the endpoint/scope finding to the customer configuration guide. Do not silently fall back to mock data.
