# External App Setup

This app should use a UiPath non-confidential External Application so users sign in interactively and data access follows their UiPath tenant and folder permissions.

## App Type

- External Application type: non-confidential / public client
- Grant model: authorization code with user scopes
- Client secret: none
- Redirect URI: local dev URL first, deployed Coded App URL later

## Initial Read-Only Scopes

Start with the scope set already proven by the reference schedule manager:

```text
OR.Folders.Read OR.Execution.Read OR.Jobs.Read OR.Machines.Read OR.Robots.Read
```

Additional scopes may be required as we validate machine template, runtime, license, queue, calendar, and trigger endpoints. Keep the scope set read-only unless a future version explicitly introduces write actions.

## User Access Model

- The app should not act as a broad service account.
- The signed-in user sees only tenants/folders/resources they can already see in UiPath.
- Tenant and folder dropdown values should be retrieved after sign-in.
- Partial access should render clear partial-data states, not generic errors.

## Local Development Flow

1. Create or update the non-confidential External Application.
2. Register the local redirect URI, for example `http://localhost:5177`.
3. Configure the app with Platform URL, organization, tenant, client ID, redirect URI, and scopes.
4. Sign in through the app.
5. Load permitted folders, schedules, jobs, machines, and runtimes.

## Deployment Note

After deploying as a UiPath Coded Web App, add the deployed app URL as another redirect URI in the External Application before testing sign-in.